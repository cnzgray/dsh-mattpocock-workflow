/**
 * 列表动作栏：三个提示词入口——新建需求、bug 与 to-spec 需求。
 * 面板把它放进页签栏右侧（灯泡左边），所以用紧凑的小按钮、短文案；
 * 完整含义写在悬停说明和读屏标签里。
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
  ACTION_GROUP_STYLE,
  BUG_ACTION_STYLE,
  FEATURE_ACTION_STYLE,
  SPEC_ACTION_STYLE,
} from './task-panel-styles.ts'

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
    label: '需求',
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
    label: 'to-spec',
    title: '把 /to-spec 提示词填入当前会话，直接创建需求票',
    ariaLabel: 'to-spec 需求：把 /to-spec 提示词填入当前会话，直接创建需求票',
    newSessionTitle: '在新会话开始：to-spec 需求',
    primaryStyle: SPEC_ACTION_STYLE,
    primaryHover: 'primary',
    prompt: newSpecPrompt,
  },
]

/** 动作栏：三个紧凑的提示词按钮并排，不换行。 */
export function ActionBar(props: {
  readonly injection: PromptInjection
  readonly onInject: (text: string, target: InjectionTarget) => void
}): React.ReactElement {
  return (
    <div style={ACTION_GROUP_STYLE}>
      {DRAFT_ACTIONS.map((action) => (
        <DraftAction
          key={action.testId}
          action={action}
          injection={props.injection}
          onInject={props.onInject}
        />
      ))}
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
      compact
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
