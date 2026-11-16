/**
 * 快照服务：本地快照库、增量刷新、阻塞补齐与错误映射。主接缝是 `handle(method, params)`，
 * 测试注入假的「按工作区解析后端」函数与假的快照库就能覆盖缓存、增量、错误码和刷新失败保留旧快照。
 *
 * 读取分两个阶段：
 * 1. 列表：后端返回列表即生成快照；GitHub 的原生阻塞数在同一次查询里取回，
 *    其余后端的阻塞数先按描述回退；
 * 2. 补齐：仅当后端实现 `resolveBlockers` 时读取原生阻塞数，合并后写回缓存。
 * 补齐按工作区去重；刷新替换缓存条目，旧的补齐结果不会覆盖新快照。
 *
 * 本地快照库是跨进程的缓存：每个工作区一个文件，存最近一次成功拉取的原始工单。
 * 打开面板先读库（不发远端请求），客户端随即发起一次刷新把库推向最新：
 * 有可用库且后端支持增量时走增量，否则全量重拉。刷新失败保留旧数据，
 * 并把失败原因放进快照，界面据此说明「显示的是本地缓存」。
 */
import { mergeNativeBlockers } from '../core/blockers.ts'
import { classifyTickets } from '../core/classify.ts'
import { isRecord } from '../core/json.ts'
import { mergeTickets } from '../core/merge.ts'
import { withSkillActions } from '../core/skill-action.ts'
import type { TicketReference, TrackerChanges, TrackerSnapshot } from '../core/ticket.ts'
import type { SnapshotStoreEntry } from '../core/snapshot-store.ts'
import type { BackendKind } from '../protocol/backend.ts'
import { LOG_EVENTS, SNAPSHOT_STAGES } from '../protocol/log-events.ts'
import {
  ERROR_CODES,
  RPC_METHODS,
  SNAPSHOT_PAGE_SIZE,
  type ErrorCode,
  type RpcResult,
  type SnapshotCacheInfo,
  type WorkspaceSnapshot,
} from '../protocol/tracker.ts'
import type { BackendResolver, ResolvedBackend } from './backend-resolver.ts'
import { readWorkspaceRoot } from './rpc-params.ts'
import { mapSnapshotError, snapshotFailure } from './snapshot-error.ts'
import { mergePulled, windowFor, loadMore, type MoreHost } from './snapshot-window.ts'
import {
  buildSnapshot,
  buildStoredSnapshot,
  cacheInfo,
  metricsOf,
  readStored,
  removeStored,
  repositoryKey,
  storedEntry,
  writeStored,
  type BlockerResolver,
  type CachedWorkspace,
  type SnapshotLibraryDeps,
} from './snapshot-library.ts'

/**
 * 增量窗口向前重叠的时长。远端时钟偏移与最终一致性都可能让边界上的票漏掉，
 * 多取一点再按工单引用去重，比漏票安全。
 */
const INCREMENTAL_OVERLAP_MS = 60_000

/** 快照服务依赖。 */
export interface SnapshotServiceDeps extends SnapshotLibraryDeps {
  /** 按工作区解析后端；解析结果由宿主自己缓存。 */
  readonly resolve: BackendResolver
}

/** 宿主对界面的唯一 RPC 入口。 */
export interface SnapshotService {
  /**
   * 处理一个快照方法。
   * @param method - 三个快照方法之一。
   * @param params - 方法参数。
   * @returns 成功快照或带错误码的失败。
   */
  handle(method: string, params: unknown): Promise<RpcResult<WorkspaceSnapshot>>
  /**
   * 读取或清空本地快照库。
   * @param params - 请求参数；带确认词时可以清空。
   * @returns 本地快照库的信息。
   */
  cache(params: unknown): Promise<RpcResult<SnapshotCacheInfo>>
}

/**
 * 创建按工作区根目录缓存的快照服务。
 * @param deps - 工单后端、时钟、标签名、日志出口与可选的本地快照库。
 * @returns 快照服务。
 */
