/**
 * 解析工单正文顶部的 `Blocked by:` 行。GitLab 的 blocking link 不可用、
 * Gitea 关闭了 issue 依赖时，两个后端都退回到这一行；这里只实现一次。
 */
import type { TicketState } from './ticket.ts'

const BLOCKED_BY = /^\s*Blocked by:\s*(.*)$/im
const REFERENCE = /#?(\d+)/g

/**
 * 从正文顶部的 `Blocked by:` 行统计未关闭的阻塞票。
 * 被引用的票不在已加载列表里时按未关闭处理，避免误判为解除阻塞。
 * @param description - 工单正文，可以为空。
 * @param states - 同一仓库里已加载工单的编号 → 状态。
 * @returns 未关闭的阻塞票数量。
 */
export function countDescriptionBlockers(
  description: string,
  states: ReadonlyMap<number, TicketState>,
): number {
  const line = BLOCKED_BY.exec(preambleOf(description))
  if (line === null) return 0

  const seen = new Set<number>()
  let count = 0
  for (const match of (line[1] ?? '').matchAll(REFERENCE)) {
    const number = Number.parseInt(match[1] ?? '', 10)
    if (!Number.isInteger(number) || seen.has(number)) continue
    seen.add(number)
    if (states.get(number) !== 'closed') count += 1
  }
  return count
}

/**
 * 只看 `## Comments` 之前的内容：评论里引用的 `Blocked by:` 不能
 * 用来判定当前票的阻塞。
 */
function preambleOf(description: string): string {
  const heading = /^##\s+Comments\b/im.exec(description)
  return heading === null ? description : description.slice(0, heading.index)
}
