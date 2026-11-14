/**
 * 面板预设提示词。只填进输入框，不自动发送；用户可以改完再按发送。
 *
 * 「+ 新建需求」「+ bug」注入插件自带的入池命令加槽位：第一行是
 * `/mattwf-feature` 或 `/mattwf-bug`，DSH 按用户消息里空白边界的
 * `/技能名` 词元把命令正文注入这一轮。草稿不写阶段说明、边界和跟踪器行，
 * 这些都在命令正文里维护；槽位只是引导，用户删掉直接写一段话也可以。
 *
 * 技能徽标按工单的技能动作组装，只给技能手势和工单引用（`/implement #40`）。
 * 步骤由技能正文负责：DSH 发送时按手势加载技能，`implement` 会自己取票、复述标题、
 * 按 tdd 实现、跑检查、过 code-review 再提交。面板再写一遍是第二份规则，
 * 上游技能升级后就会和正文分叉。
 * 技能名取自 protocol 的面板技能常量，环境检查不会和这里脱节。
 */
import { SKILL_ACTION_SKILLS } from '../protocol/env-check.ts'
import { FLOW_COMMANDS, INTAKE_COMMANDS, type IntakeCommandDefinition } from '../protocol/flow.ts'
import type { TicketSkillAction } from '../protocol/labels.ts'

/** 生成某张票的提示词所需的最小信息。 */
export interface TicketPromptTarget {
  /** 工单引用：远端后端是 `#15`，本地 Markdown 是相对工作区的文件路径。 */
  readonly ref: string
  readonly skillAction: TicketSkillAction
}

/**
 * 按工单的技能动作生成提示词。
 *
 * 技能必须写成 DSH 的 `/技能名` 手势：宿主只扫描用户消息里空白包围的 `/name`
 * 来加载技能，写成“使用 X 技能”只是普通文字，技能不会被加载。
 * 手势后面只跟工单引用，工作流由技能正文提供——`implement` 取票并复述标题，
 * `diagnosing-bugs` 先建反馈回路，`triage` 按状态机评估并在缺信息时追问。
 * @param ticket - 工单引用与技能动作。
 * @returns 填入输入框的提示词；不可开工的票返回 null。
 */
export function ticketPrompt(ticket: TicketPromptTarget): string | null {
  if (ticket.skillAction === 'none') return null
  return `/${SKILL_ACTION_SKILLS[ticket.skillAction]} ${ticket.ref}`
}

/**
 * 「+ 新建需求」填入的开场提示词：进入需求入池。
 * @returns 以 mattwf-feature 手势开头、后面是槽位的注入文本。
 */
export function newFeaturePrompt(): string {
  return intakePrompt(INTAKE_COMMANDS.feature)
}

/**
 * 「+ bug」填入的开场提示词：进入缺陷入池。
 * @returns 以 mattwf-bug 手势开头、后面是槽位的注入文本。
 */
export function newBugPrompt(): string {
  return intakePrompt(INTAKE_COMMANDS.bug)
}

function intakePrompt(intake: IntakeCommandDefinition): string {
  return [`/${FLOW_COMMANDS[intake.command].name}`, '', ...intake.slots].join('\n')
}
