/**
 * 删除工单：入口藏在头部的“更多”菜单里，确认要手动输入 `delete`。
 *
 * 两道关：先要打开菜单、点“删除工单…”，再要在确认面板里输入确认词，删除按钮才可用。
 * 只有宿主确认当前用户有删除权限（`capabilities.delete`）时才出现菜单。
 */
import * as React from 'react'

import { TICKET_DELETE_CONFIRMATION, type RpcErrorBody } from '../protocol/tracker.ts'
import { errorText } from './error-text.ts'
import { MoreIcon, TrashIcon } from './icons.tsx'
import { useI18n } from './i18n.tsx'
import { DETAIL_BUTTON_STYLE, DETAIL_INPUT_STYLE } from './ticket-detail-styles.ts'
import {
  DANGER_BUTTON_STYLE,
  DELETE_PANEL_ACTIONS_STYLE,
  DELETE_PANEL_STYLE,
  DELETE_PANEL_TEXT_STYLE,
  DELETE_PANEL_TITLE_STYLE,
  MENU_ITEM_DANGER_STYLE,
  MENU_STYLE,
  MENU_TRIGGER_STYLE,
  MENU_WRAPPER_STYLE,
} from './ticket-timeline-styles.ts'

/** 头部右侧的“更多”菜单；目前只有删除一项。 */
export function MoreMenu(props: { readonly onDelete: () => void }): React.ReactElement {
  const { t } = useI18n()
  const [open, setOpen] = React.useState(false)
  const wrapper = React.useRef<HTMLDivElement>(null)
  const menuId = React.useId()

  React.useEffect(() => {
    if (!open) return
    // 点菜单外任意位置收起。
    const onPointer = (event: MouseEvent): void => {
      if (wrapper.current?.contains(event.target as Node) !== true) setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => {
      document.removeEventListener('mousedown', onPointer)
    }
  }, [open])

  return (
    <div
      ref={wrapper}
      style={MENU_WRAPPER_STYLE}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          // 只收起菜单，不冒泡到详情页的 Esc 返回列表。
          event.stopPropagation()
          setOpen(false)
        }
      }}
    >
      <button
        type="button"
        data-testid="detail-more"
        data-hover="soft"
        aria-label={t('detail.delete.more')}
        title={t('detail.delete.more')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setOpen((value) => !value)
        }}
        style={MENU_TRIGGER_STYLE}
      >
        <MoreIcon />
      </button>
      {open ? (
        <div id={menuId} role="menu" aria-label={t('detail.delete.more')} style={MENU_STYLE}>
          <button
            type="button"
            role="menuitem"
            data-testid="detail-delete"
            data-hover="secondary"
            // 菜单一打开就把焦点放在唯一的菜单项上，键盘用户直接回车或 Esc。
            autoFocus
            onClick={() => {
              setOpen(false)
              props.onDelete()
            }}
            style={MENU_ITEM_DANGER_STYLE}
          >
            <TrashIcon />
            {t('detail.delete.menu')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

/** 删除确认面板：说明后果，输入确认词后才能删除。 */
export function DeleteConfirm(props: {
  readonly refText: string
  readonly title: string
  readonly backendLabel: string
  readonly deleting: boolean
  readonly error: RpcErrorBody | null
  readonly onCancel: () => void
  readonly onConfirm: () => void
}): React.ReactElement {
  const { t } = useI18n()
  const [typed, setTyped] = React.useState('')
  const titleId = React.useId()
  const inputId = React.useId()
  const confirmed = typed.trim() === TICKET_DELETE_CONFIRMATION

  return (
    <section
      role="alertdialog"
      aria-labelledby={titleId}
      data-testid="delete-confirm"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !props.deleting) {
          event.stopPropagation()
          props.onCancel()
        }
      }}
      style={DELETE_PANEL_STYLE}
    >
      <h3 id={titleId} style={DELETE_PANEL_TITLE_STYLE}>
        {t('detail.delete.title', { ref: props.refText })}
      </h3>
      <p style={DELETE_PANEL_TEXT_STYLE}>
        {t('detail.delete.body', { title: props.title, backend: props.backendLabel })}
      </p>
      <label htmlFor={inputId} style={DELETE_PANEL_TEXT_STYLE}>
        {t('detail.delete.confirmBefore')}
        <code>{TICKET_DELETE_CONFIRMATION}</code>
        {t('detail.delete.confirmAfter')}
      </label>
      <input
        id={inputId}
        data-testid="delete-confirm-input"
        autoFocus
        autoComplete="off"
        spellCheck={false}
        value={typed}
        disabled={props.deleting}
        onChange={(event) => {
          setTyped(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && confirmed && !props.deleting) props.onConfirm()
        }}
        style={DETAIL_INPUT_STYLE}
      />
      {props.error === null ? null : (
        <div role="alert" data-testid="delete-error" style={DELETE_PANEL_TEXT_STYLE}>
          {errorText(props.error, t)}
        </div>
      )}
      <DeleteActions
        confirmed={confirmed}
        deleting={props.deleting}
        onCancel={props.onCancel}
        onConfirm={props.onConfirm}
      />
    </section>
  )
}

function DeleteActions(props: {
  readonly confirmed: boolean
  readonly deleting: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
}): React.ReactElement {
  const { t } = useI18n()
  return (
    <div style={DELETE_PANEL_ACTIONS_STYLE}>
      <button
        type="button"
        data-testid="delete-cancel"
        data-hover="soft"
        disabled={props.deleting}
        onClick={props.onCancel}
        style={DETAIL_BUTTON_STYLE}
      >
        {t('detail.delete.cancel')}
      </button>
      <button
        type="button"
        data-testid="delete-submit"
        data-hover="primary"
        disabled={!props.confirmed || props.deleting}
        onClick={props.onConfirm}
        style={DANGER_BUTTON_STYLE}
      >
        {props.deleting ? t('detail.delete.deleting') : t('detail.delete.confirm')}
      </button>
    </div>
  )
}
