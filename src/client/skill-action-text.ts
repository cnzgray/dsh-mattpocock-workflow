/**
 * 技能徽标与原因徽标的文案。判定在 core，这里只把判定依据翻译成界面文字，
 * 技能名取自 protocol 的同一份常量。
 */
import { SKILL_ACTION_SKILLS } from '../protocol/env-check.ts'
import type { TicketActionReason } from '../protocol/labels.ts'
import type { TicketSnapshot } from '../protocol/tracker.ts'

/** 判定依据的悬停说明。 */
const ACTION_HINTS = {
  closed: '工单已关闭，不再开工',
  blocked: '还有未关闭的阻塞工单，依赖解开后才开工',
  wontfix: '已标记 wontfix，不再处理',
  'ready-for-human': '已标记 ready-for-human，由人工实现',
  'needs-triage': '带 needs-triage，先按 triage 状态机定性并补标签',
  'needs-info': '带 needs-info，先追问缺失信息',
  bug: '带 ready-for-agent 且分类为 bug，先建立复现回路再定位根因',
  'ready-for-agent': '带 ready-for-agent，按规格实现',
  untriaged: '没有 triage 状态标签，先按状态机分类',
} as const satisfies Record<TicketActionReason, string>

/**
 * 工单行内徽标的文字。可开工的票显示英文技能名，不可开工的票显示原因。
 * @param ticket - 已附带技能动作的工单。
 * @returns 徽标文字。
 */
export function actionBadgeLabel(ticket: TicketSnapshot): string {
  switch (ticket.skillActionReason) {
    case 'closed':
      return '已关闭'
    case 'blocked':
      return `阻塞 ${String(ticket.openBlockers)}`
    case 'wontfix':
      return 'wontfix'
    case 'ready-for-human':
      return '需人工实现'
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
 * @returns 判定依据的文字说明。
 */
export function actionHint(ticket: TicketSnapshot): string {
  return ACTION_HINTS[ticket.skillActionReason]
}
