/**
 * 列表窗口的宿主侧规则：这次该请求多大的窗口、并发请求之间怎么合并。
 *
 * 单独成文件是因为快照服务已经到行数上限；这里只依赖 core 的合并函数与缓存条目。
 */
import { mergeTickets } from '../core/merge.ts'
import type { SnapshotStoreEntry } from '../core/snapshot-store.ts'
import type { TrackerSnapshot } from '../core/ticket.ts'
import { SNAPSHOT_MAX_WINDOW, SNAPSHOT_PAGE_SIZE } from '../protocol/tracker.ts'
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
