/**
 * 标签、分配人的行内编辑器：输入框加补全候选列表（ARIA combobox）。
 *
 * - 候选来自仓库（`ticket.options`），按输入过滤，已选中的不再出现；
 * - ↑↓ 选择候选，回车添加高亮的候选；没有候选匹配时回车添加输入的原文；
 * - Esc 收起编辑器，不冒泡到详情页的 Esc 返回列表；
 * - 候选列表在输入框下方占一整行，而不是浮层：窄侧栏里浮层容易被滚动容器裁掉。
 */
import * as React from 'react'

import {
  COMBO_EMPTY_STYLE,
  COMBO_LIST_STYLE,
  COMBO_OPTION_ACTIVE_STYLE,
  COMBO_OPTION_DETAIL_STYLE,
  COMBO_OPTION_STYLE,
  COMBO_SWATCH_STYLE,
} from './ticket-timeline-styles.ts'
import { DETAIL_INLINE_INPUT_STYLE, DETAIL_SMALL_BUTTON_STYLE } from './ticket-detail-styles.ts'
import { Avatar } from './ticket-visuals.tsx'

/** 一个补全候选。 */
export interface Suggestion {
  /** 写进补丁的值：标签名或用户名。 */
  readonly value: string
  /** 第二行说明：标签描述或用户显示名。 */
  readonly detail: string | null
  /** 标签颜色；分配人候选为 null，显示头像。 */
  readonly color: string | null
}

/** 候选的读取状态。 */
export type SuggestionSource =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly items: readonly Suggestion[] }
  | { readonly status: 'unavailable'; readonly reason: string }

const MAX_VISIBLE = 8

/** 行内编辑器。提交或收起都调用 `onClose`。 */
export function TokenEditor(props: {
  readonly kind: 'label' | 'assignee'
  readonly name: string
  readonly placeholder: string
  readonly busy: boolean
  readonly selected: readonly string[]
  readonly source: SuggestionSource
  readonly onAdd: (value: string) => void
  readonly onAssignSelf: (() => void) | undefined
  readonly onClose: () => void
}): React.ReactElement {
  const { kind, busy } = props
  const listId = React.useId()
  const [draft, setDraft] = React.useState('')
  const [active, setActive] = React.useState(0)
  const query = draft.trim()
  const matches = filterSuggestions(props.source, props.selected, query)
  const activeItem = matches[active]

  const submit = (value: string): void => {
    if (value.length === 0) return
    props.onAdd(value)
    props.onClose()
  }
  const onKeyDown = comboboxKeyHandler({
    count: matches.length,
    setActive,
    onSubmit: () => {
      submit(activeItem?.value ?? query)
    },
    onClose: props.onClose,
  })

  return (
    <>
      <input
        data-testid={`${kind}-input`}
        role="combobox"
        aria-label={`要添加的${props.name}`}
        aria-expanded
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeItem === undefined ? undefined : optionId(listId, active)}
        placeholder={props.placeholder}
        // 用户刚点了加号，输入框就是下一步，直接聚焦。
        autoFocus
        value={draft}
        disabled={busy}
        onChange={(event) => {
          setDraft(event.target.value)
          setActive(0)
        }}
        onKeyDown={onKeyDown}
        onBlur={(event) => {
          // 焦点移到组外且没有输入内容时收起；移到候选或按钮上不收起。
          const group = event.currentTarget.closest('[role="group"]')
          if (query.length > 0 || group?.contains(event.relatedTarget) === true) return
          props.onClose()
        }}
        style={DETAIL_INLINE_INPUT_STYLE}
      />
      <EditorButtons
        kind={kind}
        busy={busy}
        canAdd={query.length > 0}
        onAdd={() => {
          submit(query)
        }}
        onAssignSelf={props.onAssignSelf}
        onClose={props.onClose}
      />
      <SuggestionList
        listId={listId}
        kind={kind}
        source={props.source}
        matches={matches}
        active={active}
        query={query}
        onHover={setActive}
        onPick={submit}
      />
    </>
  )
}

/**
 * 输入框的键盘行为：↑↓ 循环移动高亮，回车提交，Esc 收起编辑器。
 * Esc 不冒泡，免得触发详情页的 Esc 返回列表。
 */
function comboboxKeyHandler(options: {
  readonly count: number
  readonly setActive: React.Dispatch<React.SetStateAction<number>>
  readonly onSubmit: () => void
  readonly onClose: () => void
}): (event: React.KeyboardEvent<HTMLInputElement>) => void {
  return (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (options.count === 0) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      options.setActive((index) => (index + step + options.count) % options.count)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      options.onSubmit()
    } else if (event.key === 'Escape') {
      event.stopPropagation()
      options.onClose()
    }
  }
}

