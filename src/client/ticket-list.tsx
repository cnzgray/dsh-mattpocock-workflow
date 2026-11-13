/**
 * 工单列表。每行左边是编号与标题，标题下一行是状态与分类；右边是技能按钮，
 * 不可开工时换成原因徽标。
 */
import * as React from 'react'

import type { TicketSnapshot } from '../protocol/tracker.ts'
import { CheckIcon, InsertDraftIcon } from './icons.tsx'
import { actionBadgeLabel, actionHint } from './skill-action-text.ts'
import {
  ACTION_BADGE_STYLES,
  ACTION_TONES,
  CARD_ACTION_BADGE_STYLE,
  CARD_META_STYLE,
  CARD_ROW_STYLE,
  CARD_SELECTED_STYLE,
  CARD_STYLE,
  CARD_TITLE_STYLE,
  CATEGORY_BADGES,
  EMPTY_STYLE,
  LIST_STYLE,
  NUMBER_BADGE_STYLE,
  SKILL_BADGE_BUTTON_STYLE,
  SKILL_BADGE_DISABLED_STYLE,
  STATUS_BADGES,
  STATUS_DOT_STYLE,
  STATUS_LABELS,
} from './task-panel-styles.ts'

/** 工单列表依赖。 */
export interface TicketListProps {
  readonly tickets: readonly TicketSnapshot[]
  /** 列表为空时的提示：区分仓库本来没有工单和被筛选条件过滤掉。 */
  readonly emptyText: string
  /** 当前选中的工单 `ref`。 */
  readonly selected: string | null
  /** 最近一次把提示词填入输入框的工单 `ref`。 */
  readonly injected: string | null
  readonly canInject: boolean
  readonly onPick: (ticket: TicketSnapshot) => void
  readonly onSkillAction: (ticket: TicketSnapshot) => void
}

/** 本地 Markdown 路径在卡片里的显示上限；再长就从中间截断。 */
const REF_DISPLAY_LIMIT = 40

/**
 * 渲染过滤、排序后的工单。
 * @param props - 工单、选中与注入状态、点击回调。
 * @returns 卡片列表或空状态。
 */
export function TicketList(props: TicketListProps): React.ReactElement {
  if (props.tickets.length === 0) {
    return (
      <div data-testid="empty" style={EMPTY_STYLE}>
        {props.emptyText}
      </div>
    )
  }

  return (
    <div role="list" data-testid="ticket-list" style={LIST_STYLE}>
      {props.tickets.map((ticket) => (
        <TicketRow
          key={ticket.ref}
          ticket={ticket}
          selected={ticket.ref === props.selected}
          injected={ticket.ref === props.injected && ticket.skillAction !== 'none'}
          canInject={props.canInject}
          onPick={props.onPick}
          onSkillAction={props.onSkillAction}
        />
      ))}
    </div>
  )
}

function TicketRow(props: {
  readonly ticket: TicketSnapshot
  readonly selected: boolean
  readonly injected: boolean
  readonly canInject: boolean
  readonly onPick: (ticket: TicketSnapshot) => void
  readonly onSkillAction: (ticket: TicketSnapshot) => void
}): React.ReactElement {
  const { ticket } = props
  const display = refDisplay(ticket)

  return (
    <div
      role="listitem"
      data-hover="card"
      {...(props.selected ? { 'data-selected': 'true' } : {})}
      // 卡片的表面在这一层：空白页边距也算行的一部分。按钮仍是键盘可达的选中入口，
      // 它的点击会和这里一样冒泡上来，所以只在行容器上挂一次。
      onClick={() => {
        props.onPick(ticket)
      }}
      style={{ ...CARD_ROW_STYLE, ...(props.selected ? CARD_SELECTED_STYLE : undefined) }}
    >
      <button
        type="button"
        data-testid="ticket-row"
        data-ref={ticket.ref}
        aria-pressed={props.selected}
        style={CARD_STYLE}
      >
        <span
          data-testid="ticket-ref"
          style={NUMBER_BADGE_STYLE}
          {...(display.full === undefined ? {} : { title: display.full })}
        >
          {display.text}
        </span>
        <span style={CARD_TITLE_STYLE}>{ticket.title}</span>
        <span style={CARD_META_STYLE}>
          <span style={STATUS_BADGES[ticket.status]}>
            <span style={STATUS_DOT_STYLE} />
            {STATUS_LABELS[ticket.status]}
          </span>
          {ticket.category === null ? null : (
            <span style={CATEGORY_BADGES[ticket.category]}>{ticket.category}</span>
          )}
        </span>
      </button>
      <ActionBadge
        ticket={ticket}
        injected={props.injected}
        canInject={props.canInject}
        onSkillAction={props.onSkillAction}
      />
    </div>
  )
}

function ActionBadge(props: {
  readonly ticket: TicketSnapshot
  readonly injected: boolean
  readonly canInject: boolean
  readonly onSkillAction: (ticket: TicketSnapshot) => void
}): React.ReactElement {
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
        style={{ ...ACTION_BADGE_STYLES[ticket.skillActionReason], ...CARD_ACTION_BADGE_STYLE }}
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
      onClick={() => {
        props.onSkillAction(ticket)
      }}
      style={{
        ...SKILL_BADGE_BUTTON_STYLE,
        ...CARD_ACTION_BADGE_STYLE,
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

function refDisplay(ticket: TicketSnapshot): { readonly text: string; readonly full?: string } {
  if (ticket.number !== null) return { text: `#${String(ticket.number)}` }
  if (ticket.ref.length <= REF_DISPLAY_LIMIT) return { text: ticket.ref }

  const head = Math.ceil((REF_DISPLAY_LIMIT - 1) / 2)
  const tail = REF_DISPLAY_LIMIT - 1 - head
  return {
    text: `${ticket.ref.slice(0, head)}…${ticket.ref.slice(ticket.ref.length - tail)}`,
    full: ticket.ref,
  }
}
