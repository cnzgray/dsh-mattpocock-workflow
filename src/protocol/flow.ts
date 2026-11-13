/**
 * 工作流定义：插件自带的入池命令、它们可推荐的下一步、matt 技能的命令名，
 * 以及帮助页的流程图。
 *
 * 建票命令正文（host）和帮助页（client）都从这里读取，任何一边漏了或多了命令，
 * 两边的防漂移测试都会失败。这里只放常量，不放生成文本或渲染逻辑。
 */
import { PANEL_SKILLS } from './env-check.ts'
import { TRACKER_LABELS, type TrackerLabelNames } from './labels.ts'

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
 * 流程里的全部命令。入池命令由插件在内存里注册，处理命令来自 matt 的技能。
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

/** 一个入池命令的定义。 */
export interface IntakeCommandDefinition {
  readonly kind: IntakeKind
  readonly command: FlowCommandId
  /** 填进输入框的槽位；只是引导，不做格式校验。 */
  readonly slots: readonly string[]
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
    slots: ['现象：', '复现步骤：', '预期行为：'],
    labelRoles: ['bug', 'needsTriage'],
    nextSteps: ['triage'],
  },
  feature: {
    kind: 'feature',
    command: 'intakeFeature',
    slots: ['需求（一句话）：'],
    labelRoles: ['needsTriage'],
    nextSteps: ['triage', 'toSpec', 'grillWithDocs', 'wayfinder'],
  },
} as const satisfies Record<IntakeKind, IntakeCommandDefinition>

/** 流程图的一个节点：命令节点或状态节点，二选一。 */
export interface FlowNode {
  /** 命令节点对应的命令；状态节点为 null。 */
  readonly command: FlowCommandId | null
  /** 状态节点显示的标签；命令节点为 null。 */
  readonly state: string | null
  /** 节点下方的一句说明；没有为 null。 */
  readonly note: string | null
  /** agent 在这里停下，等用户发下一条命令。 */
  readonly stops: boolean
}

/** 流程图的一行；一行里多个节点表示分叉。 */
export interface FlowRow {
  readonly nodes: readonly FlowNode[]
}

/** 帮助页上的一张流程图；行按从上到下的顺序相连。 */
export interface FlowDiagram {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly rows: readonly FlowRow[]
}

/** 命令节点的公共字段；`stops` 默认 true，终点节点再单独覆盖。 */
const STOPPING_COMMAND_NODE = { command: null, state: null, note: null, stops: true } as const

/** 帮助页的四张图：入池状态机、需求链、缺陷链，以及访谈与画图的取舍。 */
export const FLOW_DIAGRAMS: readonly FlowDiagram[] = [
  {
    id: 'intake-triage',
    title: '入池与 triage',
    summary: '原始报告先变成池里的票，再由 triage 定性。',
    rows: [
      {
        nodes: [
          { ...STOPPING_COMMAND_NODE, command: 'intakeBug', note: '缺陷' },
          { ...STOPPING_COMMAND_NODE, command: 'intakeFeature', note: '需求' },
        ],
      },
      {
        nodes: [{ command: null, state: TRACKER_LABELS.needsTriage, note: null, stops: false }],
      },
      { nodes: [{ ...STOPPING_COMMAND_NODE, command: 'triage', note: '定性' }] },
      {
        nodes: [
          {
            command: null,
            state: TRACKER_LABELS.readyForAgent,
            note: null,
            stops: false,
          },
          {
            command: null,
            state: TRACKER_LABELS.readyForHuman,
            note: null,
            stops: false,
          },
          { command: null, state: TRACKER_LABELS.needsInfo, note: null, stops: false },
          { command: null, state: TRACKER_LABELS.wontfix, note: null, stops: false },
        ],
      },
    ],
  },
  {
    id: 'feature-chain',
    title: '需求链',
    summary: '需求先入池，再按情况走定性、访谈或画图；之后写规格、拆票、实现。',
    rows: [
      { nodes: [{ ...STOPPING_COMMAND_NODE, command: 'intakeFeature', note: '一句话需求' }] },
      {
        nodes: [{ command: null, state: TRACKER_LABELS.needsTriage, note: null, stops: false }],
      },
      {
        nodes: [
          { ...STOPPING_COMMAND_NODE, command: 'triage', note: '默认' },
          { ...STOPPING_COMMAND_NODE, command: 'toSpec', note: '讨论已清楚' },
          { ...STOPPING_COMMAND_NODE, command: 'grillWithDocs', note: '需求还模糊' },
          { ...STOPPING_COMMAND_NODE, command: 'wayfinder', note: '一个会话装不下' },
        ],
      },
      { nodes: [{ ...STOPPING_COMMAND_NODE, command: 'toSpec', note: '走完之后' }] },
      { nodes: [{ ...STOPPING_COMMAND_NODE, command: 'toTickets', note: null }] },
      { nodes: [{ ...STOPPING_COMMAND_NODE, command: 'implement', note: null, stops: false }] },
    ],
  },
  {
    id: 'bug-chain',
    title: '缺陷链',
    summary: '缺陷一律先 triage；难查的再诊断，根因清楚的直接实现。',
    rows: [
      { nodes: [{ ...STOPPING_COMMAND_NODE, command: 'intakeBug', note: '三行槽位' }] },
      {
        nodes: [{ command: null, state: TRACKER_LABELS.needsTriage, note: null, stops: false }],
      },
      { nodes: [{ ...STOPPING_COMMAND_NODE, command: 'triage', note: null }] },
      {
        nodes: [
          { ...STOPPING_COMMAND_NODE, command: 'diagnosingBugs', note: '确实难查' },
          { command: 'implement', state: null, note: '根因已经清楚', stops: false },
        ],
      },
      { nodes: [{ command: 'implement', state: null, note: '诊断之后', stops: false }] },
    ],
  },
  {
    id: 'choose-interview',
    title: '访谈还是画图',
    summary: '需求需要讨论时，按一个会话装不装得下来选。',
    rows: [
      {
        nodes: [{ command: null, state: '需求需要讨论', note: null, stops: false }],
      },
      {
        nodes: [
          { ...STOPPING_COMMAND_NODE, command: 'grillWithDocs', note: '一个会话装得下' },
          { ...STOPPING_COMMAND_NODE, command: 'wayfinder', note: '一个会话装不下' },
        ],
      },
      { nodes: [{ ...STOPPING_COMMAND_NODE, command: 'toSpec', note: null }] },
    ],
  },
]
