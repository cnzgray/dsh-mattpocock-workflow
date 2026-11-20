/**
 * 行内显示配置：一个图标按钮，点开浮层后用两个开关决定列表行显示哪些字段。
 * 只改显示偏好，不动筛选、排序、选中票与快照请求；点外部或按 Esc 收起浮层。
 */
import * as React from 'react'

import { useI18n } from './i18n.tsx'
import { CheckIcon, DisplaySettingsIcon } from './icons.tsx'
import type { MessageKey } from './messages.ts'
import { COLORS } from './task-panel-styles.ts'
import {
  DISPLAY_MENU_ITEM_STYLE,
  DISPLAY_MENU_PANEL_STYLE,
  DISPLAY_MENU_TRIGGER_STYLE,
  DISPLAY_MENU_WRAP_STYLE,
} from './ticket-row-styles.ts'
import type { RowField, RowFields } from './view-preference.ts'

const CHECK_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  color: COLORS.accent,
}

/** 未开启时保留勾的位置，开关切换时文字不左右跳。 */
const CHECK_OFF_STYLE: React.CSSProperties = { ...CHECK_STYLE, visibility: 'hidden' }

/** 浮层里的字段顺序与文案：创建信息在前，可选字段在后，与行内从左到右一致。 */
const DISPLAY_ITEMS: readonly {
  readonly field: RowField
  readonly testId: string
  readonly key: MessageKey
}[] = [
  { field: 'showAuthor', testId: 'display-author', key: 'row.showAuthor' },
  { field: 'showCreatedAt', testId: 'display-created', key: 'row.showCreatedAt' },
  { field: 'showUpdatedAt', testId: 'display-updated', key: 'row.showUpdatedAt' },
  { field: 'showAssignees', testId: 'display-assignees', key: 'row.showAssignees' },
]

/** 行内显示配置入口：四个字段的开关，入口与浮层共用一份字段表。 */
export function RowDisplayControl(props: {
  /** 行内各字段当前的显示开关。 */
  readonly fields: RowFields
  /** 当前后端是否有分配人概念；本地 Markdown 不出现这一项。 */
  readonly assigneesAvailable: boolean
  readonly onToggleField: (field: RowField) => void
}): React.ReactElement {
  const { t } = useI18n()
  const [open, setOpen] = React.useState(false)
  const wrapRef = React.useRef<HTMLDivElement>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    if (!open) return undefined
    // 浮层没有遮罩：点浮层以外任意处收起，Esc 收起并把焦点还给按钮。
    const onPointerDown = (event: PointerEvent): void => {
      if (wrapRef.current?.contains(event.target as Node) === true) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={wrapRef} style={DISPLAY_MENU_WRAP_STYLE}>
      <button
        ref={triggerRef}
        type="button"
        data-testid="display-settings"
        aria-expanded={open}
        aria-label={t('row.displayGroup')}
        title={t('row.displayGroupHint')}
        data-hover="soft"
        onClick={() => {
          setOpen((value) => !value)
        }}
        style={{
          ...DISPLAY_MENU_TRIGGER_STYLE,
          ...(open ? { background: COLORS.surfaceActive, color: COLORS.text } : undefined),
        }}
      >
        <DisplaySettingsIcon />
      </button>
      {open ? (
        <div role="group" aria-label={t('row.displayGroup')} style={DISPLAY_MENU_PANEL_STYLE}>
          {DISPLAY_ITEMS.filter(
            (item) => item.field !== 'showAssignees' || props.assigneesAvailable,
          ).map((item) => (
            <MenuItem
              key={item.field}
              testId={item.testId}
              label={t(item.key)}
              pressed={props.fields[item.field]}
              onToggle={() => {
                props.onToggleField(item.field)
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** 浮层里的一项：整行是按钮，`aria-pressed` 表示是否显示；开启只体现在末尾的对勾上。 */
function MenuItem(props: {
  readonly testId: string
  readonly label: string
  readonly pressed: boolean
  readonly onToggle: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      data-testid={props.testId}
      aria-pressed={props.pressed}
      data-hover="soft"
      onClick={props.onToggle}
      style={DISPLAY_MENU_ITEM_STYLE}
    >
      {props.label}
      <span aria-hidden="true" style={props.pressed ? CHECK_STYLE : CHECK_OFF_STYLE}>
        <CheckIcon />
      </span>
    </button>
  )
}
