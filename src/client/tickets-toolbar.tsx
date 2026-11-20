/**
 * 列表工具栏：状态筛选、排序与行内显示配置。筛选计数基于整份快照，
 * 不随当前筛选变化。
 */
import * as React from 'react'

import { useI18n } from './i18n.tsx'
import type { MessageKey } from './messages.ts'
import { RowDisplayControl } from './row-display-control.tsx'
import { SortControl } from './sort-control.tsx'
import {
  CHIP_ACTIVE_STYLE,
  CHIP_COUNT_STYLE,
  CHIP_DOT_STYLE,
  CHIP_STYLE,
  COLORS,
  SEGMENTED_STYLE,
  TICKET_FILTERS,
  TOOLBAR_STYLE,
} from './task-panel-styles.ts'
import type { TicketSortKey, TicketCounts, TicketFilter, SortDirection } from './ticket-view.ts'
import type { RowField, RowFields } from './view-preference.ts'

/** 过滤条件到词典键。 */
const FILTER_KEYS: Readonly<Record<TicketFilter, MessageKey>> = {
  all: 'filter.all',
  open: 'filter.open',
  closed: 'filter.closed',
  blocked: 'filter.blocked',
  ready: 'filter.ready',
}

/** 带计数的筛选段：数字基于整份快照，不随当前筛选变化。 */
const CHIP_STATS: Partial<
  Record<TicketFilter, { readonly key: keyof TicketCounts; readonly color: string }>
> = {
  closed: { key: 'closed', color: COLORS.tertiary },
  blocked: { key: 'blocked', color: COLORS.warn },
  ready: { key: 'ready', color: COLORS.success },
}

/** 列表工具栏。 */
export function Toolbar(props: {
  readonly filter: TicketFilter
  readonly sortKey: TicketSortKey
  readonly direction: SortDirection
  readonly counts: TicketCounts
  /** 行内显示哪些字段：创建人、创建时间、更新时间与分配人。 */
  readonly fields: RowFields
  /** 当前后端是否有分配人概念；本地 Markdown 不渲染这个开关。 */
  readonly assigneesAvailable: boolean
  readonly onFilter: (filter: TicketFilter) => void
  readonly onSort: (key: TicketSortKey) => void
  readonly onToggleField: (field: RowField) => void
}): React.ReactElement {
  const { t } = useI18n()
  return (
    <div style={TOOLBAR_STYLE}>
      <div role="group" aria-label={t('filter.group')} style={SEGMENTED_STYLE}>
        {TICKET_FILTERS.map((value) => (
          <Chip
            key={value}
            testId={`filter-${value}`}
            label={t(FILTER_KEYS[value])}
            stat={CHIP_STATS[value]}
            count={props.counts}
            active={props.filter === value}
            onClick={() => {
              props.onFilter(value)
            }}
          />
        ))}
      </div>
      <SortControl
        sortKey={props.sortKey}
        direction={props.direction}
        onSortKey={props.onSort}
        onToggleDirection={() => {
          props.onSort(props.sortKey)
        }}
      />
      <RowDisplayControl
        fields={props.fields}
        assigneesAvailable={props.assigneesAvailable}
        onToggleField={props.onToggleField}
      />
    </div>
  )
}

/** 工具栏 chip 的按钮外壳：开与关只靠 `aria-pressed` 区分，外观由调用方填内容。 */
function ChipButton(props: {
  readonly testId: string
  readonly active: boolean
  readonly onClick: () => void
  readonly children: React.ReactNode
}): React.ReactElement {
  return (
    <button
      type="button"
      data-testid={props.testId}
      aria-pressed={props.active}
      data-hover="soft"
      onClick={props.onClick}
      style={{ ...CHIP_STYLE, ...(props.active ? CHIP_ACTIVE_STYLE : undefined) }}
    >
      {props.children}
    </button>
  )
}

function Chip(props: {
  readonly testId: string
  readonly label: string
  readonly stat: { readonly key: keyof TicketCounts; readonly color: string } | undefined
  readonly count: TicketCounts
  readonly active: boolean
  readonly onClick: () => void
}): React.ReactElement {
  const stat = props.stat
  return (
    <ChipButton testId={props.testId} active={props.active} onClick={props.onClick}>
      {stat === undefined ? null : (
        <span aria-hidden="true" style={{ ...CHIP_DOT_STYLE, background: stat.color }} />
      )}
      {props.label}
      {stat === undefined ? null : (
        <span data-testid={`stat-${stat.key}`} style={CHIP_COUNT_STYLE}>
          {props.count[stat.key]}
        </span>
      )}
    </ChipButton>
  )
}
