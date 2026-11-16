/**
 * 父子布局的树构建。纯函数：输入已经按当前筛选与排序排好的可见票、
 * 折叠集合与定位票，输出要渲染的行；不读快照、不发请求、不碰 React。
 *
 * 只有父级能在可见票里找到时才嵌套；父级缺失、跨仓库、epic、被筛掉或还没加载
 * 的票都升到顶层并标记 `parentOutside`，不伪造父行。循环与自引用把环上的票
 * 提升为顶层，不丢票、不递归。
 */
import type { TicketSnapshot } from '../protocol/tracker.ts'

/** 一行树节点的渲染信息。 */
export interface TreeRow {
  readonly ticket: TicketSnapshot
  /** 嵌套层级；顶层为 0。 */
  readonly depth: number
  /** 是否有可见的直接子票。 */
  readonly hasChildren: boolean
  /** 这棵子树是否展开；叶子为 true。 */
  readonly expanded: boolean
  /** 当前可见树里挂在这张票下的全部后代数量（含多层）。 */
  readonly childCount: number
  /** 父级引用存在，但父级不在当前可见票里。 */
  readonly parentOutside: boolean
}

/**
 * 构建父子布局的渲染行。
 * @param tickets - 已筛选、已排序的可见票。
 * @param collapsed - 被收起的父票引用集合。
 * @param focusRef - 从概览定位的票；它的祖先链强制展开，不影响折叠状态本身。
 * @returns 按可见顺序展开的行；折叠的子树不产生行。
 */
export function buildTicketTree(
  tickets: readonly TicketSnapshot[],
  collapsed: ReadonlySet<string>,
  focusRef: string | null = null,
): readonly TreeRow[] {
  const byRef = new Map(tickets.map((ticket) => [ticket.ref, ticket]))
  const roots = forcedRootsOf(tickets, byRef)
  const children = childrenOf(tickets, roots)
  const effectiveCollapsed =
    focusRef === null ? collapsed : expandAncestors(tickets, collapsed, focusRef)
  const rows: TreeRow[] = []

  const emit = (ticket: TicketSnapshot, depth: number): void => {
    const kids = children.get(ticket.ref) ?? []
    const expanded = kids.length === 0 || !effectiveCollapsed.has(ticket.ref)

    rows.push({
      ticket,
      depth,
      hasChildren: kids.length > 0,
      expanded,
      childCount: descendantsOf(ticket.ref, children),
      parentOutside: ticket.parent !== undefined && !byRef.has(ticket.parent),
    })
    if (!expanded) return
    for (const kid of kids) emit(kid, depth + 1)
  }

  for (const ticket of tickets) {
    if (roots.has(ticket.ref)) emit(ticket, 0)
  }
  return rows
}

/**
 * 定位一张票时展开它的祖先链：从折叠集合里去掉所有可见祖先。
 * 已经全展开时返回原集合，避免无意义的状态更新。
 * @param tickets - 当前可见票。
 * @param collapsed - 当前折叠集合。
 * @param focusRef - 要定位的票。
 * @returns 展开祖先后的折叠集合。
 */
export function expandAncestors(
  tickets: readonly TicketSnapshot[],
  collapsed: ReadonlySet<string>,
  focusRef: string,
): ReadonlySet<string> {
  const byRef = new Map(tickets.map((ticket) => [ticket.ref, ticket]))
  const ancestors = ancestorRefs(byRef, focusRef)
  let changed = false
  const next = new Set(collapsed)
  for (const ref of ancestors) {
    if (!next.delete(ref)) continue
    changed = true
  }
  return changed ? next : collapsed
}

/**
 * 必须作为顶层行出现的票：没有父级、父级不在可见票里、自引用，或在环上。
 * @param tickets - 当前可见票。
 * @param byRef - 引用索引。
 * @returns 顶层票引用集合。
 */
function forcedRootsOf(
  tickets: readonly TicketSnapshot[],
  byRef: ReadonlyMap<string, TicketSnapshot>,
): ReadonlySet<string> {
  const roots = new Set<string>()
  for (const ticket of tickets) {
    const parent = ticket.parent
    if (
      parent === undefined ||
      parent === ticket.ref ||
      !byRef.has(parent) ||
      isCycleMember(ticket.ref, byRef)
    ) {
      roots.add(ticket.ref)
    }
  }
  return roots
}

/**
 * 判断一张票是否在父子环上。只是「祖先里有环、自己不在环上」的票仍挂在父票下，
 * 不能被误提升为顶层。
 * @param ref - 要判断的票引用。
 * @param byRef - 引用索引。
 * @returns 在环上时为 true。
 */
function isCycleMember(ref: string, byRef: ReadonlyMap<string, TicketSnapshot>): boolean {
  const path: string[] = []
  const positions = new Map<string, number>()
  let current: string | undefined = ref

  while (current !== undefined) {
    const at = positions.get(current)
    if (at !== undefined) return path.slice(at).includes(ref)
    positions.set(current, path.length)
    path.push(current)

    const parent: string | undefined = byRef.get(current)?.parent
    current = parent !== undefined && byRef.has(parent) ? parent : undefined
  }
  return false
}

/**
 * 只保留非顶层票的父级边：环上的票已经被提升为顶层，不能再作为别的环成员的孩子，
 * 否则同一张票会出现两次。
 * @param tickets - 当前可见票。
 * @param roots - 顶层票引用集合。
 * @returns 父级引用 → 子票（保持输入顺序）。
 */
function childrenOf(
  tickets: readonly TicketSnapshot[],
  roots: ReadonlySet<string>,
): ReadonlyMap<string, readonly TicketSnapshot[]> {
  const children = new Map<string, TicketSnapshot[]>()
  for (const ticket of tickets) {
    if (roots.has(ticket.ref) || ticket.parent === undefined) continue
    const siblings = children.get(ticket.parent) ?? []
    siblings.push(ticket)
    children.set(ticket.parent, siblings)
  }
  return children
}

/** 统计一张票在可见树里的全部后代；子图已无环。 */
function descendantsOf(
  ref: string,
  children: ReadonlyMap<string, readonly TicketSnapshot[]>,
): number {
  let count = 0
  const stack = [...(children.get(ref) ?? [])]
  while (stack.length > 0) {
    const ticket = stack.pop()
    if (ticket === undefined) continue
    count += 1
    stack.push(...(children.get(ticket.ref) ?? []))
  }
  return count
}

/**
 * 一张票在可见票里的祖先链；遇到缺失父级或环就停。
 * @param byRef - 引用索引。
 * @param ref - 目标票引用。
 * @returns 祖先引用集合。
 */
function ancestorRefs(
  byRef: ReadonlyMap<string, TicketSnapshot>,
  ref: string,
): ReadonlySet<string> {
  const ancestors = new Set<string>()
  let current = byRef.get(ref)?.parent

  while (current !== undefined && byRef.has(current) && !ancestors.has(current)) {
    ancestors.add(current)
    current = byRef.get(current)?.parent
  }
  return ancestors
}
