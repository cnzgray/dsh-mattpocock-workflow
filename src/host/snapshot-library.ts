/**
 * 本地快照库在宿主侧的那一半：读写条目、把库里的数据组装成快照、读取与清空缓存。
 *
 * 与快照服务分开是因为这里只关心「缓存里的数据」，不关心拉取流程：
 * 快照服务决定什么时候读、什么时候写，这里负责读出来的东西对不对。
 */
import type { SnapshotStore } from '../adapters/fs/snapshot-store.ts'
import { classifyTickets, type ClassifiedTicket } from '../core/classify.ts'
import { isRecord } from '../core/json.ts'
import { computeMetrics } from '../core/metrics.ts'
import type { RepositoryAddress } from '../core/remote.ts'
import { withSkillActions, type SkillActionDecision } from '../core/skill-action.ts'
import { SNAPSHOT_STORE_VERSION, type SnapshotStoreEntry } from '../core/snapshot-store.ts'
import type {
  BlockerResolution,
  TicketLabelNames,
  TicketReference,
  TrackerSnapshot,
} from '../core/ticket.ts'
import type { BackendKind } from '../protocol/backend.ts'
import { LOG_EVENTS, SNAPSHOT_STAGES } from '../protocol/log-events.ts'
import {
  ERROR_CODES,
  SNAPSHOT_CLEAR_CONFIRMATION,
  SNAPSHOT_PAGE_SIZE,
  type ErrorCode,
  type RpcResult,
  type SnapshotCacheInfo,
  type SnapshotMetrics,
  type SnapshotSource,
  type WorkspaceSnapshot,
} from '../protocol/tracker.ts'
import type { ResolvedBackend } from './backend-resolver.ts'
import type { LogSink } from './log.ts'

/** 快照库相关的宿主依赖。 */
export interface SnapshotLibraryDeps {
  readonly now: () => number
  readonly labels: TicketLabelNames
  readonly log: LogSink
  /** 本地快照库；没有它时只用内存缓存。 */
  readonly store?: SnapshotStore | undefined
}

/**
 * 一个工作区的缓存条目。刷新会用新条目替换旧条目；
 * 补齐结果靠条目身份判断是否过期，旧条目写不回缓存。
 */
