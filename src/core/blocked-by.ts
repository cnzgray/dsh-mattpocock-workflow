/**
 * 解析工单正文顶部的 `Blocked by:` 行。GitLab 的原生 blocking link 不可用、
 * Gitea 关闭了 issue 依赖时，两个后端都退回到这一行；这里只实现一次。
 */
import type { Ticket, TicketState } from './ticket.ts'

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
 * 正文顶部是否有 `Blocked by:` 行，不判断被引用票的状态。
 * GitLab 能力探测用它挑一张更可能带原生阻塞关系的票。
 * @param description - 工单正文，可以为空。
 * @returns 是否存在这一行。
 */
export function hasDescriptionBlockers(description: string): boolean {
  return BLOCKED_BY.test(preambleOf(description))
}

/** 判定一张远端工单的阻塞数所需的最小输入。 */
export interface OpenBlockerInput {
  readonly ticket: Pick<Ticket, 'state' | 'number'>
  /** 后端原生依赖里的未关闭数；依赖功能不可用时为 undefined。 */
  readonly nativeBlockers: number | undefined
  /** 工单正文，用于原生依赖为空时读 `Blocked by:` 行。 */
  readonly text: string
  readonly states: ReadonlyMap<number, TicketState>
}

/**
 * 算出一张远端工单的未关闭阻塞数。
 *
 * 规则对 GitLab 与 Gitea 完全相同：原生依赖有未关闭的票就用它；
 * 原生依赖为空（或功能不可用）时退回正文顶部的 `Blocked by:` 行，
 * 这样功能关闭前按退路格式写下的阻塞关系不会丢。
 * @param input - 工单状态、原生依赖数、正文与同仓库工单状态。
 * @returns 未关闭的阻塞票数量。
 */
export function resolveOpenBlockers(input: OpenBlockerInput): number {
  if (input.ticket.state !== 'open' || input.ticket.number === null) return 0
  const native = input.nativeBlockers
  if (native !== undefined && native > 0) return native
  return countDescriptionBlockers(input.text, input.states)
}

/**
 * 只看 `## Comments` 之前的内容：评论里引用的 `Blocked by:` 不能
 * 用来判定当前票的阻塞。
 */
function preambleOf(description: string): string {
  const heading = /^##\s+Comments\b/im.exec(description)
  return heading === null ? description : description.slice(0, heading.index)
}