export function createSnapshotService(deps: SnapshotServiceDeps): SnapshotService {
  const cache = new Map<string, CachedWorkspace>()
  // 冷启动时两个面板会同时请求：共享同一次列表拉取，后续补齐才能挂到同一条缓存上。
  const loading = new Map<string, Promise<RpcResult<WorkspaceSnapshot>>>()
  // 扩窗只用到首屏读取与发布，把它们作为能力交给窗口模块，避免两边互相依赖。
  const more: MoreHost = {
    resolve: deps.resolve,
    now: deps.now,
    log: deps.log,
    cache,
    getSnapshot: (workspaceRoot) => getSnapshot(deps, cache, loading, workspaceRoot),
    publish: (workspaceRoot, resolved, raw, startedAt) =>
      publish(deps, cache, workspaceRoot, resolved, raw, startedAt, 'more'),
  }

  return {
    handle(method, params) {
      if (!isSnapshotMethod(method)) {
        return Promise.resolve(snapshotFailure(ERROR_CODES.unknownMethod, `未知方法：${method}`))
      }

      const workspaceRoot = readWorkspaceRoot(params)
      if (workspaceRoot === undefined) {
        return Promise.resolve(
          snapshotFailure(ERROR_CODES.invalidParams, '缺少非空的 workspaceRoot 参数。'),
        )
      }

      if (method === RPC_METHODS.snapshotGet) {
        return getSnapshot(deps, cache, loading, workspaceRoot)
      }

      if (method === RPC_METHODS.snapshotResolveBlockers) {
        return resolveBlockers(deps, cache, loading, workspaceRoot)
      }

      if (method === RPC_METHODS.snapshotMore) {
        return loadMore(more, workspaceRoot)
      }

      return refreshSnapshot(deps, cache, workspaceRoot, readFullFlag(params))
    },

    cache(params) {
      if (readWorkspaceRoot(params) === undefined) {
        return Promise.resolve({
          ok: false,
          error: { code: ERROR_CODES.invalidParams, message: '缺少非空的 workspaceRoot 参数。' },
        })
      }
      return cacheInfo(deps, cache, params)
    },
  }
}

function isSnapshotMethod(method: string): boolean {
  return (
    method === RPC_METHODS.snapshotGet ||
    method === RPC_METHODS.snapshotRefresh ||
    method === RPC_METHODS.snapshotResolveBlockers ||
    method === RPC_METHODS.snapshotMore
  )
}

/** 读出「全量刷新」标记。 */
function readFullFlag(params: unknown): boolean {
  return isRecord(params) && params.full === true
}

/**
 * 读取快照：先给内存缓存，再给本地快照库，最后才实时拉取。
 * @param deps - 服务依赖。
 * @param cache - 内存缓存。
 * @param loading - 进行中的首屏拉取。
 * @param workspaceRoot - 工作区根目录。
 * @returns 快照或失败。
 */
function getSnapshot(
  deps: SnapshotServiceDeps,
  cache: Map<string, CachedWorkspace>,
  loading: Map<string, Promise<RpcResult<WorkspaceSnapshot>>>,
  workspaceRoot: string,
): Promise<RpcResult<WorkspaceSnapshot>> {
  const cached = cache.get(workspaceRoot)
  if (cached !== undefined) return Promise.resolve({ ok: true, result: cached.snapshot })

  return loadWorkspace(deps, cache, loading, workspaceRoot)
}

/**
 * 首屏拉取：同一工作区的并发请求共享同一次拉取。
 * @param deps - 服务依赖。
 * @param cache - 内存缓存。
 * @param loading - 进行中的首屏拉取。
 * @param workspaceRoot - 工作区根目录。
 * @returns 快照或失败。
 */
function loadWorkspace(
  deps: SnapshotServiceDeps,
  cache: Map<string, CachedWorkspace>,
  loading: Map<string, Promise<RpcResult<WorkspaceSnapshot>>>,
  workspaceRoot: string,
): Promise<RpcResult<WorkspaceSnapshot>> {
  const running = loading.get(workspaceRoot)
  if (running !== undefined) return running

  const task = readWorkspace(deps, cache, workspaceRoot)
  loading.set(workspaceRoot, task)
  void task.then(
    () => {
      loading.delete(workspaceRoot)
    },
    () => {
      loading.delete(workspaceRoot)
    },
  )
  return task
}

/**
 * 首屏：库里有料就先给库里那份，再由客户端发起刷新把它推向最新。
 * @param deps - 服务依赖。
 * @param cache - 内存缓存。
 * @param workspaceRoot - 工作区根目录。
 * @returns 快照或失败。
 */