export interface CachedWorkspace {
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

/** 原生阻塞补齐能力。 */
export type BlockerResolver = (
  workspaceRoot: string,
  tickets: readonly TicketReference[],
) => Promise<BlockerResolution>

/**
 * 读取本地快照库里的条目。
 * @param deps - 宿主依赖。
 * @param workspaceRoot - 工作区根目录。
 * @returns 条目；没有库或没有条目时是 undefined。
 */
export async function readStored(
  deps: SnapshotLibraryDeps,
  workspaceRoot: string,
): Promise<SnapshotStoreEntry | undefined> {
  if (deps.store === undefined) return undefined
  try {
    return await deps.store.read(workspaceRoot)
  } catch {
    return undefined
  }
}

/**
 * 删除本地快照库里的条目。
 * @param deps - 宿主依赖。
 * @param workspaceRoot - 工作区根目录。
 */
export async function removeStored(
  deps: SnapshotLibraryDeps,
  workspaceRoot: string,
): Promise<void> {
  if (deps.store === undefined) return
  try {
    await deps.store.remove(workspaceRoot)
  } catch {
    // 删不掉就留着：下一轮刷新会用仓库身份判定把它作废。
  }
}

/**
 * 把一次成功拉取写进本地快照库。
 * @param deps - 宿主依赖。
 * @param workspaceRoot - 工作区根目录。
 * @param resolved - 解析出的后端。
 * @param raw - 后端返回的原始列表。
 */
export async function writeStored(
  deps: SnapshotLibraryDeps,
  workspaceRoot: string,
  resolved: ResolvedBackend,
  raw: TrackerSnapshot,
): Promise<void> {
  const store = deps.store
  if (store === undefined) return
  const entry: SnapshotStoreEntry = {
    version: SNAPSHOT_STORE_VERSION,
    workspaceRoot,
    backend: resolved.kind,
    repository: raw.repository,
    repositoryKey: repositoryKey(resolved.kind, resolved.address),
    repositoryHost: resolved.kind === 'markdown' ? null : (resolved.address?.host ?? null),
    viewer: raw.viewer,
    fetchedAt: raw.fetchedAt,
    loaded: raw.tickets.length,
    total: raw.total,
    ...(raw.windowLimit === undefined ? {} : { windowLimit: raw.windowLimit }),
    tickets: raw.tickets,
  }
  try {
    await store.write(entry)
  } catch (error) {
    // 缓存写不进去不影响本次读取：面板照常有数据，只是下次没有缓存可用。
    deps.log('warn', LOG_EVENTS.snapshot, {
      result: 'error',
      backend: resolved.kind,
      stage: SNAPSHOT_STAGES.list,
      code: ERROR_CODES.internal,
      ...(error instanceof Error ? { reason: error.message } : {}),
    })
  }
}

/**
 * 把后端原始列表、判定结果与指标组装成界面快照。
 * @param kind - 后端类型。
 * @param repositoryHost - 实例主机；本地 Markdown 为 null。
 * @param raw - 后端返回的原始列表。
 * @param tickets - 附加了分类、状态与技能动作的工单。
 * @param blockersFinalized - 阻塞信息是否已定稿。
 * @param metrics - 项目指标。
 * @param source - 实时或缓存。
 * @param stale - 数据是否陈旧。
 * @param refreshError - 最近一次刷新失败原因。
 * @returns 界面快照。
 */
export function buildSnapshot(
  kind: BackendKind,
  repositoryHost: string | null,
  raw: TrackerSnapshot,
  tickets: readonly (ClassifiedTicket & SkillActionDecision)[],
  blockersFinalized: boolean,
  metrics: SnapshotMetrics,
  source: SnapshotSource,
  stale: boolean,
  refreshError: { readonly code: ErrorCode; readonly message: string } | null,
): WorkspaceSnapshot {
  return {
    backend: kind,
    repository: raw.repository,
    repositoryHost,
    viewer: raw.viewer,
    fetchedAt: raw.fetchedAt,
    loaded: tickets.length,
    total: raw.total,
    windowLimit: raw.windowLimit ?? tickets.length,
    blockersFinalized,
    metrics,
    source,
    stale,
    refreshError,
    tickets: tickets.map((ticket) => ({
      ref: ticket.ref,
      number: ticket.number,
      title: ticket.title,
      state: ticket.state,
      category: ticket.category,
      status: ticket.status,
      labels: ticket.labels,
      author: ticket.author,
      assignees: ticket.assignees,
      skillAction: ticket.skillAction,
      skillActionReason: ticket.skillActionReason,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      openBlockers: ticket.openBlockers,
      ...(ticket.closedAt === undefined ? {} : { closedAt: ticket.closedAt }),
      ...(ticket.url === undefined ? {} : { url: ticket.url }),
      ...(ticket.blockedBy === undefined ? {} : { blockedBy: ticket.blockedBy }),
    })),
  }
}

/**
 * 用库里的数据组装一份快照。
 * @param deps - 宿主依赖。
 * @param stored - 库里的条目。
 * @param state - 陈旧标记与失败原因。
 * @returns 快照。
 */
export function buildStoredSnapshot(
  deps: SnapshotLibraryDeps,
  stored: SnapshotStoreEntry,
  state: {
    readonly stale: boolean
    readonly refreshError: { readonly code: ErrorCode; readonly message: string } | null
  },
): WorkspaceSnapshot {
  const raw = rawOf(stored)
  const tickets = withSkillActions(classifyTickets(raw.tickets, deps.labels), deps.labels)
  const metrics = metricsOf(deps, stored.backend, raw, tickets, false)
  return {
    backend: stored.backend,
    repository: raw.repository,
    repositoryHost: stored.repositoryHost,
    viewer: raw.viewer,
    fetchedAt: raw.fetchedAt,
    loaded: tickets.length,
    total: raw.total,
    windowLimit: raw.windowLimit ?? SNAPSHOT_PAGE_SIZE,
    blockersFinalized: false,
    metrics,
    source: 'cache',
    stale: state.stale,
    refreshError: state.refreshError,
    tickets: tickets.map((ticket) => ({
      ref: ticket.ref,
      number: ticket.number,
      title: ticket.title,
      state: ticket.state,
      category: ticket.category,
      status: ticket.status,
      labels: ticket.labels,
      author: ticket.author,
      assignees: ticket.assignees,
      skillAction: ticket.skillAction,
      skillActionReason: ticket.skillActionReason,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      openBlockers: ticket.openBlockers,
      ...(ticket.closedAt === undefined ? {} : { closedAt: ticket.closedAt }),
      ...(ticket.url === undefined ? {} : { url: ticket.url }),
      ...(ticket.blockedBy === undefined ? {} : { blockedBy: ticket.blockedBy }),
    })),
  }
}

/**
 * 用库里的数据组装缓存条目。
 * @param stored - 库里的条目。
 * @param resolved - 解析出的后端；解析失败时为 null。
 * @param snapshot - 组装好的快照。
 * @returns 缓存条目。
 */
export function storedEntry(
  stored: SnapshotStoreEntry,
  resolved: ResolvedBackend | null,
  snapshot: WorkspaceSnapshot,
): CachedWorkspace {
  return {
    kind: stored.backend,
    repositoryHost: stored.repositoryHost,
    raw: rawOf(stored),
    snapshot,
    resolver: resolved?.tracker.resolveBlockers ?? null,
    pending: null,
  }
}

/**
 * 读取或清空本地快照库。
 * @param deps - 宿主依赖。
 * @param cache - 内存缓存；清空时一起丢掉。
 * @param params - 请求参数。
 * @returns 本地快照库的信息。
 */
export async function cacheInfo(
  deps: SnapshotLibraryDeps,
  cache: Map<string, CachedWorkspace>,
  params: unknown,
): Promise<RpcResult<SnapshotCacheInfo>> {
  const store = deps.store
  if (store === undefined) {
    return {
      ok: true,
      result: { location: '未启用本地快照库', entries: 0, lastWrittenAt: null, cleared: 0 },
    }
  }

  if (!isClearRequest(params)) {
    const entries = await store.list()
    return {
      ok: true,
      result: {
        location: store.location(),
        entries: entries.length,
        lastWrittenAt: latestWrite(entries),
        cleared: 0,
      },
    }
  }

  if (readConfirm(params) !== SNAPSHOT_CLEAR_CONFIRMATION) {
    return {
      ok: false,
      error: { code: ERROR_CODES.invalidParams, message: '清空本地快照库需要确认词。' },
    }
  }

  const cleared = await store.clear()
  // 内存里还留着旧快照：一起丢掉，下一次读取重新实时拉取。
  cache.clear()
  return {
    ok: true,
    result: { location: store.location(), entries: 0, lastWrittenAt: null, cleared },
  }
}

/**
 * 组装快照时计算指标。时钟取后端的快照时间，让指标与界面显示的“多久之前”一致。
 * 本地 Markdown 的时间是文件创建/修改时间，不是工单时间，时效与流量指标按不可用处理。
 */
export function metricsOf(
  deps: SnapshotLibraryDeps,
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

/**
 * 仓库身份：后端类型 + 实例主机 + 仓库路径。
 * 换远端或换后端时身份对不上，缓存作废。
 */
export function repositoryKey(kind: BackendKind, address: RepositoryAddress | undefined): string {
  if (address === undefined) return kind
  return `${kind}@${address.host}/${address.path}`
}

/** 把库里的条目还原成后端快照的形状。 */
function rawOf(stored: SnapshotStoreEntry): TrackerSnapshot {
  return {
    repository: stored.repository,
    fetchedAt: stored.fetchedAt,
    loaded: stored.tickets.length,
    total: stored.total,
    tickets: stored.tickets,
    viewer: stored.viewer,
    // 没有窗口字段的旧条目按首屏一页处理。
    windowLimit: stored.windowLimit ?? SNAPSHOT_PAGE_SIZE,
  }
}

/** 读出「清空」标记。 */
function isClearRequest(params: unknown): boolean {
  return isRecord(params) && params.clear === true
}

/** 读出确认词。 */
function readConfirm(params: unknown): string | undefined {
  if (!isRecord(params)) return undefined
  return typeof params.confirm === 'string' ? params.confirm : undefined
}

/** 最近一次写入时间；没有条目时是 null。 */
function latestWrite(entries: readonly SnapshotStoreEntry[]): number | null {
  let latest: number | null = null
  for (const entry of entries) {
    if (latest === null || entry.fetchedAt > latest) latest = entry.fetchedAt
  }
  return latest
}
