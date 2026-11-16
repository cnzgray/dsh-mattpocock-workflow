/**
 * 「我的工单」筛选行：两个独立开关、按状态筛选后的计数、清除与当前身份。
 * 身份为 null 时整行由列表视图决定不渲染，这里不处理无身份占位。
 */
import * as React from 'react'

import { PersonIcon } from './icons.tsx'
import { useI18n } from './i18n.tsx'
import {
  MY_FILTER_CHIP_ACTIVE_STYLE,
  MY_FILTER_CHIP_STYLE,
  MY_FILTER_CLEAR_STYLE,
  MY_FILTER_COUNT_ACTIVE_STYLE,
  MY_FILTER_COUNT_STYLE,
  MY_FILTER_ICON_STYLE,
  MY_FILTER_ROW_STYLE,
  MY_FILTER_VIEWER_STYLE,
} from './my-filter-styles.ts'
import type { MyTicketCounts } from './ticket-view.ts'

/** 人员筛选行依赖。 */
export interface MyTicketsBarProps {
  readonly viewer: string
  readonly counts: MyTicketCounts
  readonly assignedToMe: boolean
  readonly createdByMe: boolean
  readonly onToggleAssigned: () => void
  readonly onToggleCreated: () => void
  readonly onClear: () => void
}

/** 人员筛选行。 */
export function MyTicketsBar(props: MyTicketsBarProps): React.ReactElement {
  const { t } = useI18n()

  return (
    <div
      data-testid="mine-filters"
      role="group"
      aria-label={t('mine.group')}
      style={MY_FILTER_ROW_STYLE}
    >
      <span aria-hidden="true" style={MY_FILTER_ICON_STYLE}>
        <PersonIcon />
      </span>
      <MineChip
        testId="mine-assigned"
        label={t('mine.assigned')}
        count={props.counts.assignedToMe}
        active={props.assignedToMe}
        onClick={props.onToggleAssigned}
      />
      <MineChip
        testId="mine-created"
        label={t('mine.created')}
        count={props.counts.createdByMe}
        active={props.createdByMe}
        onClick={props.onToggleCreated}
      />
      {props.assignedToMe || props.createdByMe ? (
        <button
          type="button"
          data-testid="mine-clear"
          data-hover="link"
          onClick={props.onClear}
          style={MY_FILTER_CLEAR_STYLE}
        >
          {t('mine.clear')}
        </button>
      ) : null}
      <span
        data-testid="mine-viewer"
        title={t('mine.viewerTitle', { login: props.viewer })}
        style={MY_FILTER_VIEWER_STYLE}
      >
        {t('mine.viewer', { login: props.viewer })}
      </span>
    </div>
  )
}

/** 人员筛选胶囊：独立多选开关，计数按当前状态筛选后的集合计算。 */
function MineChip(props: {
  readonly testId: string
  readonly label: string
  readonly count: number
  readonly active: boolean
  readonly onClick: () => void
}): React.ReactElement {
  const { t } = useI18n()

  return (
    <button
      type="button"
      data-testid={props.testId}
      aria-pressed={props.active}
      data-hover="soft"
      title={t('mine.countHint')}
      onClick={props.onClick}
      style={{
        ...MY_FILTER_CHIP_STYLE,
        ...(props.active ? MY_FILTER_CHIP_ACTIVE_STYLE : undefined),
      }}
    >
      {props.label}
      <span
        style={{
          ...MY_FILTER_COUNT_STYLE,
          ...(props.active ? MY_FILTER_COUNT_ACTIVE_STYLE : undefined),
        }}
      >
        {props.count}
      </span>
    </button>
  )
}
