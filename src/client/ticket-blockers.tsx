/**
 * 详情页的阻塞项：把当前快照行上的 `blockedBy` 变成头部可展开的入口与列表。
 *
 * 只消费宿主附在快照上的引用与行，不重新判定阻塞：集合按后端顺序去重，
 * 已知关闭的引用不列出，未知状态按未关闭保留（与 core 的 countOpenBlockers 一致）。
 * 点一条只把引用交回面板，不注入提示词、不改筛选与排序。
 */
import * as React from 'react'

import type { TicketSnapshot } from '../protocol/tracker.ts'
import { ChevronLeftIcon } from './icons.tsx'
import { useI18n } from './i18n.tsx'
import { COLORS } from './task-panel-styles.ts'
import {
  DETAIL_BLOCKER_REF_STYLE,
  DETAIL_BLOCKER_ROW_STYLE,
  DETAIL_BLOCKER_STATE_STYLE,
  DETAIL_BLOCKER_TITLE_STYLE,
  DETAIL_BLOCKER_UNLOADED_STYLE,
  DETAIL_BLOCKERS_CHEVRON_STYLE,
  DETAIL_BLOCKERS_LIST_STYLE,
  DETAIL_BLOCKERS_SECTION_STYLE,
  DETAIL_BLOCKERS_TITLE_STYLE,
  DETAIL_BLOCKERS_TOGGLE_STYLE,
} from './ticket-detail-styles.ts'

/** 展开块与入口共用的 DOM id：入口的 aria-controls 指向它。 */
export const BLOCKERS_PANEL_ID = 'detail-blockers'

/** 一条阻塞项：引用，以及快照里能找到的行。 */
export interface BlockerItem {
  readonly ref: string
  readonly ticket: TicketSnapshot | null
}

/**
 * 详情页要列出的阻塞项。
 *
 * 快照行没有 `blockedBy`（GitHub 列表只给未关闭计数）时为空数组；
 * 引用按后端顺序去重，已知 `closed` 的行不列出，未知状态的行保留并带上引用。
 * @param ticket - 当前详情头部使用的快照行。
 * @param tickets - 当前快照的全部行。
 * @returns 要展示的阻塞项；顺序与后端返回的引用顺序一致。
 */
export function blockerItems(
  ticket: TicketSnapshot | null,
  tickets: readonly TicketSnapshot[],
): readonly BlockerItem[] {
  const refs = ticket?.blockedBy
  if (refs === undefined) return []

  const rows = new Map(tickets.map((row) => [row.ref, row]))
  const seen = new Set<string>()
  const items: BlockerItem[] = []
  for (const ref of refs) {
    if (seen.has(ref)) continue
    seen.add(ref)
    const row = rows.get(ref)
    if (row?.state === 'closed') continue
    items.push({ ref, ticket: row ?? null })
  }
  return items
}

/**
 * 把阻塞引用换成读取详情用的数字编号：远端是 `#15`，本地 Markdown 路径没有编号。
 * @param ref - 阻塞引用。
 * @returns 数字编号；不是 `#数字` 形式时为 null。
 */
export function blockerNumber(ref: string): number | null {
  const match = /^#(\d+)$/.exec(ref)
  if (match === null) return null
  const number = Number.parseInt(match[1] ?? '', 10)
  return Number.isSafeInteger(number) ? number : null
}

/**
 * 按引用在当前快照里找行；没有快照或引用不在窗口里时为 null。
 * @param tickets - 当前快照的全部行。
 * @param ref - 工单引用。
 * @returns 快照行；找不到时为 null。
 */
export function findSnapshotTicket(
  tickets: readonly TicketSnapshot[] | undefined,
  ref: string,
): TicketSnapshot | null {
  return tickets?.find((ticket) => ticket.ref === ref) ?? null
}

/**
 * 头部的原因徽标变成 disclosure：点击展开或收起阻塞项。
 * @param props - 未关闭阻塞数、悬停说明与展开状态。
 * @returns 暴露展开状态的原生按钮。
 */
export function BlockersToggle(props: {
  readonly label: string
  readonly hint: string
  readonly expanded: boolean
  readonly onToggle: () => void
}): React.ReactElement {
  const { t } = useI18n()
  const action = t(props.expanded ? 'detail.blockers.collapse' : 'detail.blockers.expand')
  const hint = `${props.hint}${t('common.hintSeparator')}${action}`

  return (
    <button
      type="button"
      data-testid="blockers-toggle"
      data-hover="action"
      aria-expanded={props.expanded}
      aria-controls={BLOCKERS_PANEL_ID}
      title={hint}
      aria-label={`${props.label}${t('common.labelSeparator')}${hint}`}
      onClick={props.onToggle}
      style={DETAIL_BLOCKERS_TOGGLE_STYLE}
    >
      {props.label}
      <span
        style={{
          ...DETAIL_BLOCKERS_CHEVRON_STYLE,
          transform: props.expanded ? 'rotate(90deg)' : 'rotate(-90deg)',
        }}
        aria-hidden="true"
      >
        <ChevronLeftIcon />
      </span>
    </button>
  )
}

/**
 * 展开的「阻塞项」块：详情滚动区域里的第一个块，随正文一起滚动。
 * @param props - 阻塞项与打开回调。
 * @returns 分组标题与阻塞项按钮。
 */
export function BlockersSection(props: {
  readonly items: readonly BlockerItem[]
  readonly onOpen: (ref: string) => void
}): React.ReactElement {
  const { t } = useI18n()
  return (
    <section
      id={BLOCKERS_PANEL_ID}
      data-testid="detail-blockers"
      aria-label={t('detail.blockers.title')}
      style={DETAIL_BLOCKERS_SECTION_STYLE}
    >
      <h3 style={DETAIL_BLOCKERS_TITLE_STYLE}>{t('detail.blockers.title')}</h3>
      <div style={DETAIL_BLOCKERS_LIST_STYLE}>
        {props.items.map((item) => (
          <BlockerRow key={item.ref} item={item} onOpen={props.onOpen} />
        ))}
      </div>
    </section>
  )
}

/** 一条阻塞项：引用、已知标题与状态；快照里没有这一行时只显示引用与「未加载」。 */
function BlockerRow(props: {
  readonly item: BlockerItem
  readonly onOpen: (ref: string) => void
}): React.ReactElement {
  const { t } = useI18n()
  const row = props.item.ticket
  const title =
    row === null
      ? t('detail.blockers.unloadedTitle')
      : t('tickets.a11y.open', { ref: props.item.ref, title: row.title })

  return (
    <button
      type="button"
      data-testid="blocker-item"
      data-ref={props.item.ref}
      data-hover="soft"
      title={title}
      onClick={() => {
        props.onOpen(props.item.ref)
      }}
      style={DETAIL_BLOCKER_ROW_STYLE}
    >
      <span data-testid="blocker-ref" style={DETAIL_BLOCKER_REF_STYLE}>
        {props.item.ref}
      </span>
      {row === null ? (
        <span data-testid="blocker-unloaded" style={DETAIL_BLOCKER_UNLOADED_STYLE}>
          {t('detail.blockers.unloaded')}
        </span>
      ) : (
        <>
          <span data-testid="blocker-title" style={DETAIL_BLOCKER_TITLE_STYLE}>
            {row.title}
          </span>
          <span
            data-testid="blocker-state"
            style={{
              ...DETAIL_BLOCKER_STATE_STYLE,
              color: row.state === 'closed' ? COLORS.tertiary : COLORS.success,
            }}
          >
            {t(row.state === 'closed' ? 'detail.state.closed' : 'detail.state.open')}
          </span>
        </>
      )}
    </button>
  )
}
