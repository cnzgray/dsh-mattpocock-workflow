/**
 * 阻塞信息的合并规则。列表阶段先给出描述回退结果，补齐阶段拿到原生计数后
 * 由这里合并；规则只实现一次，宿主不重复判定。
 */
import type { Ticket } from './ticket.ts'

/**
 * 把原生阻塞数合并回后端返回的工单。
 *
 * 原生计数只有大于 0 时才覆盖列表阶段的值：原生关系为空时，
 * 不能把描述里已经算出的阻塞数冲掉。已关闭票没有阻塞语义，保持原样。
 * @param tickets - 列表阶段的工单（`openBlockers` 可能来自描述回退）。
 * @param native - `ref → 未关闭原生阻塞数`。
 * @returns 保持输入顺序的新数组。
 */
export function mergeNativeBlockers(
  tickets: readonly Ticket[],
  native: ReadonlyMap<string, number>,
): Ticket[] {
  return tickets.map((ticket) => {
    if (ticket.state !== 'open') return ticket

    const count = native.get(ticket.ref)
    if (count === undefined || count <= 0) return ticket
    return { ...ticket, openBlockers: count }
  })
}