/** 输入框旁的“添加”，分配人组额外有“分配给我”。 */
function EditorButtons(props: {
  readonly kind: 'label' | 'assignee'
  readonly busy: boolean
  readonly canAdd: boolean
  readonly onAdd: () => void
  readonly onAssignSelf: (() => void) | undefined
  readonly onClose: () => void
}): React.ReactElement {
  const assignSelf = props.onAssignSelf
  return (
    <>
      <button
        type="button"
        data-testid={`${props.kind}-add`}
        data-hover="soft"
        disabled={props.busy || !props.canAdd}
        onMouseDown={keepInputFocus}
        onClick={props.onAdd}
        style={DETAIL_SMALL_BUTTON_STYLE}
      >
        添加
      </button>
      {assignSelf === undefined ? null : (
        <button
          type="button"
          data-testid="assign-self"
          data-hover="soft"
          disabled={props.busy}
          onMouseDown={keepInputFocus}
          onClick={() => {
            assignSelf()
            props.onClose()
          }}
          style={DETAIL_SMALL_BUTTON_STYLE}
        >
          分配给我
        </button>
      )}
    </>
  )
}

function SuggestionList(props: {
  readonly listId: string
  readonly kind: 'label' | 'assignee'
  readonly source: SuggestionSource
  readonly matches: readonly Suggestion[]
  readonly active: number
  readonly query: string
  readonly onHover: (index: number) => void
  readonly onPick: (value: string) => void
}): React.ReactElement {
  const note = listNote(props.source, props.matches.length, props.query)
  return (
    <ul
      id={props.listId}
      role="listbox"
      data-testid={`${props.kind}-suggestions`}
      aria-label="候选"
      style={COMBO_LIST_STYLE}
    >
      {props.matches.map((item, index) => (
        <li
          key={item.value}
          id={optionId(props.listId, index)}
          role="option"
          aria-selected={index === props.active}
          data-testid={`${props.kind}-option`}
          onMouseDown={keepInputFocus}
          onMouseEnter={() => {
            props.onHover(index)
          }}
          onClick={() => {
            props.onPick(item.value)
          }}
          style={
            index === props.active
              ? { ...COMBO_OPTION_STYLE, ...COMBO_OPTION_ACTIVE_STYLE }
              : COMBO_OPTION_STYLE
          }
        >
          {item.color === null ? (
            <Avatar name={item.value} size={18} />
          ) : (
            <span style={{ ...COMBO_SWATCH_STYLE, background: item.color }} />
          )}
          <span data-option-name="" style={{ minWidth: 0 }}>
            {item.value}
          </span>
          {item.detail === null ? null : (
            <span style={COMBO_OPTION_DETAIL_STYLE}>{item.detail}</span>
          )}
        </li>
      ))}
      {note === null ? null : (
        <li role="presentation" style={COMBO_EMPTY_STYLE}>
          {note}
        </li>
      )}
    </ul>
  )
}

function listNote(source: SuggestionSource, count: number, query: string): string | null {
  if (source.status === 'loading') return '正在读取候选…'
  if (source.status === 'unavailable') return `${source.reason}可以直接输入后回车添加。`
  if (count > 0) return null
  return query.length === 0 ? '没有更多候选。' : `没有匹配的候选，回车添加“${query}”。`
}

/**
 * 按输入过滤候选：名称或说明包含输入（不分大小写），排除已选中的值；
 * 名称以输入开头的排在前面，最多显示 8 个。
 */
function filterSuggestions(
  source: SuggestionSource,
  selected: readonly string[],
  query: string,
): readonly Suggestion[] {
  if (source.status !== 'ready') return []
  const needle = query.toLowerCase()
  const matches = source.items.filter((item) => {
    if (selected.includes(item.value)) return false
    if (needle.length === 0) return true
    return (
      item.value.toLowerCase().includes(needle) ||
      (item.detail?.toLowerCase().includes(needle) ?? false)
    )
  })
  const startsWith = (item: Suggestion): number =>
    item.value.toLowerCase().startsWith(needle) ? 0 : 1
  return [...matches].sort((a, b) => startsWith(a) - startsWith(b)).slice(0, MAX_VISIBLE)
}

function optionId(listId: string, index: number): string {
  return `${listId}-${String(index)}`
}

/**
 * 点候选或按钮时不让输入框先失焦：有的浏览器点击不给目标焦点，
 * 失焦收起会在 click 之前卸载目标，这次点击就丢了。
 */
function keepInputFocus(event: React.MouseEvent): void {
  event.preventDefault()
}
