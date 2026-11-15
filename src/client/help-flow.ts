/**
 * 流程帮助页的六张图：入池状态机、需求链、直达规格、缺陷链、访谈与画图的取舍，
 * 以及实现之后。结构只引用协议里的命令 id 与标签字面值；所有展示文案都是词典键，
 * 界面按当前语言解析。
 */
import { DIRECT_SPEC_ENTRY, type FlowCommandId } from '../protocol/flow.ts'
import { TRACKER_LABELS } from '../protocol/labels.ts'
import type { MessageKey } from './messages.ts'

/** 状态节点显示的文字：标签字面值原样显示，面板自己的状态文案走词典。 */
export type HelpState = { readonly text: string } | { readonly key: MessageKey }

/** 流程图的一个节点：命令节点或状态节点，二选一。 */
export interface HelpNode {
  /** 命令节点对应的命令；状态节点为 null。 */
  readonly command: FlowCommandId | null
  /** 状态节点显示的文字；命令节点为 null。 */
  readonly state: HelpState | null
  /** 节点下方说明的词典键；没有为 null。 */
  readonly note: MessageKey | null
  /** agent 在这里停下，等用户发下一条命令。 */
  readonly stops: boolean
}

/** 流程图的一行；一行里多个节点表示分叉。 */
export interface HelpRow {
  readonly nodes: readonly HelpNode[]
}

/** 帮助页上的一张流程图；行按从上到下的顺序相连。 */
export interface HelpDiagram {
  readonly id: string
  readonly titleKey: MessageKey
  readonly summaryKey: MessageKey
  readonly rows: readonly HelpRow[]
}

/** 命令节点的公共字段；`stops` 默认 true，终点节点再单独覆盖。 */
const STOPPING_COMMAND_NODE = { command: null, state: null, note: null, stops: true } as const

