/**
 * 面板的展示逻辑：统计、过滤、排序。纯函数，不依赖 DSH，也不重复判定规则——
 * 每张票的 `status` 已由宿主附上。
 */
import type { TicketSnapshot } from '../protocol/tracker.ts'

/** 过滤条件。`open` 包含可接、阻塞和其他开放。 */
export type TicketFilter = 'all' | 'open' | 'closed' | 'blocked' | 'ready'

/** 排序字段。 */
export type TicketSortKey = 'updated' | 'created' | 'number' | 'title'

/** 排序方向。 */
export type SortDirection = 'asc' | 'desc'

/** “可接 / 阻塞 / 已关闭”三类数量。 */
export interface TicketCounts {
  readonly ready: number
  readonly blocked: number
  readonly closed: number
}

/**
 * 统计三类数量；其他开放的票不进入统计。
 * @param tickets - 已判定的工单。
 * @returns 三个计数。
 */
export function countTickets(tickets: readonly TicketSnapshot[]): TicketCounts {
  let ready = 0
  let blocked = 0
  let closed = 0

  for (const ticket of tickets) {
    if (ticket.status === 'ready') ready += 1
    else if (ticket.status === 'blocked') blocked += 1
    else if (ticket.status === 'closed') closed += 1
  }

  return { ready, blocked, closed }
}

/**
 * 按状态过滤。
 * @param tickets - 已判定的工单。
 * @param filter - 过滤条件。
 * @returns 保持原顺序的新数组。
 */
export function filterTickets(
  tickets: readonly TicketSnapshot[],
  filter: TicketFilter,
): readonly TicketSnapshot[] {
  switch (filter) {
    case 'all':
      return [...tickets]
    case 'open':
      return tickets.filter((ticket) => ticket.state === 'open')
    case 'closed':
      return tickets.filter((ticket) => ticket.status === 'closed')
    case 'blocked':
      return tickets.filter((ticket) => ticket.status === 'blocked')
    case 'ready':
      return tickets.filter((ticket) => ticket.status === 'ready')
  }
}

/**
 * 按字段排序，相等时保持输入顺序。
 * @param tickets - 已判定的工单。
 * @param key - 排序字段。
 * @param direction - 升序或降序。
 * @returns 新数组。
 */
export function sortTickets(
  tickets: readonly TicketSnapshot[],
  key: TicketSortKey,
  direction: SortDirection,
): readonly TicketSnapshot[] {
  const factor = direction === 'asc' ? 1 : -1

  return [...tickets].sort((left, right) => factor * compareTickets(left, right, key))
}

function compareTickets(left: TicketSnapshot, right: TicketSnapshot, key: TicketSortKey): number {
  switch (key) {
    case 'number':
      return left.number - right.number
    case 'title':
      return left.title.localeCompare(right.title, 'zh-Hans')
    case 'created':
      return timestamp(left.createdAt) - timestamp(right.createdAt)
    case 'updated':
      return timestamp(left.updatedAt) - timestamp(right.updatedAt)
  }
}

function timestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}
