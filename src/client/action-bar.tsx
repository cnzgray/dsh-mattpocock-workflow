/**
 * 列表动作栏：左边是统计数字，右边是三个提示词入口——新建需求、bug 与 to-spec 需求。
 * 三个按钮只差文案、配色与提示词，交互与无障碍说明都交给 `split-action.tsx`。
 *
 * 需求已经明确时用「to-spec 需求」跳过入池：`/to-spec` 直接建带规格的需求票。
 * 顺序即按钮顺序：主路径、次路径、直达规格。
 */
import * as React from 'react'

import { PlusIcon } from './icons.tsx'
import type { InjectionTarget, PromptInjection } from './injection.ts'
import { newBugPrompt, newFeaturePrompt, newSpecPrompt } from './prompts.ts'
import { SplitAction } from './split-action.tsx'
import {
  ACTION_BAR_STYLE,
  BUG_ACTION_STYLE,
  COLORS,
  FEATURE_ACTION_STYLE,
  SPEC_ACTION_STYLE,
  STATS_STYLE,
  STAT_STYLE,
  STAT_VALUE_STYLE,
} from './task-panel-styles.ts'
import type { TicketCounts } from './ticket-view.ts'

/** 一个按钮的固定配置；回调与注入端口由动作栏传入。 */
interface DraftActionDefinition {
  readonly testId: string
  readonly label: string
  readonly title: string
  readonly ariaLabel: string
  readonly newSessionTitle: string
  readonly primaryStyle: React.CSSProperties
  readonly primaryHover: 'primary' | 'secondary'
  /** 点主键或小箭头时填入的提示词。 */
  readonly prompt: () => string
}

const DRAFT_ACTIONS: readonly DraftActionDefinition[] = [
  {
    testId: 'new-feature',
    label: '新建需求',
    title: '把需求入池提示词填入当前会话',
    ariaLabel: '新建需求：填入当前会话',
    newSessionTitle: '在新会话开始：新建需求',
    primaryStyle: FEATURE_ACTION_STYLE,
    primaryHover: 'primary',
    prompt: newFeaturePrompt,
  },
  {
    testId: 'new-bug',
    label: 'bug',
    title: '把缺陷入池提示词填入当前会话',
    ariaLabel: 'bug：填入当前会话',
    newSessionTitle: '在新会话开始：报 bug',
    primaryStyle: BUG_ACTION_STYLE,
    primaryHover: 'secondary',
    prompt: newBugPrompt,
  },
  {
    testId: 'new-spec',
    label: 'to-spec 需求',
    title: '把 /to-spec 提示词填入当前会话，直接创建需求票',
    ariaLabel: 'to-spec 需求：把 /to-spec 提示词填入当前会话，直接创建需求票',
    newSessionTitle: '在新会话开始：to-spec 需求',
    primaryStyle: SPEC_ACTION_STYLE,
    primaryHover: 'primary',
    prompt: newSpecPrompt,
  },
]

/** 动作栏：统计在左，三个提示词按钮在右。 */
export function ActionBar(props: {
  readonly counts: TicketCounts | null
  readonly injection: PromptInjection
  readonly onInject: (text: string, target: InjectionTarget) => void
}): React.ReactElement {
  return (
    <div style={ACTION_BAR_STYLE}>
      {props.counts === null ? <span /> : <StatsRow counts={props.counts} />}
      {/* 窄侧栏里按钮各自换行，最长的文案也不会把动作栏撑出可视区。 */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'flex-end',
          gap: 6,
          marginLeft: 'auto',
        }}
      >
        {DRAFT_ACTIONS.map((action) => (
          <DraftAction
            key={action.testId}
            action={action}
            injection={props.injection}
            onInject={props.onInject}
          />
        ))}
      </div>
    </div>
  )
}

/** 一个填提示词的分裂动作：三个按钮只差文案与配色。 */
function DraftAction(props: {
  readonly action: DraftActionDefinition
  readonly injection: PromptInjection
  readonly onInject: (text: string, target: InjectionTarget) => void
}): React.ReactElement {
  const { action, injection, onInject } = props
  return (
    <SplitAction
      testId={action.testId}
      label={action.label}
      icon={<PlusIcon />}
      title={action.title}
      ariaLabel={action.ariaLabel}
      primaryStyle={action.primaryStyle}
      primaryHover={action.primaryHover}
      disabled={!injection.canInjectCurrent}
      canStartNewSession={injection.canStartNewSession}
      newSessionTitle={action.newSessionTitle}
      onPrimary={() => {
        onInject(action.prompt(), 'current-session')
      }}
      onStartSession={() => {
        onInject(action.prompt(), 'new-session')
      }}
    />
  )
}
function StatsRow(props: { readonly counts: TicketCounts }): React.ReactElement {
  return (
    <div style={STATS_STYLE}>
      <Stat testId="stat-ready" label="可接" value={props.counts.ready} color={COLORS.success} />
      <Stat testId="stat-blocked" label="阻塞" value={props.counts.blocked} color={COLORS.warn} />
      <Stat
        testId="stat-closed"
        label="已关闭"
        value={props.counts.closed}
        color={COLORS.tertiary}
      />
    </div>
  )
}

function Stat(props: {
  readonly testId: string
  readonly label: string
  readonly value: number
  readonly color: string
}): React.ReactElement {
  return (
    <div data-testid={props.testId} style={STAT_STYLE}>
      <span
        aria-hidden="true"
        style={{ width: 7, height: 7, borderRadius: '50%', background: props.color, flex: 'none' }}
      />
      <strong style={STAT_VALUE_STYLE}>{props.value}</strong>
      <span>{props.label}</span>
    </div>
  )
}
