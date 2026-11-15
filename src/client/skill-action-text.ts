/**
 * 技能徽标与原因徽标的文案。判定在 core，这里只把判定依据翻译成界面文字，
 * 技能名取自 protocol 的同一份常量。
 */
import { SKILL_ACTION_SKILLS } from '../protocol/env-check.ts'
import type { TicketActionReason } from '../protocol/labels.ts'
import type { TicketSnapshot } from '../protocol/tracker.ts'
import type { Translate } from './i18n-runtime.ts'
import type { MessageKey } from './messages.ts'

/** 判定依据的悬停说明。 */
const ACTION_HINTS: Readonly<Record<TicketActionReason, MessageKey>> = {
  closed: 'skill.hint.closed',
  blocked: 'skill.hint.blocked',
  wontfix: 'skill.hint.wontfix',
  'ready-for-human': 'skill.hint.readyForHuman',
  'needs-triage': 'skill.hint.needsTriage',
  'needs-info': 'skill.hint.needsInfo',
  bug: 'skill.hint.bug',
  'ready-for-agent': 'skill.hint.readyForAgent',
  untriaged: 'skill.hint.untriaged',
}

/**
 * 工单行内徽标的文字。可开工的票显示英文技能名，不可开工的票显示原因。
 * @param ticket - 已附带技能动作的工单。
 * @param t - 翻译入口；省略时用内置中文。
 * @returns 徽标文字。
 */
export function actionBadgeLabel(ticket: TicketSnapshot, t: Translate): string {
  switch (ticket.skillActionReason) {
    case 'closed':
      return t('skill.label.closed')
    case 'blocked':
      return t('skill.label.blocked', { count: ticket.openBlockers })
    case 'wontfix':
      return t('skill.label.wontfix')
    case 'ready-for-human':
      return t('skill.label.readyForHuman')
    case 'needs-triage':
    case 'needs-info':
    case 'untriaged':
      return SKILL_ACTION_SKILLS.triage
    case 'bug':
      return SKILL_ACTION_SKILLS.diagnose
    case 'ready-for-agent':
      return SKILL_ACTION_SKILLS.implement
  }
}

/**
 * 徽标的悬停说明：这张票为什么被判成这个动作。
 * @param ticket - 已附带技能动作的工单。
 * @param t - 翻译入口；省略时用内置中文。
 * @returns 判定依据的文字说明。
 */
export function actionHint(ticket: TicketSnapshot, t: Translate): string {
  return t(ACTION_HINTS[ticket.skillActionReason])
}