/** 帮助页的六张图。 */
export const HELP_DIAGRAMS: readonly HelpDiagram[] = [
  {
    id: 'intake-triage',
    titleKey: 'help.diagram.intakeTriage.title',
    summaryKey: 'help.diagram.intakeTriage.summary',
    rows: [
      {
        nodes: [
          { ...STOPPING_COMMAND_NODE, command: 'intakeBug', note: 'help.note.bug' },
          { ...STOPPING_COMMAND_NODE, command: 'intakeFeature', note: 'help.note.feature' },
        ],
      },
      {
        nodes: [
          {
            command: null,
            state: { text: TRACKER_LABELS.needsTriage },
            note: null,
            stops: false,
          },
        ],
      },
      { nodes: [{ ...STOPPING_COMMAND_NODE, command: 'triage', note: 'help.note.triage' }] },
      {
        nodes: [
          {
            command: null,
            state: { text: TRACKER_LABELS.readyForAgent },
            note: null,
            stops: false,
          },
          {
            command: null,
            state: { text: TRACKER_LABELS.readyForHuman },
            note: null,
            stops: false,
          },
          {
            command: null,
            state: { text: TRACKER_LABELS.needsInfo },
            note: null,
            stops: false,
          },
          {
            command: null,
            state: { text: TRACKER_LABELS.wontfix },
            note: null,
            stops: false,
          },
        ],
      },
    ],
  },
  {
    id: 'feature-chain',
    titleKey: 'help.diagram.featureChain.title',
    summaryKey: 'help.diagram.featureChain.summary',
    rows: [
      {
        nodes: [
          { ...STOPPING_COMMAND_NODE, command: 'intakeFeature', note: 'help.note.featureOneLine' },
        ],
      },
      {
        nodes: [
          {
            command: null,
            state: { text: TRACKER_LABELS.needsTriage },
            note: null,
            stops: false,
          },
        ],
      },
      {
        nodes: [
          { ...STOPPING_COMMAND_NODE, command: 'triage', note: 'help.note.default' },
          { ...STOPPING_COMMAND_NODE, command: 'toSpec', note: 'help.note.discussed' },
          { ...STOPPING_COMMAND_NODE, command: 'grillWithDocs', note: 'help.note.vague' },
          { ...STOPPING_COMMAND_NODE, command: 'wayfinder', note: 'help.note.tooBig' },
        ],
      },
      { nodes: [{ ...STOPPING_COMMAND_NODE, command: 'toSpec', note: 'help.note.afterFlow' }] },
      { nodes: [{ ...STOPPING_COMMAND_NODE, command: 'toTickets', note: null }] },
      { nodes: [{ ...STOPPING_COMMAND_NODE, command: 'implement', note: null, stops: false }] },
    ],
  },
  {
    id: 'direct-spec',
    titleKey: 'help.diagram.directSpec.title',
    summaryKey: 'help.diagram.directSpec.summary',
    rows: [
      {
        nodes: [
          {
            command: null,
            state: { key: 'help.note.directSpecState' },
            note: null,
            stops: false,
          },
        ],
      },
      {
        nodes: [
          {
            ...STOPPING_COMMAND_NODE,
            command: DIRECT_SPEC_ENTRY.command,
            note: 'help.note.withDescription',
          },
        ],
      },
      {
        nodes: [
          {
            command: null,
            state: { text: TRACKER_LABELS.readyForAgent },
            note: 'help.note.specReady',
            stops: false,
          },
        ],
      },
      { nodes: [{ ...STOPPING_COMMAND_NODE, command: 'toTickets', note: null }] },
      { nodes: [{ command: 'implement', state: null, note: null, stops: false }] },
    ],
  },
  {
    id: 'bug-chain',
    titleKey: 'help.diagram.bugChain.title',
    summaryKey: 'help.diagram.bugChain.summary',
    rows: [
      { nodes: [{ ...STOPPING_COMMAND_NODE, command: 'intakeBug', note: 'help.note.bugSlots' }] },
      {
        nodes: [
          {
            command: null,
            state: { text: TRACKER_LABELS.needsTriage },
            note: null,
            stops: false,
          },
        ],
      },
      { nodes: [{ ...STOPPING_COMMAND_NODE, command: 'triage', note: null }] },
      {
        nodes: [
          {
            ...STOPPING_COMMAND_NODE,
            command: 'diagnosingBugs',
            note: 'help.note.hardToDiagnose',
          },
          { command: 'implement', state: null, note: 'help.note.rootCauseKnown', stops: false },
        ],
      },
      {
        nodes: [
          { command: 'implement', state: null, note: 'help.note.afterDiagnosis', stops: false },
        ],
      },
    ],
  },
  {
    id: 'choose-interview',
    titleKey: 'help.diagram.chooseInterview.title',
    summaryKey: 'help.diagram.chooseInterview.summary',
    rows: [
      {
        nodes: [
          {
            command: null,
            state: { key: 'help.note.needsDiscussion' },
            note: null,
            stops: false,
          },
        ],
      },
      {
        nodes: [
          { ...STOPPING_COMMAND_NODE, command: 'grillWithDocs', note: 'help.note.oneSession' },
          { ...STOPPING_COMMAND_NODE, command: 'wayfinder', note: 'help.note.tooBigForSession' },
        ],
      },
      { nodes: [{ ...STOPPING_COMMAND_NODE, command: 'toSpec', note: null }] },
    ],
  },
  {
    id: 'after-implement',
    titleKey: 'help.diagram.afterImplement.title',
    summaryKey: 'help.diagram.afterImplement.summary',
    rows: [
      {
        nodes: [
          { command: null, state: { key: 'help.note.implementDone' }, note: null, stops: false },
        ],
      },
      {
        nodes: [
          { ...STOPPING_COMMAND_NODE, command: 'codeReview', note: 'help.note.reviewTwoAxis' },
        ],
      },
      {
        nodes: [
          { command: null, state: { key: 'help.note.reviewFixed' }, note: null, stops: false },
        ],
      },
      { nodes: [{ ...STOPPING_COMMAND_NODE, command: 'pr', note: 'help.note.prBody' }] },
      { nodes: [{ command: null, state: { key: 'help.note.merged' }, note: null, stops: false }] },
      {
        nodes: [{ ...STOPPING_COMMAND_NODE, command: 'close', note: 'help.note.closeAfterMerge' }],
      },
      {
        nodes: [
          { command: null, state: { key: 'help.note.ticketClosed' }, note: null, stops: false },
        ],
      },
    ],
  },
]
