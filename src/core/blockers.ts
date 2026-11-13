/**
 * 阻塞信息的合并规则。列表阶段先给出描述回退结果，补齐阶段拿到原生依赖后
 * 由这里合并；规则只实现一次，宿主不重复判定。
 */
import type { BlockerResolution, Ticket } from './ticket.ts'

/**
 * 把原生阻塞信息合并回后端返回的工单。
 *
 * 原生计数只有大于 0 时才覆盖列表阶段的值：原生关系为空时（如 GitLab 免费套餐的
 * links 接口返回空数组），不能把描述里已经算出的阻塞数冲掉。引用集合只在原生给出
 * 非空结果时覆盖，理由相同。已关闭票没有阻塞语义，保持原样。
 * @param tickets - 列表阶段的工单（`openBlockers` 可能来自描述回退）。
 * @param native - 原生补齐结果。
 * @returns 保持输入顺序的新数组。
 */
export function mergeNativeBlockers(
  tickets: readonly Ticket[],
  native: BlockerResolution,
): Ticket[] {
  return tickets.map((ticket) => {
    if (ticket.state !== 'open') return ticket

    const count = native.open.get(ticket.ref)
    const blockedBy = native.blockedBy.get(ticket.ref)
    if (
      (count === undefined || count <= 0) &&
      (blockedBy === undefined || blockedBy.length === 0)
    ) {
      return ticket
    }

    return {
      ...ticket,
      ...(count === undefined || count <= 0 ? {} : { openBlockers: count }),
      ...(blockedBy === undefined || blockedBy.length === 0 ? {} : { blockedBy }),
    }
  })
}
