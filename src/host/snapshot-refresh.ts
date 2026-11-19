/**
 * 刷新流程的宿主侧逻辑：增量拉取、版本化回包与失败保留旧数据。
 *
 * 单独成文件是因为快照服务已经到行数上限；这里只依赖 core 的合并与判定、
 * 后端解析结果、缓存条目和存储接缝，发布与首屏读取仍由快照服务提供。
 */
import { classifyTickets } from '../core/classify.ts'
import { mergeTickets } from '../core/merge.ts'
import { withSkillActions } from '../core/skill-action.ts'
import type { SnapshotStoreEntry } from '../core/snapshot-store.ts'
import type { Ticket, TrackerChanges, TrackerSnapshot } from '../core/ticket.ts'
import type { BackendKind } from '../protocol/backend.ts'
import { LOG_EVENTS, SNAPSHOT_STAGES } from '../protocol/log-events.ts'
import {
  ERROR_CODES,
  SNAPSHOT_DELTA_MAX_ROWS,
  SNAPSHOT_PAGE_SIZE,
  type ErrorCode,
  type RpcResult,
  type SnapshotChanges,
  type SnapshotRefreshResult,
  type WorkspaceSnapshot,
} from '../protocol/tracker.ts'
import type { BackendResolver, ResolvedBackend } from './backend-resolver.ts'
import type { RefreshGuard } from './refresh-guard.ts'
import { mapSnapshotError } from './snapshot-error.ts'
import {
  buildStoredSnapshot,
  readStored,
  repositoryKey,
  storedEntry,
  toTicketSnapshot,
  type CachedWorkspace,
  type SnapshotLibraryDeps,
} from './snapshot-library.ts'
import { windowFor } from './snapshot-window.ts'

/**
 * 增量窗口向前重叠的时长。远端时钟偏移与最终一致性都可能让边界上的票漏掉，
 * 多取一点再按工单引用去重，比漏票安全。
 */
const INCREMENTAL_OVERLAP_MS = 60_000

/** 刷新发布能力：由快照服务注入，首屏、扩窗与刷新共用同一个发布流程。 */
export type RefreshPublish = (
  workspaceRoot: string,
  resolved: ResolvedBackend,
  raw: TrackerSnapshot,
  startedAt: number,
  mode: 'full' | 'incremental' | 'more',
  options?: { readonly skipWrite?: boolean; readonly versionFallback?: number | null },
) => Promise<RpcResult<WorkspaceSnapshot>>

/** 刷新流程用到的宿主能力。 */
export interface RefreshHost extends SnapshotLibraryDeps {
  readonly resolve: BackendResolver
  readonly cache: Map<string, CachedWorkspace>
  readonly publish: RefreshPublish
  /** 失败退避闸门：冷却期内的刷新不打后端，成功一次立刻归零。 */
  readonly guard: RefreshGuard
}

/**
 * 刷新：能用增量就增量，否则全量重拉；数据没变不升版本，变了按版本差回包。
 *
 * 增量以本地快照库里的数据为基准，窗口起点是上次成功拉取的时刻向前重叠一小段。
 * 增量被后端截断时退回全量，不把一份不完整的结果当成完整结果。
 * @param host - 宿主能力与发布入口。
 * @param workspaceRoot - 工作区根目录。
 * @param full - 为 true 时忽略本地快照库，全量重拉。
 * @param ifVersion - 界面持有的库版本；带上时按版本差回包。
 * @returns not-modified / 变化行 / 整份快照，或保留旧数据的失败回包。
 */