async function readWorkspace(
  deps: SnapshotServiceDeps,
  cache: Map<string, CachedWorkspace>,
  workspaceRoot: string,
): Promise<RpcResult<WorkspaceSnapshot>> {
  const stored = await readStored(deps, workspaceRoot)
  if (stored !== undefined) {
    const served = await serveStored(deps, cache, workspaceRoot, stored)
    if (served !== undefined) return served
  }
  return fetchAndCache(deps, cache, workspaceRoot)
}

/**
 * 把本地快照库里的数据交给界面。
 *
 * 先确认这份缓存属于当前仓库：换远端、换后端时身份对不上，缓存作废并按全量重拉。
 * 后端暂时解析不出来时仍然显示缓存，但标成陈旧并带上失败原因。
 * @param deps - 服务依赖。
 * @param cache - 内存缓存。
 * @param workspaceRoot - 工作区根目录。
 * @param stored - 库里的条目。
 * @returns 快照；缓存不属于当前仓库时返回 undefined，交给调用方实时拉取。
 */
async function serveStored(
  deps: SnapshotServiceDeps,
  cache: Map<string, CachedWorkspace>,
  workspaceRoot: string,
  stored: SnapshotStoreEntry,
): Promise<RpcResult<WorkspaceSnapshot> | undefined> {
  if (stored.tickets.length > stored.total) {
    // 旧版本的增量可能把远端已删除的票留在库里，却已经更新了总数。
    // 这份计数不自洽，留着只会在首屏显示「已加载 3 / 共 2」；作废后按全量重拉。
    await removeStored(deps, workspaceRoot)
    return undefined
  }

  let resolved: ResolvedBackend
  try {
    resolved = await deps.resolve(workspaceRoot)
  } catch (error) {
    const mapped = mapSnapshotError(error)
    const snapshot = buildStoredSnapshot(deps, stored, {
      stale: true,
      refreshError: { code: mapped.code, message: mapped.message },
    })
    cache.set(workspaceRoot, storedEntry(stored, null, snapshot))
    return { ok: true, result: snapshot }
  }

  if (repositoryKey(resolved.kind, resolved.address) !== stored.repositoryKey) {
    await removeStored(deps, workspaceRoot)
    return undefined
  }

  const snapshot = buildStoredSnapshot(deps, stored, { stale: true, refreshError: null })
  cache.set(workspaceRoot, storedEntry(stored, resolved, snapshot))
  return { ok: true, result: snapshot }
}

/**
 * 刷新：能用增量就增量，否则全量重拉。
 *
 * 增量以本地快照库里的数据为基准，窗口起点是上次成功拉取的时刻向前重叠一小段。
 * 增量被后端截断时退回全量，不把一份不完整的结果当成完整结果。
 * @param deps - 服务依赖。
 * @param cache - 内存缓存。
 * @param workspaceRoot - 工作区根目录。
 * @param full - 为 true 时忽略本地快照库，全量重拉。
 * @returns 快照或失败。
 */
async function refreshSnapshot(
  deps: SnapshotServiceDeps,
  cache: Map<string, CachedWorkspace>,
  workspaceRoot: string,
  full: boolean,
): Promise<RpcResult<WorkspaceSnapshot>> {
  const startedAt = deps.now()

  let resolved: ResolvedBackend
  try {
    resolved = await deps.resolve(workspaceRoot)
  } catch (error) {
    return await keepOldSnapshot(deps, cache, workspaceRoot, mapSnapshotError(error), startedAt)
  }

  const stored = await readStored(deps, workspaceRoot)
  const base =
    stored?.repositoryKey === repositoryKey(resolved.kind, resolved.address) ? stored : undefined
  const tracker = resolved.tracker

  if (
    base !== undefined &&
    !full &&
    tracker.fetchChanges !== undefined &&
    // 对账以「全量覆盖」为前提：窗口截断的后端看不到窗口外的删除。
    base.windowLimit === undefined
  ) {
    const merged = await mergeIncremental(deps, cache, workspaceRoot, resolved, base, startedAt)
    if (merged !== undefined) return merged
  }

  try {
    const raw = await tracker.fetchSnapshot(
      workspaceRoot,
      windowFor(cache.get(workspaceRoot), base),
    )
    // 身份查询抖动返回 null 时沿用同一仓库上一次已知的身份，不让筛选行整行消失。
    const current = cache.get(workspaceRoot)
    const host = resolved.kind === 'markdown' ? null : (resolved.address?.host ?? null)
    const sameRepository =
      current?.kind === resolved.kind &&
      current.repositoryHost === host &&
      current.raw.repository === raw.repository
    const previousViewer = (sameRepository ? current.raw.viewer : null) ?? base?.viewer ?? null
    const withViewer = raw.viewer === null ? { ...raw, viewer: previousViewer } : raw
    return await publish(deps, cache, workspaceRoot, resolved, withViewer, startedAt, 'full')
  } catch (error) {
    return await keepOldSnapshot(deps, cache, workspaceRoot, mapSnapshotError(error), startedAt)
  }
}

