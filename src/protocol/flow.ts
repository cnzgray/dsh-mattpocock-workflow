/**
 * 工作流定义：插件自带的命令、它们可推荐的下一步、matt 技能的命令名，
 * 以及帮助页的流程图。
 *
 * 建票命令正文（host）和帮助页（client）都从这里读取，任何一边漏了或多了命令，
 * 两边的防漂移测试都会失败。这里只放常量，不放生成文本或渲染逻辑。
 */
import { PANEL_SKILLS } from './env-check.ts'
import type { TrackerLabelNames } from './labels.ts'

/** 命令的归属：插件自带，还是 matt 的技能。 */
export type FlowOwner = 'plugin' | 'matt'

/** 流程里出现的一个命令。 */
export interface FlowCommand {
  readonly name: string
  readonly owner: FlowOwner
  /** 帮助页上的一句话说明；不写技能内部的步骤。 */
  readonly summary: string
}

/**
 * 流程里的全部命令。插件命令由插件在内存里注册，处理命令来自 matt 的技能。
 */
export const FLOW_COMMANDS = {
  intakeBug: { name: 'mattwf-bug', owner: 'plugin', summary: '把缺陷报告写成原始工单' },
  intakeFeature: { name: 'mattwf-feature', owner: 'plugin', summary: '把需求写成原始工单' },
  triage: { name: PANEL_SKILLS.triage, owner: 'matt', summary: '定性原始工单' },
  toSpec: { name: PANEL_SKILLS.toSpec, owner: 'matt', summary: '写成规格' },
  toTickets: { name: PANEL_SKILLS.toTickets, owner: 'matt', summary: '拆成可接的工单' },
  grillWithDocs: { name: PANEL_SKILLS.grillWithDocs, owner: 'matt', summary: '访谈需求' },
  wayfinder: { name: PANEL_SKILLS.wayfinder, owner: 'matt', summary: '画决策地图' },
  diagnosingBugs: {
    name: PANEL_SKILLS.diagnosingBugs,
    owner: 'matt',
    summary: '诊断难查的缺陷',
  },
  implement: { name: PANEL_SKILLS.implement, owner: 'matt', summary: '按规格实现' },
  codeReview: { name: PANEL_SKILLS.codeReview, owner: 'matt', summary: '两轴评审改动' },
  pr: { name: PANEL_SKILLS.pr, owner: 'matt', summary: '写 PR 正文' },
  close: { name: 'mattwf-close', owner: 'plugin', summary: '判断工单能否关闭，能关就关票' },
} as const satisfies Record<string, FlowCommand>

/** 流程命令的 id。 */
export type FlowCommandId = keyof typeof FLOW_COMMANDS

/** 建票后可推荐的下一步。 */
export interface NextStep {
  readonly command: FlowCommandId
  /** 什么情况下推荐这一步；写进建票命令正文。 */
  readonly when: string
  /** 推荐时附带的提醒；没有为 null。 */
  readonly reminder: string | null
}

/**
 * 建票后可以推荐的下一步。缺陷与需求各自从里面取子集，
 * 建票命令正文只列自己候选里的命令。
 */
export const NEXT_STEPS = {
  triage: {
    command: 'triage',
    when: '默认；把原始票交给 triage 定性，由它判断去向。',
    reminder: null,
  },
  toSpec: {
    command: 'toSpec',
    when: '本次对话已经把需求讨论清楚时，在同一会话里把这张票原地写成规格。',
    reminder: '原地转规格时按需调整标签。',
  },
  grillWithDocs: {
    command: 'grillWithDocs',
    when: '需求还模糊、但一个会话装得下时，先把需求问清楚。',
    reminder: null,
  },
  wayfinder: {
    command: 'wayfinder',
    when: '一个会话装不下的大工作时，先画出决策地图。',
    reminder: null,
  },
} as const satisfies Record<string, NextStep>

/** 下一步候选的 id。 */
export type NextStepId = keyof typeof NEXT_STEPS

/** 入池的两种票。 */
export type IntakeKind = 'bug' | 'feature'

/** 提示词里的引导槽位；文案由界面按稳定 id 翻译，协议只定义有哪些槽位。 */
export type PromptSlotId = 'symptom' | 'steps' | 'expected' | 'feature' | 'description'

/** 一段提示词需要的定义：用哪个流程命令、留哪些槽位。入池命令与直达规格入口共用。 */
export interface PromptEntry {
  readonly command: FlowCommandId
  /** 填进输入框的槽位；只是引导，不做格式校验。 */
  readonly slots: readonly PromptSlotId[]
}

/** 一个入池命令的定义。 */
export interface IntakeCommandDefinition extends PromptEntry {
  readonly kind: IntakeKind
  /** 建票时打上的标签；需求票不预设分类。 */
  readonly labelRoles: readonly (keyof TrackerLabelNames)[]
  /** 建完后可以推荐的下一步；缺陷票只能推荐 triage。 */
  readonly nextSteps: readonly NextStepId[]
}

/** 两个入池命令。命令名统一带 `mattwf-` 前缀，和 matt 的技能区分。 */
export const INTAKE_COMMANDS = {
  bug: {
    kind: 'bug',
    command: 'intakeBug',
    slots: ['symptom', 'steps', 'expected'],
    labelRoles: ['bug', 'needsTriage'],
    nextSteps: ['triage'],
  },
  feature: {
    kind: 'feature',
    command: 'intakeFeature',
    slots: ['feature'],
    labelRoles: ['needsTriage'],
    nextSteps: ['triage', 'toSpec', 'grillWithDocs', 'wayfinder'],
  },
} as const satisfies Record<IntakeKind, IntakeCommandDefinition>

/**
 * 直达规格入口：不先入池，把需求描述直接交给 `to-spec`，
 * 由它建出一张带规格、带 `ready-for-agent` 的需求票。
 * 面板的提示词从这里取命令名与槽位，帮助页的直达场景从这里取命令名。
 */
export const DIRECT_SPEC_ENTRY = {
  command: 'toSpec',
  slots: ['description'],
} as const satisfies PromptEntry
