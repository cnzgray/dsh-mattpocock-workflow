/**
 * 面板的展示逻辑：统计、过滤、排序。纯函数，不依赖 DSH，也不重复判定规则——
 * 每张票的 `status` 已由宿主附上。
 */
import type { TicketSnapshot, TicketStatus } from '../protocol/tracker.ts'

/** 过滤条件。`open` 包含可接、阻塞和其他开放。 */
export type TicketFilter = 'all' | 'open' | 'closed' | 'blocked' | 'ready'

/** 排序字段。 */
export type TicketSortKey = 'updated' | 'created' | 'number' | 'title' | 'status'

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

/** 人员筛选：两个独立开关；两个都开时取并集。 */
export interface PersonFilter {
  readonly assignedToMe: boolean
  readonly createdByMe: boolean
}

/** “分配给我 / 我创建的”两个角色在当前集合里的数量。 */
export interface MyTicketCounts {
  readonly assignedToMe: number
  readonly createdByMe: number
}

/**
 * 统计两个人员角色的数量；两个角色各算各的，互不影响。
 * 当前用户为 null 时返回 0：身份识别不出时不假装能按人筛选。
 * @param tickets - 已按状态筛选的工单。
 * @param viewer - 当前登录用户登录名。
 * @returns 两个计数。
 */
export function countMyTickets(
  tickets: readonly TicketSnapshot[],
  viewer: string | null,
): MyTicketCounts {
  if (viewer === null) return { assignedToMe: 0, createdByMe: 0 }

  let assignedToMe = 0
  let createdByMe = 0
  for (const ticket of tickets) {
    if (isAssignedTo(ticket, viewer)) assignedToMe += 1
    if (isCreatedBy(ticket, viewer)) createdByMe += 1
  }
  return { assignedToMe, createdByMe }
}

/**
 * 按人员筛选。两个开关都开时取并集：分配给我或我创建的都留下。
 * 当前用户为 null 时忽略人员开关，列表只受状态筛选影响。
 * @param tickets - 已按状态筛选的工单。
 * @param filter - 两个人员开关。
 * @param viewer - 当前登录用户登录名。
 * @returns 保持原顺序的新数组。
 */
export function filterMyTickets(
  tickets: readonly TicketSnapshot[],
  filter: PersonFilter,
  viewer: string | null,
): readonly TicketSnapshot[] {
  if (viewer === null || (!filter.assignedToMe && !filter.createdByMe)) return [...tickets]

  return tickets.filter(
    (ticket) =>
      (filter.assignedToMe && isAssignedTo(ticket, viewer)) ||
      (filter.createdByMe && isCreatedBy(ticket, viewer)),
  )
}

/** 登录名比较不区分大小写。 */
function sameLogin(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

function isAssignedTo(ticket: TicketSnapshot, viewer: string): boolean {
  return ticket.assignees.some((login) => sameLogin(login, viewer))
}

function isCreatedBy(ticket: TicketSnapshot, viewer: string): boolean {
  return ticket.author !== null && sameLogin(ticket.author.login, viewer)
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

  return [...tickets].sort((left, right) => {
    if (key === 'number') return compareByNumber(left, right, factor)
    if (key === 'status') return compareByStatus(left, right, factor)
    return factor * compareTickets(left, right, key)
  })
}

/**
 * 切换到某个排序键时的默认方向：标题与状态从升序看起，编号与时间从最大/最新看起。
 * @param key - 排序字段。
 * @returns 该字段的默认方向。
 */
export function defaultSortDirection(key: TicketSortKey): SortDirection {
  return key === 'title' || key === 'status' ? 'asc' : 'desc'
}

/**
 * “按编号”在混合数据下先分组：有数字编号的票永远在前，本地 Markdown 按 `ref`
 * 排在后；方向只作用于组内，避免降序时把本地票翻到最前面。
 */
function compareByNumber(left: TicketSnapshot, right: TicketSnapshot, factor: number): number {
  const group = numberGroup(left) - numberGroup(right)
  if (group !== 0) return group

  if (left.number !== null && right.number !== null) {
    return factor * (left.number - right.number)
  }
  return factor * left.ref.localeCompare(right.ref, 'en')
}

function numberGroup(ticket: TicketSnapshot): number {
  return ticket.number === null ? 1 : 0
}

/** 状态分组：可接、阻塞、其他开放、已关闭；组内沿用“按编号”的比较与分组。 */
const STATUS_RANK: Record<TicketStatus, number> = {
  ready: 0,
  blocked: 1,
  open: 2,
  closed: 3,
}

function compareByStatus(left: TicketSnapshot, right: TicketSnapshot, factor: number): number {
  const group = STATUS_RANK[left.status] - STATUS_RANK[right.status]
  if (group !== 0) return factor * group
  return compareByNumber(left, right, factor)
}

function compareTickets(
  left: TicketSnapshot,
  right: TicketSnapshot,
  key: Exclude<TicketSortKey, 'number' | 'status'>,
): number {
  switch (key) {
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