/**
 * 走一次增量拉取并合并。
 *
 * 增量被后端截断时返回 undefined，交给调用方退回全量重拉；
 * 增量请求失败时保留旧数据并带上失败原因。
 * @param deps - 服务依赖。
 * @param cache - 内存缓存。
 * @param workspaceRoot - 工作区根目录。
 * @param resolved - 解析出的后端。
 * @param base - 库里的基准数据。
 * @param startedAt - 这次刷新的起始时刻。
 * @returns 合并后的快照；退回全量时是 undefined。
 */
async function mergeIncremental(
  deps: SnapshotServiceDeps,
  cache: Map<string, CachedWorkspace>,
  workspaceRoot: string,
  resolved: ResolvedBackend,
  base: SnapshotStoreEntry,
  startedAt: number,
): Promise<RpcResult<WorkspaceSnapshot> | undefined> {
  const tracker = resolved.tracker
  if (tracker.fetchChanges === undefined) return undefined

  let changes: TrackerChanges
  try {
    changes = await tracker.fetchChanges(workspaceRoot, base.fetchedAt - INCREMENTAL_OVERLAP_MS)
  } catch (error) {
    return await keepOldSnapshot(deps, cache, workspaceRoot, mapSnapshotError(error), startedAt)
  }

  if (changes.truncated) {
    // 增量被截断：这份结果不完整，退回全量重拉。
    logIncrementalFallback(deps, resolved.kind, 'truncated', startedAt)
    return undefined
  }

  // 权威总数缺失或不是非负整数：这份增量无法对账，当次退回全量，不沿用旧总数。
  const total = changes.total
  if (!Number.isInteger(total) || total < 0) {
    logIncrementalFallback(deps, resolved.kind, 'invalid-total', startedAt)
    return undefined
  }

  const windowLimit = base.windowLimit ?? SNAPSHOT_PAGE_SIZE
  const merged = mergeTickets(base.tickets, changes.tickets, windowLimit)
  // 远端删除不产生变更记录：合并后票数超过权威总数，说明缓存里有已删除的票。
  // 增量看不出是哪一张，只能当次退回全量重拉，不发布、不写入不一致的结果。
  if (merged.length > total) {
    logIncrementalFallback(deps, resolved.kind, 'drift', startedAt)
    return undefined
  }

  const raw: TrackerSnapshot = {
    repository: base.repository,
    fetchedAt: deps.now(),
    loaded: merged.length,
    total,
    tickets: merged,
    // 后端这次查了身份就用新值；没查（省略）时沿用基准数据里的身份。
    viewer: changes.viewer === undefined ? base.viewer : changes.viewer,
    windowLimit,
  }
  return await publish(deps, cache, workspaceRoot, resolved, raw, startedAt, 'incremental')
}

/**
 * 记录一次增量退让：截断、总数不可用或与合并结果漂移都走全量重拉，
 * 日志里保留原因，便于分清「后端没给全」与「远端删了票」。
 */
function logIncrementalFallback(
  deps: SnapshotServiceDeps,
  backend: BackendKind,
  reason: 'truncated' | 'invalid-total' | 'drift',
  startedAt: number,
): void {
  deps.log('warn', LOG_EVENTS.snapshot, {
    result: 'fallback',
    backend,
    stage: SNAPSHOT_STAGES.list,
    reason,
    durationMs: Math.max(0, deps.now() - startedAt),
  })
}

/**
 * 全量拉取并写缓存。
 * @param deps - 服务依赖。
 * @param cache - 内存缓存。
 * @param workspaceRoot - 工作区根目录。
 * @returns 快照或失败。
 */
