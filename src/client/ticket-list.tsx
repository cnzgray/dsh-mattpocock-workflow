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
  /** 列表为空时的提示：区分仓库本来没有工单和被筛选条件过滤掉。 */
  readonly emptyText: string
  /** 当前选中的工单 `ref`。 */
  readonly selected: string | null
  readonly onPick: (ticket: TicketSnapshot) => void
}

/** 本地 Markdown 路径在卡片里的显示上限；再长就从中间截断。 */
const REF_DISPLAY_LIMIT = 40

/**
 * 渲染过滤、排序后的工单。
 * @param props - 工单、当前选中引用与点击回调。
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
  const display = refDisplay(ticket)

  return (
    <div role="listitem">
      <button
        type="button"
        data-testid="ticket-row"
        data-ref={ticket.ref}
        aria-pressed={props.selected}
        data-hover="card"
        onClick={() => {
          props.onPick(ticket)
        }}
        style={{ ...CARD_STYLE, ...(props.selected ? CARD_SELECTED_STYLE : undefined) }}
      >
        <span
          data-testid="ticket-ref"
          style={NUMBER_BADGE_STYLE}
          {...(display.full === undefined ? {} : { title: display.full })}
        >
          {display.text}
        </span>
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
