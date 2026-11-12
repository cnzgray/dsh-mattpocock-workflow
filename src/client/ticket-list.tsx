/**
 * 工单卡片列表。布局参考右侧栏任务面板：编号、标题、分类徽标、右侧状态。
 */
import * as React from 'react'

import type { TicketSnapshot } from '../protocol/tracker.ts'
import {
  CARD_CATEGORY_STYLE,
  CARD_SELECTED_STYLE,
  CARD_STATUS_STYLE,
  CARD_STYLE,
  CARD_TITLE_STYLE,
  CATEGORY_BADGES,
  EMPTY_STYLE,
  LIST_STYLE,
  NUMBER_BADGE_STYLE,
  STATUS_BADGES,
  STATUS_DOT_STYLE,
  STATUS_LABELS,
} from './task-panel-styles.ts'

/** 工单列表依赖。 */
export interface TicketListProps {
  readonly tickets: readonly TicketSnapshot[]
  readonly selected: number | null
  readonly onPick: (ticket: TicketSnapshot) => void
}

/**
 * 渲染过滤、排序后的工单。
 * @param props - 工单、当前选中编号与点击回调。
 * @returns 卡片列表或空状态。
 */
export function TicketList(props: TicketListProps): React.ReactElement {
  if (props.tickets.length === 0) {
    return (
      <div data-testid="empty" style={EMPTY_STYLE}>
        没有符合筛选条件的工单。
      </div>
    )
  }

  return (
    <div role="list" data-testid="ticket-list" style={LIST_STYLE}>
      {props.tickets.map((ticket) => (
        <TicketRow
          key={ticket.number}
          ticket={ticket}
          selected={ticket.number === props.selected}
          onPick={props.onPick}
        />
      ))}
    </div>
  )
}

function TicketRow(props: {
  readonly ticket: TicketSnapshot
  readonly selected: boolean
  readonly onPick: (ticket: TicketSnapshot) => void
}): React.ReactElement {
  const { ticket } = props

  return (
    <div role="listitem">
      <button
        type="button"
        data-testid="ticket-row"
        data-number={ticket.number}
        onClick={() => {
          props.onPick(ticket)
        }}
        style={{ ...CARD_STYLE, ...(props.selected ? CARD_SELECTED_STYLE : undefined) }}
      >
        <span style={NUMBER_BADGE_STYLE}>#{ticket.number}</span>
        <span style={CARD_TITLE_STYLE}>{ticket.title}</span>
        <span style={{ ...STATUS_BADGES[ticket.status], ...CARD_STATUS_STYLE }}>
          <span style={STATUS_DOT_STYLE} />
          {STATUS_LABELS[ticket.status]}
        </span>
        {ticket.category === null ? null : (
          <span style={{ ...CATEGORY_BADGES[ticket.category], ...CARD_CATEGORY_STYLE }}>
            {ticket.category}
          </span>
        )}
      </button>
    </div>
  )
}