async function fetchAndCache(
  deps: SnapshotServiceDeps,
  cache: Map<string, CachedWorkspace>,
  workspaceRoot: string,
): Promise<RpcResult<WorkspaceSnapshot>> {
  const startedAt = deps.now()
  let kind: BackendKind | undefined

  try {
    const resolved = await deps.resolve(workspaceRoot)
    kind = resolved.kind
    const raw = await resolved.tracker.fetchSnapshot(workspaceRoot, SNAPSHOT_PAGE_SIZE)
    return await publish(deps, cache, workspaceRoot, resolved, raw, startedAt, 'full')
  } catch (error) {
    const mapped = mapSnapshotError(error)
    deps.log('warn', LOG_EVENTS.snapshot, {
      result: 'error',
      ...(kind === undefined ? {} : { backend: kind }),
      stage: SNAPSHOT_STAGES.list,
      code: mapped.code,
      durationMs: Math.max(0, deps.now() - startedAt),
    })
    return snapshotFailure(mapped.code, mapped.message)
  }
}

/**
 * 发布一次成功拉取的结果：写内存缓存、写本地快照库、返回快照。
 * @param deps - 服务依赖。
 * @param cache - 内存缓存。
 * @param workspaceRoot - 工作区根目录。
 * @param resolved - 解析出的后端。
 * @param raw - 后端返回的原始列表。
 * @param startedAt - 这次拉取的起始时刻。
 * @param mode - 这次是全量、增量还是扩窗。
 * @returns 快照。
 */
async function publish(
  deps: SnapshotServiceDeps,
  cache: Map<string, CachedWorkspace>,
  workspaceRoot: string,
  resolved: ResolvedBackend,
  raw: TrackerSnapshot,
  startedAt: number,
  mode: 'full' | 'incremental' | 'more',
): Promise<RpcResult<WorkspaceSnapshot>> {
  // 并发请求不能把窗口缩回去：保留更大的那一份，按工单引用去重后再裁剪。
  // 身份的「沿用」由调用方决定：全量刷新、增量与扩窗各自知道这次有没有查过身份。
  const repositoryHost = resolved.kind === 'markdown' ? null : (resolved.address?.host ?? null)
  const current = cache.get(workspaceRoot)
  const merged = mergePulled(current, raw)
  const tickets = withSkillActions(classifyTickets(merged.tickets, deps.labels), deps.labels)
  const resolver = resolved.tracker.resolveBlockers ?? null
  const finalized = resolver === null || !tickets.some((ticket) => ticket.state === 'open')
  const metrics = metricsOf(deps, resolved.kind, merged, tickets, finalized)
  const snapshot = buildSnapshot(
    resolved.kind,
    repositoryHost,
    merged,
    tickets,
    finalized,
    metrics,
    'live',
    false,
    null,
  )

  cache.set(workspaceRoot, {
    kind: resolved.kind,
    repositoryHost,
    raw: merged,
    snapshot,
    resolver,
    pending: null,
  })

  await writeStored(deps, workspaceRoot, resolved, merged)

  deps.log('info', LOG_EVENTS.snapshot, {
    result: 'ok',
    backend: resolved.kind,
    stage: SNAPSHOT_STAGES.list,
    durationMs: Math.max(0, deps.now() - startedAt),
    repository: snapshot.repository,
    loaded: snapshot.loaded,
    total: snapshot.total,
    mode,
  })
  return { ok: true, result: snapshot }
}

/**
 * 刷新失败时保留旧数据：把失败原因放进快照，界面据此说明「显示的是本地缓存」。
 * @param deps - 服务依赖。
 * @param cache - 内存缓存。
 * @param workspaceRoot - 工作区根目录。
 * @param mapped - 映射后的错误码与文案。
 * @param startedAt - 这次刷新的起始时刻。
 * @returns 有旧数据时返回带失败原因的快照，否则返回失败。
 */
async function keepOldSnapshot(
  deps: SnapshotServiceDeps,
  cache: Map<string, CachedWorkspace>,
  workspaceRoot: string,
  mapped: { readonly code: ErrorCode; readonly message: string },
  startedAt: number,
): Promise<RpcResult<WorkspaceSnapshot>> {
  const refreshError = { code: mapped.code, message: mapped.message }
  const cached = cache.get(workspaceRoot)
  if (cached !== undefined) {
    const snapshot: WorkspaceSnapshot = { ...cached.snapshot, stale: true, refreshError }
    cached.snapshot = snapshot
    deps.log('warn', LOG_EVENTS.snapshot, {
      result: 'error',
      backend: cached.kind,
      stage: SNAPSHOT_STAGES.list,
      code: mapped.code,
      durationMs: Math.max(0, deps.now() - startedAt),
    })
    return { ok: true, result: snapshot }
  }

  // 内存里还没有快照，但库里可能有：把库里的数据显示出来并说明刷新失败。
  const stored = await readStored(deps, workspaceRoot)
  if (stored === undefined) return snapshotFailure(mapped.code, mapped.message)

  const snapshot = buildStoredSnapshot(deps, stored, { stale: true, refreshError })
  cache.set(workspaceRoot, storedEntry(stored, null, snapshot))
  deps.log('warn', LOG_EVENTS.snapshot, {
    result: 'error',
    backend: stored.backend,
    stage: SNAPSHOT_STAGES.list,
    code: mapped.code,
    durationMs: Math.max(0, deps.now() - startedAt),
  })
  return { ok: true, result: snapshot }
}

