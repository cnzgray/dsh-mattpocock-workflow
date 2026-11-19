/**
 * 详情缓存：按工作区 + 票引用缓存已取回的工单详情，再次进入看过的票时秒开。
 *
 * 有效性用列表快照里的 `updatedAt` 判定：与缓存时一致说明票没变，不发请求；
 * 不一致时先显示缓存、后台静默拉新。改票成功后写入的新详情自然成为新基准。
 * 缓存在内存里，宿主重启即清空——冷启动至多一次取数，与列表的本地快照库分工不同。
 */

import type { TicketDetail } from '../protocol/tracker.ts'

/** 每个工作区最多缓存多少张票的详情。 */
const DETAIL_CACHE_PER_WORKSPACE = 100

/** 最多保留多少个工作区的详情缓存。 */
const DETAIL_CACHE_WORKSPACES = 5

interface CachedDetail {
  readonly detail: TicketDetail
  /** 取回详情时这张票的更新时间：与列表快照一致即视为没变。 */
  readonly updatedAt: string
}

/** 缓存决策：命中且列表时间未变是 'hit'；有缓存但已变是 'stale'；没有是 'miss'。 */
export function detailCacheDecision(
  hit: CachedDetail | null,
  currentUpdatedAt: string | undefined,
): 'hit' | 'stale' | 'miss' {
  if (hit !== null && currentUpdatedAt !== undefined && hit.updatedAt === currentUpdatedAt) {
    return 'hit'
  }
  return hit !== null ? 'stale' : 'miss'
}

// 模块级缓存：面板常驻，跨组件复用；工作区是最外层键，避免串库。
const caches = new Map<string, Map<string, CachedDetail>>()

/**
 * 读缓存；没有时是 null。
 * @param workspaceRoot - 工作区根目录。
 * @param ref - 工单引用。
 * @returns 缓存的详情与它的更新时间。
 */
export function readDetailCache(workspaceRoot: string, ref: string): CachedDetail | null {
  return caches.get(workspaceRoot)?.get(ref) ?? null
}

/**
 * 写入（或覆盖）一张票的详情，并按上限淘汰最旧的条目。
 * @param workspaceRoot - 工作区根目录。
 * @param detail - 刚取回或刚改完的详情。
 */
export function writeDetailCache(workspaceRoot: string, detail: TicketDetail): void {
  let cache = caches.get(workspaceRoot)
  if (cache === undefined) {
    // 超出工作区上限时淘汰最久没动过的那个工作区。
    while (caches.size >= DETAIL_CACHE_WORKSPACES) {
      const oldest = caches.keys().next().value
      if (oldest === undefined) break
      caches.delete(oldest)
    }
    cache = new Map()
    caches.set(workspaceRoot, cache)
  }
  // 重新插入刷新顺序，超上限淘汰最旧的票。
  cache.delete(detail.ref)
  cache.set(detail.ref, { detail, updatedAt: detail.updatedAt })
  while (cache.size > DETAIL_CACHE_PER_WORKSPACE) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/** 清空详情缓存；省略工作区时全部清空（测试与切工作区时用）。 */
export function clearDetailCache(workspaceRoot?: string): void {
  if (workspaceRoot === undefined) caches.clear()
  else caches.delete(workspaceRoot)
}
