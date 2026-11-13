/**
 * 技能动作判定：从工单的状态标签与分类标签推导出该走哪个 matt 技能。
 * 规则只在这里实现一次，宿主把结果附在快照上，界面不再重复判定。
 */
import { categorize, classify, type ClassifiableTicket } from './classify.ts'
import type { TicketLabelNames } from './ticket.ts'

/** 可注入的技能动作；`none` 表示不提供注入入口。 */
export const SKILL_ACTIONS = ['implement', 'diagnose', 'triage', 'none'] as const

/** 技能动作的联合类型。 */
export type SkillAction = (typeof SKILL_ACTIONS)[number]

/**
 * 判定依据。界面用它渲染原因徽标和悬停说明：
 * 前四项对应不可开工的原因，其余是选中该技能的理由。
 */
export const SKILL_ACTION_REASONS = [
  'closed',
  'blocked',
  'wontfix',
  'ready-for-human',
  'needs-triage',
  'needs-info',
  'bug',
  'ready-for-agent',
  'untriaged',
] as const

/** 判定依据的联合类型。 */
export type SkillActionReason = (typeof SKILL_ACTION_REASONS)[number]

/** 一张票的判定结果。 */
export interface SkillActionDecision {
  readonly skillAction: SkillAction
  readonly skillActionReason: SkillActionReason
}

/**
 * 判定一张票该走哪个技能。
 *
 * 顺序即优先级：已关闭与阻塞先排除；`wontfix` / `ready-for-human` 不交给 agent；
 * 状态标签决定 `triage`；可接的票按分类分到 `diagnose` 或 `implement`。
 * 没有 triage 标签的开放票（如本地 Markdown 工单）落到 `triage`。
 * 关闭/阻塞优先级复用 {@link classify}，分类优先级复用 {@link categorize}，
 * 规则不会和状态、分类判定分叉。
 * @param ticket - 状态、标签与未关闭阻塞数。
 * @param names - 标签名集合。
 * @returns 技能动作与判定依据。
 */
export function decideSkillAction(
  ticket: ClassifiableTicket,
  names: TicketLabelNames,
): SkillActionDecision {
  const status = classify(ticket, names)
  if (status === 'closed') return blocked('closed')
  if (status === 'blocked') return blocked('blocked')
  if (ticket.labels.includes(names.wontfix)) return blocked('wontfix')
  if (ticket.labels.includes(names.readyForHuman)) return blocked('ready-for-human')
  if (ticket.labels.includes(names.needsTriage)) {
    return { skillAction: 'triage', skillActionReason: 'needs-triage' }
  }
  if (ticket.labels.includes(names.needsInfo)) {
    return { skillAction: 'triage', skillActionReason: 'needs-info' }
  }
  if (status === 'ready') {
    return categorize(ticket.labels, names) === 'bug'
      ? { skillAction: 'diagnose', skillActionReason: 'bug' }
      : { skillAction: 'implement', skillActionReason: 'ready-for-agent' }
  }
  return { skillAction: 'triage', skillActionReason: 'untriaged' }
}

/**
 * 给一批票附上技能动作，保持后端返回的顺序。
 * @param tickets - 已判定分类与状态的票。
 * @param names - 标签名集合。
 * @returns 带技能动作的新数组。
 */
export function withSkillActions<T extends ClassifiableTicket>(
  tickets: readonly T[],
  names: TicketLabelNames,
): (T & SkillActionDecision)[] {
  return tickets.map((ticket) => ({ ...ticket, ...decideSkillAction(ticket, names) }))
}

function blocked(reason: SkillActionReason): SkillActionDecision {
  return { skillAction: 'none', skillActionReason: reason }
}
