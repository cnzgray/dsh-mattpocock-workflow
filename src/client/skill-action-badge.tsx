/**
 * 技能动作徽标：列表行与详情头部共用。
 *
 * 有技能动作（implement / diagnose / triage）时是分裂动作：主键把这张票的
 * 提示词填进当前会话，右侧小箭头用同一段提示词开新会话；不可开工时换成原因徽标。
 * 判定在 core、宿主把结果附在快照上，这里只展示快照里的 `skillAction` 与
 * `skillActionReason`，不重新判定。
 *
 * 「已填入」只代表当前会话的输入框；小箭头不动当前输入框，因此不改变这个标记。
 */
import * as React from 'react'
import type { CSSProperties } from 'react'

import type { TicketSnapshot } from '../protocol/tracker.ts'
import { CheckIcon, InsertDraftIcon } from './icons.tsx'
import { useI18n } from './i18n.tsx'
import type { Translate } from './i18n-runtime.ts'
import type { InjectionTarget, PromptInjection } from './injection.ts'
import { actionBadgeLabel, actionHint } from './skill-action-text.ts'
import { SplitAction } from './split-action.tsx'
import { ACTION_BADGE_STYLES, ACTION_TONES, SKILL_BADGE_BUTTON_STYLE } from './task-panel-styles.ts'

/** 技能动作徽标的依赖。 */
export interface SkillActionBadgeProps {
  readonly ticket: TicketSnapshot
  /** 这张票的提示词刚被填进当前会话的输入框。 */
  readonly injected: boolean
  readonly injection: PromptInjection
  readonly onSkillAction: (ticket: TicketSnapshot, target: InjectionTarget) => void
  /** 版式位置（列表右列的对齐等）；按钮本体的样式不变。 */
  readonly style?: CSSProperties | undefined
}

/**
 * 渲染一张票的技能动作或原因徽标。
 * @param props - 工单、注入状态、注入端口与点击回调。
 * @returns 分裂的技能动作，或不可开工的原因徽标。
 */
export function SkillActionBadge(props: SkillActionBadgeProps): React.ReactElement {
  const { ticket } = props
  const { t } = useI18n()
  const label = actionBadgeLabel(ticket, t)
  const hint = actionHint(ticket, t)

  if (ticket.skillAction === 'none') {
    return (
      <span
        data-testid="action-reason"
        data-ref={ticket.ref}
        title={hint}
        aria-label={`${label}：${hint}`}
        style={{ ...ACTION_BADGE_STYLES[ticket.skillActionReason], ...props.style }}
      >
        {label}
      </span>
    )
  }

  const canFill = props.injection.canInjectCurrent
  const buttonHint = badgeHint(hint, props.injected, canFill, t)

  return (
    <SplitAction
      testId="skill-badge"
      primaryAttributes={{
        'data-ref': ticket.ref,
        ...(props.injected ? { 'data-injected': 'true' } : {}),
      }}
      label={label}
      icon={props.injected ? <CheckIcon /> : <InsertDraftIcon />}
      title={buttonHint}
      ariaLabel={`${label}：${buttonHint}`}
      primaryStyle={{
        ...SKILL_BADGE_BUTTON_STYLE,
        color: ACTION_TONES[ticket.skillActionReason],
      }}
      primaryHover="action"
      disabled={!canFill}
      canStartNewSession={props.injection.canStartNewSession}
      newSessionTitle={t('skill.newSession', { hint })}
      onPrimary={() => {
        props.onSkillAction(ticket, 'current-session')
      }}
      onStartSession={() => {
        props.onSkillAction(ticket, 'new-session')
      }}
      compact
      style={props.style}
    />
  )
}

function badgeHint(hint: string, injected: boolean, canInject: boolean, t: Translate): string {
  const parts = [hint]
  if (injected) parts.push(t('injection.filledShort'))
  if (!canInject) parts.push(t('injection.noSessionShort'))
  return parts.join(t('common.hintSeparator'))
}