export async function refreshSnapshot(
  host: RefreshHost,
  workspaceRoot: string,
  full: boolean,
  ifVersion: number | undefined,
): Promise<RpcResult<SnapshotRefreshResult>> {
  const startedAt = host.now()

  // 连续失败后的冷却：不发后端，直接回本地缓存。冷却期内的反复刷新不延长冷却。
  // 手动全量刷新是人的动作，跳过冷却。
  if (!full) {
    const cooling = coolingReject(host, workspaceRoot, startedAt)
    if (cooling !== null) return cooling
  }

  /** 失败出口：记一次失败进闸门（限流错误带上服务端要求的等待），再保留旧数据回包。 */
  const failWith = (mapped: {
    readonly code: ErrorCode
    readonly message: string
    readonly retryAfterMs?: number
  }) => {
    // 冷却从这次尝试的起点算：单次拉取耗时远小于冷却步长，失败时刻取 startedAt 足够准。
    host.guard.noteFailure(workspaceRoot, startedAt, mapped.retryAfterMs)
    return keepOldSnapshot(host, workspaceRoot, mapped, startedAt)
  }

  let resolved: ResolvedBackend
  try {
    resolved = await host.resolve(workspaceRoot)
  } catch (error) {
    return failWith(mapSnapshotError(error))
  }

  const stored = await readStored(host, workspaceRoot)
  const base =
    stored?.repositoryKey === repositoryKey(resolved.kind, resolved.address) ? stored : undefined
  const tracker = resolved.tracker

  let raw: TrackerSnapshot | undefined
  let mode: 'full' | 'incremental' = 'full'
  if (
    base !== undefined &&
    !full &&
    tracker.fetchChanges !== undefined &&
    // 对账以「全量覆盖」为前提：窗口截断的后端看不到窗口外的删除。
    base.windowLimit === undefined
  ) {
    const outcome = await pullIncremental(host, workspaceRoot, resolved, base, startedAt)
    if (outcome.kind === 'failure') {
      return failWith(outcome.error)
    }
    if (outcome.kind === 'merged') {
      raw = outcome.raw
      mode = 'incremental'
    }
    // fallback（截断 / 总数不可用 / 层级漂移 / 删除漂移）→ 落到全量重拉。
  }

  if (raw === undefined) {
    try {
      const fetched = await tracker.fetchSnapshot(
        workspaceRoot,
        windowFor(host.cache.get(workspaceRoot), base),
      )
      // 身份查询抖动返回 null 时沿用同一仓库上一次已知的身份，不让筛选行整行消失。
      const current = host.cache.get(workspaceRoot)
      const hostName = resolved.kind === 'markdown' ? null : (resolved.address?.host ?? null)
      const sameRepository =
        current?.kind === resolved.kind &&
        current.repositoryHost === hostName &&
        current.raw.repository === fetched.repository
      const previousViewer = (sameRepository ? current.raw.viewer : null) ?? base?.viewer ?? null
      raw = fetched.viewer === null ? { ...fetched, viewer: previousViewer } : fetched
    } catch (error) {
      return failWith(mapSnapshotError(error))
    }
  }

  if (base !== undefined && !ticketsDiffer(base, raw)) {
    return respondUnchanged(host, workspaceRoot, resolved, base, raw, ifVersion, startedAt)
  }
  const published = await host.publish(workspaceRoot, resolved, raw, startedAt, mode)
  if (!published.ok) {
    host.guard.noteFailure(workspaceRoot, host.now())
    return published
  }
  host.guard.noteSuccess(workspaceRoot)
  return shapeDelta(host, workspaceRoot, published.result, ifVersion)
}

/**
 * 冷却检查：这个工作区还在退避冷却中时，返回保留旧数据的回包；否则返回 null。
 * @param host - 宿主依赖。
 * @param workspaceRoot - 工作区根目录。
 * @param startedAt - 这次刷新的起始时刻。
 */
function coolingReject(
  host: RefreshHost,
  workspaceRoot: string,
  startedAt: number,
): Promise<RpcResult<SnapshotRefreshResult>> | null {
  const coolingUntil = host.guard.blockedUntil(workspaceRoot, startedAt)
  if (coolingUntil === null) return null
  return keepOldSnapshot(
    host,
    workspaceRoot,
    {
      code: ERROR_CODES.fetchFailed,
      message: '刷新已暂停：连续失败后正在退避，稍后会自动恢复，显示的是本地缓存。',
    },
    startedAt,
  )
}

