/**
 * 快照服务：缓存、刷新、阻塞补齐与错误映射。主接缝是 `handle(method, params)`，
 * 测试注入假的「按工作区解析后端」函数就能覆盖缓存、错误码和刷新失败保留旧快照。
 *
 * 读取分两个阶段：
 * 1. 列表：后端返回列表即生成快照；GitHub 的原生阻塞数在同一次查询里取回，
 *    其余后端的阻塞数先按描述回退；
 * 2. 补齐：仅当后端实现 `resolveBlockers` 时读取原生阻塞数，合并后写回缓存。
 * 补齐按工作区去重；刷新替换缓存条目，旧的补齐结果不会覆盖新快照。
 */
import { mergeNativeBlockers } from '../core/blockers.ts'
import { classifyTickets, type ClassifiedTicket } from '../core/classify.ts'
import { computeMetrics } from '../core/metrics.ts'
import { withSkillActions, type SkillActionDecision } from '../core/skill-action.ts'
import type {
  BlockerResolution,
  TicketLabelNames,
  TicketReference,
  TrackerSnapshot,
} from '../core/ticket.ts'
import { TrackerError } from '../core/tracker-error.ts'
import type { BackendKind } from '../protocol/backend.ts'
import { LOG_EVENTS, SNAPSHOT_STAGES } from '../protocol/log-events.ts'
import {
  ERROR_CODES,
  RPC_METHODS,
  type ErrorCode,
  type RpcResult,
  type SnapshotMetrics,
  type WorkspaceSnapshot,
} from '../protocol/tracker.ts'
import type { BackendResolver } from './backend-resolver.ts'
import type { LogSink } from './log.ts'
import { readWorkspaceRoot } from './rpc-params.ts'

/** 快照服务依赖。 */
export interface SnapshotServiceDeps {
  /** 按工作区解析后端；解析结果由宿主自己缓存。 */
  readonly resolve: BackendResolver
  readonly now: () => number
  readonly labels: TicketLabelNames
  readonly log: LogSink
}

/** 宿主对界面的唯一 RPC 入口。 */
export interface SnapshotService {
  /**
   * 处理一个 RPC 方法。
   * @param method - 三个快照方法之一。
   * @param params - `{ workspaceRoot }`。
   * @returns 成功快照或带错误码的失败。
   */
  handle(method: string, params: unknown): Promise<RpcResult<WorkspaceSnapshot>>
}

/**
 * 一个工作区的缓存条目。刷新会用新条目替换旧条目；
 * 补齐结果靠条目身份判断是否过期，旧条目写不回缓存。
 */
interface CachedWorkspace {
  readonly kind: BackendKind
  /** 远端实例主机；列表与补齐两阶段共用同一份，本地 Markdown 为 null。 */
  readonly repositoryHost: string | null
  /** 后端的原始列表，补齐后按它重新判定，避免丢失标签。 */
  readonly raw: TrackerSnapshot
  snapshot: WorkspaceSnapshot
  /** 原生阻塞补齐能力；null 表示后端不实现，列表阶段已经定稿。 */
  readonly resolver: BlockerResolver | null
  pending: Promise<RpcResult<WorkspaceSnapshot>> | null
}

type BlockerResolver = (
  workspaceRoot: string,
  tickets: readonly TicketReference[],
) => Promise<BlockerResolution>

/**
 * 创建按工作区根目录缓存的快照服务。
 * @param deps - 工单后端、时钟、标签名与日志出口。
 * @returns 快照服务。
 */
export function createSnapshotService(deps: SnapshotServiceDeps): SnapshotService {
  const cache = new Map<string, CachedWorkspace>()
  // 冷启动时两个面板会同时请求：共享同一次列表拉取，后续补齐才能挂到同一条缓存上。
  const loading = new Map<string, Promise<RpcResult<WorkspaceSnapshot>>>()

  return {
    handle(method, params) {
      if (!isSnapshotMethod(method)) {
        return Promise.resolve(failure(ERROR_CODES.unknownMethod, `未知方法：${method}`))
      }

      const workspaceRoot = readWorkspaceRoot(params)
      if (workspaceRoot === undefined) {
        return Promise.resolve(
          failure(ERROR_CODES.invalidParams, '缺少非空的 workspaceRoot 参数。'),
        )
      }

      if (method === RPC_METHODS.snapshotGet) {
        const cached = cache.get(workspaceRoot)
        if (cached !== undefined) return Promise.resolve({ ok: true, result: cached.snapshot })
        return loadWorkspace(deps, cache, loading, workspaceRoot)
      }

      if (method === RPC_METHODS.snapshotResolveBlockers) {
        return resolveBlockers(deps, cache, loading, workspaceRoot)
      }

      return fetchAndCache(deps, cache, workspaceRoot)
    },
  }
}

