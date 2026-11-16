/**
 * 列表窗口的宿主侧逻辑：这次该请求多大的窗口、并发请求之间怎么合并、
 * 滚动到底时怎么扩一页。
 *
 * 单独成文件是因为快照服务已经到行数上限；这里只依赖 core 的合并函数、
 * 后端解析结果与缓存条目，首屏读取与发布仍由快照服务提供。
 */
import { mergeTickets } from '../core/merge.ts'
import type { SnapshotStoreEntry } from '../core/snapshot-store.ts'
import type { TrackerSnapshot } from '../core/ticket.ts'
import type { BackendKind } from '../protocol/backend.ts'
import { LOG_EVENTS, SNAPSHOT_STAGES } from '../protocol/log-events.ts'
import {
  SNAPSHOT_MAX_WINDOW,
  SNAPSHOT_PAGE_SIZE,
  type RpcResult,
  type WorkspaceSnapshot,
} from '../protocol/tracker.ts'
import type { BackendResolver, ResolvedBackend } from './backend-resolver.ts'
import type { LogSink } from './log.ts'
import { mapSnapshotError, snapshotFailure } from './snapshot-error.ts'
import type { CachedWorkspace } from './snapshot-library.ts'

/**
 * 这次拉取该请求多大的窗口：内存与本地库取较大者，首次读到旧条目时按一页处理。
 * 全量刷新沿用当前窗口，不把用户已经加载的列表缩回首屏。
 * @param current - 内存里的缓存条目；没有时为 undefined。
 * @param base - 本地快照库里的条目；没有或仓库身份不符时为 undefined。
 * @returns 窗口大小。
 */
export function windowFor(
  current: CachedWorkspace | undefined,
  base: SnapshotStoreEntry | undefined,
): number {
  const cached = current?.raw.windowLimit ?? 0
  const stored = base?.windowLimit ?? 0
  const loaded = current?.raw.tickets.length ?? 0
  return Math.min(SNAPSHOT_MAX_WINDOW, Math.max(cached, stored, loaded, SNAPSHOT_PAGE_SIZE))
}

/**
 * 把这次拉到的列表并入已有窗口。
 *
 * 已有窗口更大、或这次拉回来的票比当前少时，先合并再裁剪：
 * 并发扩窗、扩窗与刷新交叠、后端少给一页，都不能把用户已经加载的票丢掉。
 * @param current - 当前缓存条目；没有或换了仓库时直接用这次的结果。
 * @param raw - 这次拉到的列表。
 * @returns 合并后的原始列表。
 */
export function mergePulled(
  current: CachedWorkspace | undefined,
  raw: TrackerSnapshot,
): TrackerSnapshot {
  // 换远端后缓存里还是上一个仓库的票，不能并进来。
  if (current === undefined) return raw
  if (current.raw.repository !== raw.repository) return raw

  const existingWindow = current.raw.windowLimit ?? current.raw.tickets.length
  const pulledWindow = raw.windowLimit ?? raw.tickets.length
  const window = Math.max(existingWindow, pulledWindow)
  const shrunk = raw.tickets.length < current.raw.tickets.length
  if (!shrunk && window <= pulledWindow) return raw

  const tickets = mergeTickets(current.raw.tickets, raw.tickets, window)
  return { ...raw, loaded: tickets.length, tickets, windowLimit: window }
}

/**
 * 扩窗要用到的宿主能力：首屏读取与发布由快照服务注入，
 * 这里只负责「还有空间吗、请求多大、失败怎么回」。
 */
export interface MoreHost {
  readonly resolve: BackendResolver
  readonly now: () => number
  readonly log: LogSink
  readonly cache: Map<string, CachedWorkspace>
  /** 读当前快照；内存里没有时由快照服务先走一次首屏读取。 */
  readonly getSnapshot: (workspaceRoot: string) => Promise<RpcResult<WorkspaceSnapshot>>
  /** 发布一次成功拉取：写缓存、写本地库、重算指标。 */
  readonly publish: (
    workspaceRoot: string,
    resolved: ResolvedBackend,
    raw: TrackerSnapshot,
    startedAt: number,
  ) => Promise<RpcResult<WorkspaceSnapshot>>
}

/**
 * 扩窗：向后再要一页，并入当前快照后返回完整快照。
 *
 * 宿主是唯一合并点：新页与当前快照按工单引用去重、按更新时间倒序、裁到新窗口，
 * 重算指标并写入本地快照库。已经覆盖全部工单或到窗口上限时不再请求。
 * @param host - 宿主能力。
 * @param workspaceRoot - 工作区根目录。
 * @returns 合并后的快照；失败时带错误码，界面保留现有列表。
 */
export async function loadMore(
  host: MoreHost,
  workspaceRoot: string,
): Promise<RpcResult<WorkspaceSnapshot>> {
  const initial = await host.getSnapshot(workspaceRoot)
  if (!initial.ok) return initial

  const entry = host.cache.get(workspaceRoot)
  if (entry === undefined) return initial

  const windowLimit = entry.raw.windowLimit ?? SNAPSHOT_PAGE_SIZE
  if (entry.raw.tickets.length >= entry.raw.total || windowLimit >= SNAPSHOT_MAX_WINDOW) {
    return { ok: true, result: entry.snapshot }
  }

  const nextWindow = Math.min(windowLimit + SNAPSHOT_PAGE_SIZE, SNAPSHOT_MAX_WINDOW)
  const startedAt = host.now()
  let kind: BackendKind | undefined

  try {
    const resolved = await host.resolve(workspaceRoot)
    kind = resolved.kind
    const raw = await resolved.tracker.fetchSnapshot(workspaceRoot, nextWindow)
    // 扩窗响应没带身份时沿用当前快照的身份；同一个工作区里仓库没换才沿用。
    const viewer = raw.viewer ?? (entry.raw.repository === raw.repository ? entry.raw.viewer : null)
    return await host.publish(
      workspaceRoot,
      resolved,
      { ...raw, viewer, windowLimit: nextWindow },
      startedAt,
    )
  } catch (error) {
    const mapped = mapSnapshotError(error)
    host.log('warn', LOG_EVENTS.snapshot, {
      result: 'error',
      ...(kind === undefined ? {} : { backend: kind }),
      stage: SNAPSHOT_STAGES.list,
      code: mapped.code,
      durationMs: Math.max(0, host.now() - startedAt),
    })
    return snapshotFailure(mapped.code, mapped.message)
  }
}