/** 增量拉取的结果：合并成功、退回全量或失败保留旧数据。 */
type IncrementalOutcome =
  | { readonly kind: 'merged'; readonly raw: TrackerSnapshot }
  | { readonly kind: 'fallback' }
  | {
      readonly kind: 'failure'
      readonly error: { readonly code: ErrorCode; readonly message: string }
    }

/**
 * 走一次增量拉取并合并出与全量等价的原始列表。
 * 截断、总数不可用、父子能力不一致或与合并结果漂移都退回全量，由调用方重拉。
 * @param host - 宿主依赖。
 * @param workspaceRoot - 工作区根目录。
 * @param resolved - 解析出的后端。
 * @param base - 库里的基准数据。
 * @param startedAt - 这次刷新的起始时刻。
 * @returns 合并结果。
 */
async function pullIncremental(
  host: RefreshHost,
  workspaceRoot: string,
  resolved: ResolvedBackend,
  base: SnapshotStoreEntry,
  startedAt: number,
): Promise<IncrementalOutcome> {
  const tracker = resolved.tracker
  if (tracker.fetchChanges === undefined) return { kind: 'fallback' }

  let changes: TrackerChanges
  try {
    changes = await tracker.fetchChanges(workspaceRoot, base.fetchedAt - INCREMENTAL_OVERLAP_MS)
  } catch (error) {
    const mapped = mapSnapshotError(error)
    return { kind: 'failure', error: mapped }
  }

  if (changes.truncated) {
    // 增量被截断：这份结果不完整，退回全量重拉。
    logIncrementalFallback(host, resolved.kind, 'truncated', startedAt)
    return { kind: 'fallback' }
  }

  // 权威总数缺失或不是非负整数：这份增量无法对账，当次退回全量，不沿用旧总数。
  const total = changes.total
  if (!Number.isInteger(total) || total < 0) {
    logIncrementalFallback(host, resolved.kind, 'invalid-total', startedAt)
    return { kind: 'fallback' }
  }

  // 父子能力与库里不一致时（例如上次是原生、这次层级查询失败），
  // 这份增量画不出与库一致的树，当次退回全量重拉。
  if (changes.hierarchy !== base.hierarchy) {
    logIncrementalFallback(host, resolved.kind, 'hierarchy', startedAt)
    return { kind: 'fallback' }
  }

  // 前置条件保证 base.windowLimit === undefined（上次拉取已覆盖全仓）：
  // 基准里窗口外没有票，合并不裁剪，全部保留。
  const merged = mergeTickets(base.tickets, changes.tickets)
  // 远端删除不产生变更记录：合并后票数超过权威总数，说明缓存里有已删除的票。
  // 增量看不出是哪一张，只能当次退回全量重拉，不发布、不写入不一致的结果。
  if (merged.length > total) {
    logIncrementalFallback(host, resolved.kind, 'drift', startedAt)
    return { kind: 'fallback' }
  }

  return {
    kind: 'merged',
    raw: {
      repository: base.repository,
      fetchedAt: host.now(),
      loaded: merged.length,
      total,
      hierarchy: base.hierarchy,
      tickets: merged,
      // 后端这次查了身份就用新值；没查（省略）时沿用基准数据里的身份。
      viewer: changes.viewer === undefined ? base.viewer : changes.viewer,
      windowLimit: Math.max(base.tickets.length, SNAPSHOT_PAGE_SIZE),
    },
  }
}

/**
 * 记录一次增量退让：截断、总数不可用或与合并结果漂移都走全量重拉，
 * 日志里保留原因，便于分清「后端没给全」与「远端删了票」。
 */
