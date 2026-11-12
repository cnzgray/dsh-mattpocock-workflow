/**
 * 工单判定规则。可接/阻塞/已关闭/其他开放的规则只在这里实现一次，
 * 宿主把结果附在快照上，界面不再重复判定。
 */
import type { Ticket, TicketLabelNames } from './ticket.ts'

/** 分类标签，没有分类时为 null。 */
export type TicketCategory = 'bug' | 'enhancement' | null

/** 判定结果，含义见 protocol 的 `TicketStatus`。 */
export type TicketStatus = 'ready' | 'blocked' | 'closed' | 'open'

/** 判定所需的最小字段。 */
export type ClassifiableTicket = Pick<Ticket, 'state' | 'labels' | 'openBlockers'>

/** 带上判定结果的工单。 */
export interface ClassifiedTicket extends Ticket {
  readonly category: TicketCategory
  readonly status: TicketStatus
}

/**
 * 取分类标签。一张票同时带两个分类时以 `bug` 优先：缺陷比需求更需要先处理。
 * @param labels - 工单上的全部标签名。
 * @param names - 分类标签名。
 * @returns 分类，或 null。
 */
export function categorize(labels: readonly string[], names: TicketLabelNames): TicketCategory {
  if (labels.includes(names.bug)) return 'bug'
  if (labels.includes(names.enhancement)) return 'enhancement'
  return null
}

/**
 * 判定一张票的状态。
 *
 * 阻塞的优先级高于可接：开放的票只要有未关闭的阻塞票就算阻塞，
 * 不论它带什么状态标签。
 * @param ticket - 状态、标签与阻塞数。
 * @param names - 状态标签名。
 * @returns 可接、阻塞、已关闭或其他开放。
 */
export function classify(ticket: ClassifiableTicket, names: TicketLabelNames): TicketStatus {
  if (ticket.state === 'closed') return 'closed'
  if (ticket.openBlockers > 0) return 'blocked'
  if (ticket.labels.includes(names.readyForAgent)) return 'ready'
  return 'open'
}

/**
 * 给一批票附上判定结果，保持后端返回的顺序。
 * @param tickets - 后端返回的原始工单。
 * @param names - 标签名集合。
 * @returns 带分类与状态的新数组。
 */
export function classifyTickets(
  tickets: readonly Ticket[],
  names: TicketLabelNames,
): ClassifiedTicket[] {
  return tickets.map((ticket) => ({
    ...ticket,
    category: categorize(ticket.labels, names),
    status: classify(ticket, names),
  }))
}
