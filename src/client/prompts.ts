/**
 * 预设提示词。只填进输入框，不自动发送；用户可以改完再按发送。
 * 技能名取自 protocol 的面板技能常量，环境检查不会和这里脱节。
 */
import { PANEL_SKILLS, SKILL_ACTION_SKILLS } from '../protocol/env-check.ts'
import type { TicketActionReason, TicketSkillAction } from '../protocol/labels.ts'

/** “新建需求”按钮填入的开场提示词。 */
export const NEW_FEATURE_PROMPT = `使用 ${PANEL_SKILLS.toSpec} 技能开始一项新需求：先向我提问，澄清目标、验收标准和边界，再整理成规格并创建工单。现在先问第一个问题。`

/** “+ bug”按钮填入的开场提示词。 */
export const NEW_BUG_PROMPT = `使用 ${PANEL_SKILLS.triage} 和 ${PANEL_SKILLS.diagnosingBugs} 技能处理一个缺陷：先复现并确认现象，再定位根因。开始前先问我要复现步骤和预期行为。`

/** 生成某张票的提示词所需的最小信息。 */
export interface TicketPromptTarget {
  /** 工单引用：远端后端是 `#15`，本地 Markdown 是相对工作区的文件路径。 */
  readonly ref: string
  readonly skillAction: TicketSkillAction
  readonly skillActionReason: TicketActionReason
}

/**
 * 按工单的技能动作生成提示词。
 *
 * 技能必须写成 DSH 的 `/技能名` 手势：宿主只扫描用户消息里空白包围的 `/name`
 * 来加载技能，写成“使用 X 技能”只是普通文字，技能不会被加载。
 * 文案按 matt 技能正文的关键要求组织：`implement` 先读规格再实现与验证，
 * `diagnose` 先建立复现回路，`triage` 先按状态机评估；缺信息时先追问。
 * @param ticket - 工单引用与技能动作。
 * @returns 填入输入框的提示词；不可开工的票返回 null。
 */
export function ticketPrompt(ticket: TicketPromptTarget): string | null {
  switch (ticket.skillAction) {
    case 'none':
      return null
    case 'implement':
      return `/${SKILL_ACTION_SKILLS.implement} 处理工单 ${ticket.ref}：先读取工单的完整规格并复述标题，按规格实现（优先用 tdd），运行 pnpm check，最后用 code-review 复审并提交。`
    case 'diagnose':
      return `/${SKILL_ACTION_SKILLS.diagnose} 处理工单 ${ticket.ref}：先按工单描述复现问题，建立一个能稳定复现的反馈回路，再定位根因并给出修复方案。`
    case 'triage':
      return ticket.skillActionReason === 'needs-info'
        ? `/${SKILL_ACTION_SKILLS.triage} 处理工单 ${ticket.ref}：这张票缺信息，先列出缺失信息清单并向工单作者追问，补齐后推进到 ready-for-agent。`
        : `/${SKILL_ACTION_SKILLS.triage} 处理工单 ${ticket.ref}：按 triage 状态机评估这张工单，补齐分类标签与状态标签，必要时写出 agent brief。`
  }
}