function isSnapshotMethod(method: string): boolean {
  return (
    method === RPC_METHODS.snapshotGet ||
    method === RPC_METHODS.snapshotRefresh ||
    method === RPC_METHODS.snapshotResolveBlockers
  )
}

function loadWorkspace(
  deps: SnapshotServiceDeps,
  cache: Map<string, CachedWorkspace>,
  loading: Map<string, Promise<RpcResult<WorkspaceSnapshot>>>,
  workspaceRoot: string,
): Promise<RpcResult<WorkspaceSnapshot>> {
  const running = loading.get(workspaceRoot)
  if (running !== undefined) return running

  const task = fetchAndCache(deps, cache, workspaceRoot)
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
    const raw = await resolved.tracker.fetchSnapshot(workspaceRoot)
    const tickets = withSkillActions(classifyTickets(raw.tickets, deps.labels), deps.labels)
    const resolver = resolved.tracker.resolveBlockers ?? null
    const repositoryHost = resolved.kind === 'markdown' ? null : (resolved.address?.host ?? null)
    const finalized = resolver === null || !tickets.some((ticket) => ticket.state === 'open')
    const metrics = metricsOf(deps, resolved.kind, raw, tickets, finalized)
    const snapshot = buildSnapshot(resolved.kind, repositoryHost, raw, tickets, finalized, metrics)

    cache.set(workspaceRoot, {
      kind: resolved.kind,
      repositoryHost,
      raw,
      snapshot,
      resolver,
      pending: null,
    })
    deps.log('info', LOG_EVENTS.snapshot, {
      result: 'ok',
      backend: resolved.kind,
      stage: SNAPSHOT_STAGES.list,
      durationMs: Math.max(0, deps.now() - startedAt),
      repository: snapshot.repository,
      loaded: snapshot.loaded,
      total: snapshot.total,
    })
    return { ok: true, result: snapshot }
  } catch (error) {
    const mapped = mapError(error)
    deps.log('warn', LOG_EVENTS.snapshot, {
      result: 'error',
      ...(kind === undefined ? {} : { backend: kind }),
      stage: SNAPSHOT_STAGES.list,
      code: mapped.code,
      durationMs: Math.max(0, deps.now() - startedAt),
    })
    return failure(mapped.code, mapped.message)
  }
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
    settled = buildSnapshot(entry.kind, entry.repositoryHost, entry.raw, tickets, true, metrics)
  } catch (error) {
    // 补齐失败只影响定稿标记：保留阶段一结果，下一次刷新重新尝试。
    failure = mapError(error)
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

function buildSnapshot(
  kind: BackendKind,
  repositoryHost: string | null,
  raw: TrackerSnapshot,
  tickets: readonly (ClassifiedTicket & SkillActionDecision)[],
  blockersFinalized: boolean,
  metrics: SnapshotMetrics,
): WorkspaceSnapshot {
  return {
    backend: kind,
    repository: raw.repository,
    repositoryHost,
    fetchedAt: raw.fetchedAt,
    loaded: tickets.length,
    total: raw.total,
    blockersFinalized,
    metrics,
    tickets: tickets.map((ticket) => ({
      ref: ticket.ref,
      number: ticket.number,
      title: ticket.title,
      state: ticket.state,
      category: ticket.category,
      status: ticket.status,
      skillAction: ticket.skillAction,
      skillActionReason: ticket.skillActionReason,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      openBlockers: ticket.openBlockers,
      ...(ticket.closedAt === undefined ? {} : { closedAt: ticket.closedAt }),
      ...(ticket.blockedBy === undefined ? {} : { blockedBy: ticket.blockedBy }),
    })),
  }
}

/**
 * 组装快照时计算指标。时钟取后端的快照时间，让指标与界面显示的“多久之前”一致。
 * 本地 Markdown 的时间是文件创建/修改时间，不是工单时间，时效与流量指标按不可用处理。
 */
function metricsOf(
  deps: SnapshotServiceDeps,
  kind: BackendKind,
  raw: TrackerSnapshot,
  tickets: readonly ClassifiedTicket[],
  blockersFinalized: boolean,
): SnapshotMetrics {
  return computeMetrics({
    tickets,
    total: raw.total,
    now: raw.fetchedAt,
    timestamps: kind !== 'markdown',
    blockersFinalized,
    labels: deps.labels,
  })
}

function mapError(error: unknown): { readonly code: ErrorCode; readonly message: string } {
  if (error instanceof TrackerError) {
    return { code: error.code, message: error.message }
  }
  return { code: ERROR_CODES.internal, message: '读取工单时发生未预期的错误。' }
}

function failure(code: ErrorCode, message: string): RpcResult<WorkspaceSnapshot> {
  return { ok: false, error: { code, message } }
}