/**
 * 补齐入口：没有缓存时先按 `snapshot.get` 的规则拉一次列表。
 * 命中缓存时同步登记进行中的补齐，保证并发调用共享同一个请求。
 */
function resolveBlockers(
  deps: SnapshotServiceDeps,
  cache: Map<string, CachedWorkspace>,
  loading: Map<string, Promise<RpcResult<WorkspaceSnapshot>>>,
  workspaceRoot: string,
): Promise<RpcResult<WorkspaceSnapshot>> {
  const cached = cache.get(workspaceRoot)
  if (cached !== undefined) return resolveCached(deps, cache, workspaceRoot, cached)

  return loadWorkspace(deps, cache, loading, workspaceRoot).then((result) => {
    if (!result.ok) return result
    const entry = cache.get(workspaceRoot)
    return entry === undefined ? result : resolveCached(deps, cache, workspaceRoot, entry)
  })
}

function resolveCached(
  deps: SnapshotServiceDeps,
  cache: Map<string, CachedWorkspace>,
  workspaceRoot: string,
  entry: CachedWorkspace,
): Promise<RpcResult<WorkspaceSnapshot>> {
  if (entry.snapshot.blockersFinalized || entry.resolver === null) {
    return Promise.resolve({ ok: true, result: entry.snapshot })
  }

  if (entry.pending !== null) return entry.pending

  const task = finalize(deps, cache, workspaceRoot, entry, entry.resolver)
  entry.pending = task
  return task
}

async function finalize(
  deps: SnapshotServiceDeps,
  cache: Map<string, CachedWorkspace>,
  workspaceRoot: string,
  entry: CachedWorkspace,
  resolver: BlockerResolver,
): Promise<RpcResult<WorkspaceSnapshot>> {
  const startedAt = deps.now()
  const targets: TicketReference[] = entry.snapshot.tickets
    .filter((ticket) => ticket.state === 'open')
    .map((ticket) => ({ ref: ticket.ref, number: ticket.number }))

  let settled: WorkspaceSnapshot
  let failure: { readonly code: ErrorCode; readonly message: string } | null = null

  try {
    const native = await resolver(workspaceRoot, targets)
    const tickets = withSkillActions(
      classifyTickets(mergeNativeBlockers(entry.raw.tickets, native), deps.labels),
      deps.labels,
    )
    const metrics = metricsOf(deps, entry.kind, entry.raw, tickets, true)
    settled = buildSnapshot(
      entry.kind,
      entry.repositoryHost,
      entry.raw,
      tickets,
      true,
      metrics,
      entry.snapshot.source,
      entry.snapshot.stale,
      entry.snapshot.refreshError,
    )
  } catch (error) {
    // 补齐失败只影响定稿标记：保留阶段一结果，下一次刷新重新尝试。
    failure = mapSnapshotError(error)
    settled = { ...entry.snapshot, blockersFinalized: true }
  }

  // 刷新会用新条目替换缓存；旧条目的结果不能再写回去。
  const current = cache.get(workspaceRoot)
  const stale = current !== entry
  if (!stale) {
    entry.snapshot = settled
    entry.pending = null
  }

  deps.log(failure === null ? 'info' : 'warn', LOG_EVENTS.snapshot, {
    result: failure === null ? 'ok' : 'error',
    backend: entry.kind,
    stage: SNAPSHOT_STAGES.blockers,
    ...(failure === null ? {} : { code: failure.code }),
    durationMs: Math.max(0, deps.now() - startedAt),
    ...(stale ? { stale: true } : {}),
  })
  // 旧调用方拿到的是它那一代快照的定稿结果；缓存里已经是新快照，不受影响。
  return { ok: true, result: settled }
}
