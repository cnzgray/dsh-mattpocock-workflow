/**
 * 列表排序：下拉选排序键，旁边一个按钮切换升降序，两者装在同一个槽里。
 * 下拉用原生 `<select>`：弹出菜单交给系统，键盘与读屏开箱可用。
 */
import * as React from 'react'
import type { CSSProperties } from 'react'

import { COLORS, SEGMENTED_STYLE, SORT_OPTIONS } from './task-panel-styles.ts'
import type { SortDirection, TicketSortKey } from './ticket-view.ts'

/** 整组靠右：和左侧的状态过滤分开。 */
const GROUP_STYLE: CSSProperties = {
  ...SEGMENTED_STYLE,
  flexWrap: 'nowrap',
  marginLeft: 'auto',
}

const SELECT_WRAP_STYLE: CSSProperties = {
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
}

/** 下拉本体：外观同选中的分段，表示“当前按这个排”。 */
const SELECT_STYLE: CSSProperties = {
  appearance: 'none',
  WebkitAppearance: 'none',
  margin: 0,
  border: 'none',
  borderRadius: 6,
  padding: '2px 24px 2px 10px',
  color: COLORS.text,
  background: COLORS.surfaceRaised,
  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.12), 0 0 0 0.5px rgba(0, 0, 0, 0.08)',
  colorScheme: 'light dark',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 12,
  fontWeight: 500,
  lineHeight: '20px',
}

/** 下拉右侧的实心三角；不接收点击，点到它等于点下拉。 */
const CARET_STYLE: CSSProperties = {
  position: 'absolute',
  right: 8,
  display: 'inline-flex',
  color: COLORS.text,
  pointerEvents: 'none',
}

/** 升降序切换：和未选中的分段同一档，只放一个箭头。 */
const DIRECTION_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 26,
  border: 'none',
  borderRadius: 6,
  padding: '2px 6px',
  color: COLORS.secondary,
  background: 'transparent',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 13,
  lineHeight: '20px',
}

const DIRECTION_TEXT: Record<SortDirection, string> = { asc: '升序', desc: '降序' }

/**
 * 排序控件。
 * @param props - 当前排序键与方向；换键时方向回到该键的默认值，点箭头只翻转方向。
 * @returns 下拉加方向按钮。
 */
export function SortControl(props: {
  readonly sortKey: TicketSortKey
  readonly direction: SortDirection
  readonly onSortKey: (key: TicketSortKey) => void
  readonly onToggleDirection: () => void
}): React.ReactElement {
  const next: SortDirection = props.direction === 'asc' ? 'desc' : 'asc'

  return (
    <div role="group" aria-label="排序" style={GROUP_STYLE}>
      <span style={SELECT_WRAP_STYLE}>
        <select
          data-testid="sort-key"
          aria-label="排序字段"
          value={props.sortKey}
          onChange={(event) => {
            const key = SORT_OPTIONS.find((item) => item.value === event.target.value)?.value
            if (key !== undefined) props.onSortKey(key)
          }}
          style={SELECT_STYLE}
        >
          {SORT_OPTIONS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <span style={CARET_STYLE}>
          <CaretIcon />
        </span>
      </span>
      <button
        type="button"
        data-testid="sort-direction"
        data-direction={props.direction}
        data-hover="soft"
        aria-label={`${DIRECTION_TEXT[props.direction]}，切换为${DIRECTION_TEXT[next]}`}
        title={`${DIRECTION_TEXT[props.direction]}（点击切换为${DIRECTION_TEXT[next]}）`}
        onClick={props.onToggleDirection}
        style={DIRECTION_STYLE}
      >
        {props.direction === 'asc' ? '↑' : '↓'}
      </button>
    </div>
  )
}

function CaretIcon(): React.ReactElement {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
      <path d="M0.5 2h7L4 6.5z" fill="currentColor" />
    </svg>
  )
}
