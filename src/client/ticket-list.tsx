/**
 * 工单列表。每行左边是编号与标题，标题下一行是状态与分类；右边是技能按钮，
 * 不可开工时换成原因徽标。点击整行打开这张票的详情，不注入提示词；注入只走技能按钮。
 * 远端工单点编号复制网页地址，不打开详情。
 */
import * as React from 'react'

import { TRIAGE_LABELS } from '../protocol/labels.ts'
import type { TicketAuthor, TicketSnapshot, TicketStatus } from '../protocol/tracker.ts'
import { authorName, authorTitle } from './author-text.ts'
import { useI18n } from './i18n.tsx'
import type { InjectionTarget, PromptInjection } from './injection.ts'
import type { MessageKey } from './messages.ts'
import { formatRelativeTime } from './relative-time.ts'
import { SkillActionBadge } from './skill-action-badge.tsx'
import {
  CARD_ACTION_BADGE_STYLE,
  CARD_FOCUSED_STYLE,
  CARD_ROW_STYLE,
  CARD_TITLE_STYLE,
  CATEGORY_BADGES,
  EMPTY_STYLE,
  LIST_STYLE,
  STATUS_BADGES,
  STATUS_DOT_STYLE,
} from './task-panel-styles.ts'
import { TicketAvatar } from './ticket-avatar.tsx'
import { TicketNumber } from './ticket-number.tsx'
import {
  AUTHOR_NAME_STYLE,
  CARD_CONTENT_STYLE,
  CARD_META_STYLE,
  CARD_OPEN_STYLE,
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
  /** 列表底部的附加内容（加载更多哨兵）；跟着列表一起滚动。 */
  readonly footer?: React.ReactNode
}

/** 分类之外最多显示几个标签；超出的折成 `+N`，窄面板不被撑破。 */
const MAX_EXTRA_LABELS = 3

/** 工单状态到词典键。 */
const STATUS_KEYS: Readonly<Record<TicketStatus, MessageKey>> = {
  ready: 'status.ready',
  blocked: 'status.blocked',
  closed: 'status.closed',
  open: 'status.open',
}

/** 行容器：滚动在外层，底部哨兵跟着卡片一起滚。 */
const ROWS_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
}

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
    <div data-testid="ticket-scroll" style={LIST_STYLE}>
      <div role="list" data-testid="ticket-list" style={ROWS_STYLE}>
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
      {props.footer}
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
  const { t } = useI18n()
  const { ticket } = props

  return (
    <div
      role="listitem"
      data-hover="card"
      // 卡片的表面在这一层：空白页边距也算行的一部分。内容区里垫着的按钮是键盘可达的
      // 打开入口，它的点击会和这里一样冒泡上来，所以只在行容器上挂一次。
      onClick={() => {
        props.onPick(ticket)
      }}
      style={{ ...CARD_ROW_STYLE, ...(props.focused ? CARD_FOCUSED_STYLE : undefined) }}
    >
      <div
        data-testid="ticket-row"
        data-ref={ticket.ref}
        data-focused={props.focused ? 'true' : undefined}
        style={CARD_CONTENT_STYLE}
      >
        <button
          type="button"
          data-testid="ticket-open"
          aria-label={t('tickets.a11y.open', { ref: ticket.ref, title: ticket.title })}
          style={CARD_OPEN_STYLE}
        />
        <span style={CARD_TITLE_STYLE}>
          <TicketNumber ticket={ticket} />
          {ticket.title}
        </span>
        <MetaRow ticket={ticket} now={props.now} />
      </div>
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
  const { t } = useI18n()
  const { ticket } = props
  const extra = ticket.labels.filter((label) => label !== ticket.category)
  const { shown, hidden } = pickRowLabels(extra, MAX_EXTRA_LABELS)

  return (
    <span style={CARD_META_STYLE}>
      <span style={STATUS_BADGES[ticket.status]}>
        <span style={STATUS_DOT_STYLE} />
        {t(STATUS_KEYS[ticket.status])}
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
  const { t } = useI18n()
  const { author } = props
  const name = authorName(author)
  const full = authorTitle(author, t)
  const age = formatRelativeTime(props.createdAt, props.now, t)

  return (
    <>
      <TicketAvatar author={author} />
      <span data-testid="ticket-author" title={full} style={AUTHOR_NAME_STYLE}>
        {name}
      </span>
      {age.length === 0 ? null : (
        <span
          data-testid="ticket-age"
          title={t('tickets.age.title', { created: props.createdAt, updated: props.updatedAt })}
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
