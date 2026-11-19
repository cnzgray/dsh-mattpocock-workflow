/**
 * 解析工单正文顶部的 `Blocked by:` 行。GitLab 的原生 blocking link 不可用、
 * Gitea 关闭了 issue 依赖时，两个后端都退回到这一行；这里只实现一次。
 */
import type { Ticket, TicketState } from './ticket.ts'

const BLOCKED_BY = /^\s*Blocked by:\s*(.*)$/im
const REFERENCE = /#?(\d+)/g

/**
 * 从正文顶部的 `Blocked by:` 行读出引用的编号，去重并保持出现顺序。
 * @param description - 工单正文，可以为空。
 * @returns 被引用的编号；没有这一行时为空数组。
 */
export function descriptionBlockerNumbers(description: string): readonly number[] {
  const line = BLOCKED_BY.exec(preambleOf(description))
  if (line === null) return []

  const seen = new Set<number>()
  const numbers: number[] = []
  for (const match of (line[1] ?? '').matchAll(REFERENCE)) {
    const number = Number.parseInt(match[1] ?? '', 10)
    if (!Number.isInteger(number) || seen.has(number)) continue
    seen.add(number)
    numbers.push(number)
  }
  return numbers
}

/**
 * 统计一组阻塞编号里未关闭的数量。
 * 被引用的票不在已加载列表里时按未关闭处理，避免误判为解除阻塞。
 * @param numbers - `Blocked by:` 行里的编号。
 * @param states - 同一仓库里已加载工单的编号 → 状态。
 * @returns 未关闭的阻塞票数量。
 */
export function countOpenBlockers(
  numbers: readonly number[],
  states: ReadonlyMap<number, TicketState>,
): number {
  let count = 0
  for (const number of numbers) {
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

/**
 * 从正文顶部的 `Blocked by:` 行统计未关闭的阻塞票。
 * @param description - 工单正文，可以为空。
 * @param states - 同一仓库里已加载工单的编号 → 状态。
 * @returns 未关闭的阻塞票数量。
 */
export function countDescriptionBlockers(
  description: string,
  states: ReadonlyMap<number, TicketState>,
): number {
  return countOpenBlockers(descriptionBlockerNumbers(description), states)
}

/** 一条原生阻塞依赖：编号与可选的所属仓库。 */
export interface BlockerReference {
  readonly number: number
  /**
   * 依赖票所在仓库的 `owner/name`；后端不给时省略，按当前仓库处理。
   * 与当前仓库不同时引用写成 `owner/repo#15`。
   */
  readonly repository?: string
}

/**
 * 把原生阻塞依赖转成远端后端的票引用。
 * @param refs - 阻塞票编号与可选仓库。
 * @param repository - 当前仓库的 `owner/name`；省略时无法判定同仓库，
 *   带仓库信息的引用一律限定。
 * @returns 同仓库的 `#15` 或跨仓库的 `owner/repo#15`。
 */
export function remoteBlockerRefs(
  refs: readonly BlockerReference[],
  repository?: string,
): readonly string[] {
  return refs.map((ref) =>
    ref.repository === undefined || ref.repository === repository
      ? `#${String(ref.number)}`
      : `${ref.repository}#${String(ref.number)}`,
  )
}

/** 判定一张远端工单的阻塞数与阻塞引用所需的最小输入。 */
export interface OpenBlockerInput {
  readonly ticket: Pick<Ticket, 'state' | 'number'>
  /** 后端原生依赖：未关闭数与全部依赖编号；依赖功能不可用时为 undefined。 */
  readonly nativeBlockers: NativeBlockers | undefined
  /** 工单正文，用于原生依赖为空时读 `Blocked by:` 行。 */
  readonly text: string
  readonly states: ReadonlyMap<number, TicketState>
}

/** 原生依赖的一次读取结果。 */
export interface NativeBlockers {
  /** 未关闭的依赖票数。 */
  readonly open: number
  /** 全部依赖票，不论开闭。 */
  readonly refs: readonly BlockerReference[]
}

/** 一张远端工单的未关闭阻塞数与阻塞引用。 */
export interface ResolvedBlockers {
  readonly openBlockers: number
  readonly blockedBy: readonly string[]
}

/**
 * 算出一张远端工单的未关闭阻塞数与阻塞引用。
 *
 * 规则对 GitLab 与 Gitea 完全相同：原生依赖有未关闭的票就用它；原生依赖为空
 * （或功能不可用）时退回正文顶部的 `Blocked by:` 行，这样功能关闭前按退路格式
 * 写下的阻塞关系不会丢。引用集合取原生依赖里读到的全部编号。
 * @param input - 工单状态、原生依赖、正文与同仓库工单状态。
 * @returns 未关闭阻塞数与阻塞引用；已关闭票两者都为空。
 */
export function resolveOpenBlockers(input: OpenBlockerInput): ResolvedBlockers {
  if (input.ticket.state !== 'open' || input.ticket.number === null) {
    return { openBlockers: 0, blockedBy: [] }
  }

  const native = input.nativeBlockers
  if (native !== undefined && (native.open > 0 || native.refs.length > 0)) {
    return {
      openBlockers:
        native.open > 0 ? native.open : countDescriptionBlockers(input.text, input.states),
      blockedBy: remoteBlockerRefs(native.refs),
    }
  }

  const numbers = descriptionBlockerNumbers(input.text)
  return {
    openBlockers: countOpenBlockers(numbers, input.states),
    blockedBy: remoteBlockerRefs(numbers.map((number) => ({ number }))),
  }
}

/**
 * 只看 `## Comments` 之前的内容：评论里引用的 `Blocked by:` 不能
 * 用来判定当前票的阻塞。
 */
function preambleOf(description: string): string {
  const heading = /^##\s+Comments\b/im.exec(description)
  return heading === null ? description : description.slice(0, heading.index)
}
