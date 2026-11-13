/**
 * 技能动作徽标：列表行与详情头部共用。
 *
 * 有技能动作（implement / diagnose / triage）时是可点的按钮，点击把这张票的
 * 提示词填进输入框；不可开工时换成原因徽标。判定在 core、宿主把结果附在快照上，
 * 这里只展示快照里的 `skillAction` 与 `skillActionReason`，不重新判定。
 */
import * as React from 'react'
import type { CSSProperties } from 'react'

import type { TicketSnapshot } from '../protocol/tracker.ts'
import { CheckIcon, InsertDraftIcon } from './icons.tsx'
import { actionBadgeLabel, actionHint } from './skill-action-text.ts'
import {
  ACTION_BADGE_STYLES,
  ACTION_TONES,
  SKILL_BADGE_BUTTON_STYLE,
  SKILL_BADGE_DISABLED_STYLE,
} from './task-panel-styles.ts'

/** 技能动作徽标的依赖。 */
export interface SkillActionBadgeProps {
  readonly ticket: TicketSnapshot
  /** 这张票的提示词刚被填入输入框。 */
  readonly injected: boolean
  readonly canInject: boolean
  readonly onSkillAction: (ticket: TicketSnapshot) => void
  /** 版式位置（列表右列的对齐等）；按钮本体的样式不变。 */
  readonly style?: CSSProperties | undefined
}

/**
 * 渲染一张票的技能按钮或原因徽标。
 * @param props - 工单、注入状态、可注入能力与点击回调。
 * @returns 可点的技能按钮，或不可开工的原因徽标。
 */
export function SkillActionBadge(props: SkillActionBadgeProps): React.ReactElement {
  const { ticket } = props
  const label = actionBadgeLabel(ticket)
  const hint = actionHint(ticket)

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

  const buttonHint = badgeHint(hint, props.injected, props.canInject)
  return (
    <button
      type="button"
      data-hover="action"
      data-testid="skill-badge"
      data-ref={ticket.ref}
      {...(props.injected ? { 'data-injected': 'true' } : {})}
      disabled={!props.canInject}
      title={buttonHint}
      aria-label={`${label}：${buttonHint}`}
      onClick={(event) => {
        // 列表里按钮叠在整行按钮之上：点徽标只注入提示词，不开详情。
        event.stopPropagation()
        props.onSkillAction(ticket)
      }}
      style={{
        ...SKILL_BADGE_BUTTON_STYLE,
        ...props.style,
        color: ACTION_TONES[ticket.skillActionReason],
        ...(props.canInject ? undefined : SKILL_BADGE_DISABLED_STYLE),
      }}
    >
      {props.injected ? <CheckIcon /> : <InsertDraftIcon />}
      {label}
    </button>
  )
}

function badgeHint(hint: string, injected: boolean, canInject: boolean): string {
  const parts = [hint]
  if (injected) parts.push('提示词已填入输入框')
  if (!canInject) parts.push('当前没有可用会话，无法填入提示词')
  return parts.join('；')
}
