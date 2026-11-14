/**
 * 工单列表。每行左边是编号与标题，标题下一行是状态与分类；右边是技能按钮，
 * 不可开工时换成原因徽标。点击整行打开这张票的详情，不注入提示词；注入只走技能按钮。
 */
import * as React from 'react'

import { TRIAGE_LABELS } from '../protocol/labels.ts'
import type { TicketAuthor, TicketSnapshot } from '../protocol/tracker.ts'
import { authorName, authorTitle } from './author-text.ts'
import type { InjectionTarget, PromptInjection } from './injection.ts'
import { formatRelativeTime } from './relative-time.ts'
import { SkillActionBadge } from './skill-action-badge.tsx'
import {
  CARD_ACTION_BADGE_STYLE,
  CARD_FOCUSED_STYLE,
  CARD_ROW_STYLE,
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
import { TicketAvatar } from './ticket-avatar.tsx'
import {
  AUTHOR_NAME_STYLE,
  CARD_META_STYLE,
  LABEL_BADGE_STYLE,
  ROW_AGE_STYLE,
} from './ticket-row-styles.ts'

/** 工单列表依赖。 */
export interface TicketListProps {
  readonly tickets: readonly TicketSnapshot[]
  /** 列表为空时的提示：区分仓库本来没有工单和被筛选条件过滤掉。 */
  readonly emptyText: string
  /** 最近一次把提示词填入输入框的工单 `ref`。 */
  readonly injected: string | null
  readonly injection: PromptInjection
  /** 从概览跳过来要定位的工单 `ref`；只高亮，不改其他状态。 */
  readonly focused?: string | null | undefined
  /** 当前时间（毫秒），用于行内的相对创建时间。 */
  readonly now: number
  readonly onPick: (ticket: TicketSnapshot) => void
  readonly onSkillAction: (ticket: TicketSnapshot, target: InjectionTarget) => void
}

/** 本地 Markdown 路径在卡片里的显示上限；再长就从中间截断。 */
const REF_DISPLAY_LIMIT = 40

/** 分类之外最多显示几个标签；超出的折成 `+N`，窄面板不被撑破。 */
const MAX_EXTRA_LABELS = 3

/**
 * 渲染过滤、排序后的工单。
 * @param props - 工单、注入状态与点击回调。
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
          injected={ticket.ref === props.injected && ticket.skillAction !== 'none'}
          injection={props.injection}
          focused={ticket.ref === props.focused}
          now={props.now}
          onPick={props.onPick}
          onSkillAction={props.onSkillAction}
        />
      ))}
    </div>
  )
}

function TicketRow(props: {
  readonly ticket: TicketSnapshot
  readonly injected: boolean
  readonly injection: PromptInjection
  readonly focused: boolean
  readonly now: number
  readonly onPick: (ticket: TicketSnapshot) => void
  readonly onSkillAction: (ticket: TicketSnapshot, target: InjectionTarget) => void
}): React.ReactElement {
  const { ticket } = props
  const display = refDisplay(ticket)

  return (
    <div
      role="listitem"
      data-hover="card"
      // 卡片的表面在这一层：空白页边距也算行的一部分。按钮是键盘可达的打开入口，
      // 它的点击会和这里一样冒泡上来，所以只在行容器上挂一次。
      onClick={() => {
        props.onPick(ticket)
      }}
      style={{ ...CARD_ROW_STYLE, ...(props.focused ? CARD_FOCUSED_STYLE : undefined) }}
    >
      <button
        type="button"
        data-testid="ticket-row"
        data-ref={ticket.ref}
        data-focused={props.focused ? 'true' : undefined}
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
        <MetaRow ticket={ticket} now={props.now} />
      </button>
      <SkillActionBadge
        ticket={ticket}
        injected={props.injected}
        injection={props.injection}
        onSkillAction={props.onSkillAction}
        style={CARD_ACTION_BADGE_STYLE}
      />
    </div>
  )
}

function MetaRow(props: {
  readonly ticket: TicketSnapshot
  readonly now: number
}): React.ReactElement {
  const { ticket } = props
  const extra = ticket.labels.filter((label) => label !== ticket.category)
  const { shown, hidden } = pickRowLabels(extra, MAX_EXTRA_LABELS)

  return (
    <span style={CARD_META_STYLE}>
      <span style={STATUS_BADGES[ticket.status]}>
        <span style={STATUS_DOT_STYLE} />
        {STATUS_LABELS[ticket.status]}
      </span>
      {ticket.category === null ? null : (
        <span style={CATEGORY_BADGES[ticket.category]}>{ticket.category}</span>
      )}
      {shown.map((label) => (
        <span key={label} data-testid="ticket-label" style={LABEL_BADGE_STYLE}>
          {label}
        </span>
      ))}
      {hidden > 0 ? (
        <span data-testid="ticket-label-more" style={LABEL_BADGE_STYLE}>
          +{String(hidden)}
        </span>
      ) : null}
      {ticket.author === null ? null : (
        <AuthorMeta
          author={ticket.author}
          createdAt={ticket.createdAt}
          updatedAt={ticket.updatedAt}
          now={props.now}
        />
      )}
    </span>
  )
}

/** 创建人区：头像、用户名与相对创建时间；时间沿用面板头部的说法。 */
function AuthorMeta(props: {
  readonly author: TicketAuthor
  readonly createdAt: string
  readonly updatedAt: string
  readonly now: number
}): React.ReactElement {
  const { author } = props
  const name = authorName(author)
  const full = authorTitle(author)
  const age = formatRelativeTime(props.createdAt, props.now)

  return (
    <>
      <TicketAvatar author={author} />
      <span data-testid="ticket-author" title={full} style={AUTHOR_NAME_STYLE}>
        {name}
      </span>
      {age.length === 0 ? null : (
        <span
          data-testid="ticket-age"
          title={`创建：${props.createdAt}；更新：${props.updatedAt}`}
          style={ROW_AGE_STYLE}
        >
          {age}
        </span>
      )}
    </>
  )
}

/**
 * 从分类之外的标签里挑出行内要显示的几个：状态标签先占位，其余按后端顺序补到上限。
 * 显示的标签仍按后端返回的顺序排列；上限与 `+N` 的收敛规则不变，只是被折掉的不会是状态标签。
 * @param labels - 分类之外的标签，保持后端返回的顺序。
 * @param limit - 行内最多显示几个标签。
 * @returns 要显示的标签（仍按后端顺序）与折叠掉的个数。
 */
function pickRowLabels(
  labels: readonly string[],
  limit: number,
): { readonly shown: readonly string[]; readonly hidden: number } {
  const isTriageLabel = (label: string): boolean => TRIAGE_LABELS.includes(label)
  const chosen = new Set<number>()
  // 两轮：先给状态标签占位，再用其余标签补齐剩下的位置。
  const fill = (accept: (label: string) => boolean): void => {
    for (const [index, label] of labels.entries()) {
      if (chosen.size >= limit) return
      if (accept(label)) chosen.add(index)
    }
  }
  fill(isTriageLabel)
  fill((label) => !isTriageLabel(label))

  const shown = labels.filter((_, index) => chosen.has(index))
  return { shown, hidden: labels.length - shown.length }
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