function logIncrementalFallback(
  deps: SnapshotLibraryDeps,
  backend: BackendKind,
  reason: 'truncated' | 'invalid-total' | 'drift' | 'hierarchy',
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

/** 这次拉取与库里的基准是否一致（只看票集合、总数与身份，时间不算）。 */
function ticketsDiffer(base: SnapshotStoreEntry, raw: TrackerSnapshot): boolean {
  if (base.total !== raw.total || base.viewer !== raw.viewer) return true
  return JSON.stringify(base.tickets) !== JSON.stringify(raw.tickets)
}

/**
 * 刷新回来数据与库里一致：不写入、不升版本，按界面持有的版本回包。
 * 没带版本（或版本对不上且日志覆盖不到）时回整份；版本一致回 not-modified；
 * 版本落后时从变化日志回净变化。
 * @param host - 宿主能力与发布入口。
 * @param workspaceRoot - 工作区根目录。
 * @param resolved - 解析出的后端。
 * @param base - 库里的基准条目。
 * @param raw - 这次拉到的原始列表（与基准一致）。
 * @param ifVersion - 界面持有的库版本。
 * @param startedAt - 这次刷新的起始时刻。
 * @returns 刷新回包。
 */
async function respondUnchanged(
  host: RefreshHost,
  workspaceRoot: string,
  resolved: ResolvedBackend,
  base: SnapshotStoreEntry,
  raw: TrackerSnapshot,
  ifVersion: number | undefined,
  startedAt: number,
): Promise<RpcResult<SnapshotRefreshResult>> {
  if (ifVersion !== undefined && ifVersion === base.libraryVersion) {
    host.guard.noteSuccess(workspaceRoot)
    return {
      ok: true,
      result: { kind: 'not-modified', version: base.libraryVersion, checkedAt: host.now() },
    }
  }

  if (ifVersion !== undefined && ifVersion < base.libraryVersion) {
    const changes = await host.store?.changesSince(workspaceRoot, ifVersion)
    if (changes !== undefined) {
      const delta = buildDelta(host, base.libraryVersion, raw.fetchedAt, changes, base)
      if (delta !== undefined) {
        host.guard.noteSuccess(workspaceRoot)
        return { ok: true, result: delta }
      }
    }
  }

  // 回整份：像发布一样组装快照，只是不写库、版本沿用基准。
  const published = await host.publish(workspaceRoot, resolved, raw, startedAt, 'full', {
    skipWrite: true,
    versionFallback: base.libraryVersion,
  })
  if (!published.ok) {
    host.guard.noteFailure(workspaceRoot, host.now())
    return published
  }
  host.guard.noteSuccess(workspaceRoot)
  return { ok: true, result: { kind: 'full', snapshot: published.result } }
}

/**
 * 发布成功后按界面持有的版本把整份快照收成增量回包。
 * 没带版本、没有库、版本差超出日志覆盖或变化行超上限时回整份。
 * @param host - 宿主依赖。
 * @param workspaceRoot - 工作区根目录。
 * @param snapshot - 刚发布的完整快照。
 * @param ifVersion - 界面持有的库版本。
 * @returns 刷新回包。
 */
async function shapeDelta(
  host: RefreshHost,
  workspaceRoot: string,
  snapshot: WorkspaceSnapshot,
  ifVersion: number | undefined,
): Promise<RpcResult<SnapshotRefreshResult>> {
  const full: SnapshotRefreshResult = { kind: 'full', snapshot }
  if (ifVersion === undefined || snapshot.libraryVersion === null) return { ok: true, result: full }
  if (ifVersion === snapshot.libraryVersion) return { ok: true, result: full }

  const changes = await host.store?.changesSince(workspaceRoot, ifVersion)
  if (changes === undefined) return { ok: true, result: full }
  const delta = buildDelta(
    host,
    snapshot.libraryVersion,
    snapshot.fetchedAt,
    changes,
    undefined,
    snapshot,
  )
  if (delta === undefined) return { ok: true, result: full }
  return { ok: true, result: delta }
}

/**
 * 把变化日志的净变化组装成增量回包。
 * @param host - 宿主依赖。
 * @param version - 目标库版本。
 * @param fetchedAt - 这次刷新的完成时刻。
 * @param changes - 日志读出的净变化。
 * @param base - 基准条目（未发布路径）；与 snapshot 二选一。
 * @param snapshot - 刚发布的完整快照（已发布路径）。
 * @returns 变化行回包；变化行超上限时返回 undefined，调用方回退整份。
 */
function buildDelta(
  host: RefreshHost,
  version: number,
  fetchedAt: number,
  changes: { readonly tickets: readonly Ticket[]; readonly removed: readonly string[] },
  base: SnapshotStoreEntry | undefined,
  snapshot?: WorkspaceSnapshot,
): SnapshotChanges | undefined {
  if (changes.tickets.length + changes.removed.length > SNAPSHOT_DELTA_MAX_ROWS) return undefined

  const metrics = snapshot?.metrics ?? base?.metrics
  const viewer = snapshot?.viewer ?? base?.viewer ?? null
  const total = snapshot?.total ?? base?.total ?? 0
  const loaded = snapshot?.loaded ?? base?.tickets.length ?? 0
  const windowLimit = snapshot?.windowLimit ?? base?.windowLimit ?? SNAPSHOT_PAGE_SIZE
  if (metrics === undefined) return undefined

  const rows = withSkillActions(classifyTickets(changes.tickets, host.labels), host.labels).map(
    toTicketSnapshot,
  )
  const anyOpen = base?.tickets.some((ticket) => ticket.state === 'open') ?? false
  const blockersFinalized = snapshot?.blockersFinalized ?? !anyOpen
  return {
    kind: 'changes',
    version,
    fetchedAt,
    tickets: rows,
    removed: changes.removed,
    metrics,
    viewer,
    total,
    loaded,
    windowLimit,
    blockersFinalized,
  }
}

/**
 * 刷新失败时保留旧数据：把失败原因放进快照，界面据此说明「显示的是本地缓存」。
 * @param host - 宿主依赖。
 * @param workspaceRoot - 工作区根目录。
 * @param mapped - 映射后的错误码与文案。
 * @param startedAt - 这次刷新的起始时刻。
 * @returns 有旧数据时返回带失败原因的整份回包，否则返回失败。
 */
export async function keepOldSnapshot(
  host: RefreshHost,
  workspaceRoot: string,
  mapped: { readonly code: ErrorCode; readonly message: string },
  startedAt: number,
): Promise<RpcResult<SnapshotRefreshResult>> {
  const refreshError = { code: mapped.code, message: mapped.message }
  const cached = host.cache.get(workspaceRoot)
  if (cached !== undefined) {
    const snapshot: WorkspaceSnapshot = { ...cached.snapshot, stale: true, refreshError }
    cached.snapshot = snapshot
    host.log('warn', LOG_EVENTS.snapshot, {
      result: 'error',
      backend: cached.kind,
      stage: SNAPSHOT_STAGES.list,
      code: mapped.code,
      durationMs: Math.max(0, host.now() - startedAt),
    })
    return { ok: true, result: { kind: 'full', snapshot } }
  }

  // 内存里还没有快照，但库里可能有：把库里的数据显示出来并说明刷新失败。
  const stored = await readStored(host, workspaceRoot)
  if (stored === undefined) return { ok: false, error: refreshError }

  const snapshot = buildStoredSnapshot(host, stored, { stale: true, refreshError })
  host.cache.set(workspaceRoot, storedEntry(stored, null, snapshot))
  host.log('warn', LOG_EVENTS.snapshot, {
    result: 'error',
    backend: stored.backend,
    stage: SNAPSHOT_STAGES.list,
    code: mapped.code,
    durationMs: Math.max(0, host.now() - startedAt),
  })
  return { ok: true, result: { kind: 'full', snapshot } }
}
