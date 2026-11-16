/**
 * 工单详情里的操作与可写属性。
 *
 * - 头部操作：关闭/重开、复制链接，放在导航行右侧（技能按钮在详情视图里与它们同排）；
 * - 属性条：标签与分配人各成一组，挤在一行里，窄面板时自然换行；加号展开带补全的输入框。
 *   标签按仓库颜色着色，分配人带头像。
 *
 * 能力缺失时对应控件不出现，属性条下用一句话说明「哪个后端、缺哪些能力」；
 * 写操作期间控件禁用，避免重复提交。所有写操作都交给父组件的同一个提交入口。
 */
import * as React from 'react'

import type { TicketDetail, TicketPatch } from '../protocol/tracker.ts'
import { backendLabel } from './backend-label.ts'
import {
  CheckIcon,
  CloseIcon,
  LinkIcon,
  PersonIcon,
  PlusIcon,
  RefreshIcon,
  TagIcon,
} from './icons.tsx'
import { useI18n } from './i18n.tsx'
import type { MessageKey } from './messages.ts'
import { COLORS } from './task-panel-styles.ts'
import { TokenEditor, type SuggestionSource } from './ticket-combobox.tsx'
import {
  DETAIL_ADD_STYLE,
  DETAIL_ERROR_STYLE,
  DETAIL_GROUP_ICON_STYLE,
  DETAIL_GROUP_STYLE,
  DETAIL_HINT_STYLE,
  DETAIL_INPUT_STYLE,
  DETAIL_STACK_STYLE,
  DETAIL_STRIP_STYLE,
  DETAIL_TOKEN_EMPTY_STYLE,
  DETAIL_TOKEN_REMOVE_STYLE,
  DETAIL_TOKEN_STYLE,
  HEADER_CLOSE_STYLE,
  HEADER_ICON_BUTTON_STYLE,
  HEADER_TEXT_BUTTON_STYLE,
  VISUALLY_HIDDEN_STYLE,
} from './ticket-detail-styles.ts'
import { Avatar, labelColorStyle } from './ticket-visuals.tsx'

/** 写操作相关的共用参数。 */
export interface FieldProps {
  readonly detail: TicketDetail
  /** 有写操作进行中：所有写控件禁用。 */
  readonly busy: boolean
  readonly onApply: (patch: TicketPatch) => void
}

/** 复制链接的结果；“已复制”两秒后自动回到 idle。 */
export interface CopyState {
  readonly status: 'idle' | 'copied' | 'failed'
  readonly message?: string
}

/**
 * 头部右侧的工单操作：关闭/重开、刷新、复制链接。都是低频动作，放在导航行里不占正文区域；
 * 刷新是图标按钮，重读期间禁用、变暗并换成「正在刷新工单…」；
 * 关闭用错误色文字，复制成功后图标短暂变成对勾。
 */
export function HeaderActions(
  props: FieldProps & {
    readonly copy: CopyState
    readonly onCopy: () => void
    readonly onRefresh: () => void
    readonly refreshing: boolean
    /** 刷新不可用：刷新中、写操作进行中或删除确认面板打开。 */
    readonly refreshDisabled: boolean
  },
): React.ReactElement {
  const { t } = useI18n()
  const { detail, busy } = props
  const next = detail.state === 'open' ? 'closed' : 'open'
  const copied = props.copy.status === 'copied'
  const refreshLabel = props.refreshing ? t('detail.refreshing') : t('detail.refresh')

  return (
    <>
      {detail.capabilities.state ? (
        <button
          type="button"
          data-testid="detail-state-toggle"
          // 关闭是破坏性较强的动作：错误色文字、悬停浅红底；重开是普通动作。
          data-hover={next === 'closed' ? 'secondary' : 'soft'}
          disabled={busy}
          onClick={() => {
            props.onApply({ state: next })
          }}
          style={next === 'closed' ? HEADER_CLOSE_STYLE : HEADER_TEXT_BUTTON_STYLE}
        >
          {t(next === 'closed' ? 'detail.close' : 'detail.reopen')}
        </button>
      ) : null}
      <button
        type="button"
        data-testid="detail-refresh"
        data-hover="soft"
        disabled={props.refreshDisabled}
        aria-label={refreshLabel}
        title={refreshLabel}
        onClick={props.onRefresh}
        style={{ ...HEADER_ICON_BUTTON_STYLE, opacity: props.refreshDisabled ? 0.6 : 1 }}
      >
        <RefreshIcon />
      </button>
      {detail.url === null ? null : (
        <button
          type="button"
          data-testid="detail-copy"
          data-hover="soft"
          aria-label={t('detail.copyLink')}
          title={copied ? t('detail.copied') : t('detail.copyLinkTitle', { url: detail.url })}
          onClick={props.onCopy}
          style={
            copied
              ? { ...HEADER_ICON_BUTTON_STYLE, color: COLORS.success }
              : HEADER_ICON_BUTTON_STYLE
          }
        >
          {copied ? <CheckIcon /> : <LinkIcon />}
        </button>
      )}
      {copied ? (
        <span role="status" data-testid="copy-notice" style={VISUALLY_HIDDEN_STYLE}>
          {t('detail.copiedNotice')}
        </span>
      ) : null}
    </>
  )
}

/** 复制失败：说明原因，并把地址放进只读输入框（聚焦即全选）供手动复制。 */
export function CopyFailure(props: {
  readonly copy: CopyState
  readonly url: string | null
}): React.ReactElement | null {
  const { t } = useI18n()
  const { copy, url } = props
  if (copy.status !== 'failed' || url === null) return null
  return (
    <div
      role="alert"
      data-testid="copy-error"
      style={{ ...DETAIL_ERROR_STYLE, ...DETAIL_STACK_STYLE }}
    >
      {copy.message}
      <input
        data-testid="detail-link"
        aria-label={t('detail.linkLabel')}
        readOnly
        value={url}
        onFocus={(event) => {
          event.currentTarget.select()
        }}
        style={DETAIL_INPUT_STYLE}
      />
    </div>
  )
}

/** 补全候选与标签颜色：由详情视图按需读取一次，展开编辑器时才请求。 */
export interface OptionsState {
  readonly labels: SuggestionSource
  readonly assignees: SuggestionSource
  /** 标签名到 `#rrggbb` 颜色；没读到或没有颜色的标签不在表里。 */
  readonly labelColors: ReadonlyMap<string, string>
  /** 请求候选；已读到或正在读时什么也不做。 */
  readonly request: () => void
}

/** 属性条：标签组与分配人组同一行；后端缺的能力在下方一句话说明。 */
export function PropertyStrip(
  props: FieldProps & { readonly options: OptionsState },
): React.ReactElement {
  const { t } = useI18n()
  const { detail, busy, options } = props
  const unsupported = unsupportedActions(detail)

  return (
    <div style={DETAIL_STACK_STYLE}>
      <div style={DETAIL_STRIP_STYLE}>
        <TokenGroup
          kind="label"
          name={t('detail.labels')}
          icon={<TagIcon />}
          values={detail.labels}
          colors={options.labelColors}
          emptyText={t('detail.noLabels')}
          placeholder={t('detail.labelPlaceholder')}
          editable={detail.capabilities.labels}
          busy={busy}
          source={options.labels}
          onOpen={options.request}
          onChange={(labels) => {
            props.onApply({ labels })
          }}
        />
        <TokenGroup
          kind="assignee"
          name={t('detail.assignees')}
          icon={<PersonIcon />}
          values={detail.assignees}
          colors={null}
          emptyText={t('detail.noAssignees')}
          placeholder={t('detail.assigneePlaceholder')}
          editable={detail.capabilities.assignees}
          busy={busy}
          source={options.assignees}
          onOpen={options.request}
          onChange={(assignees) => {
            props.onApply({ assignees })
          }}
          onAssignSelf={() => {
            props.onApply({ assignSelf: true })
          }}
        />
      </div>
      {unsupported.length === 0 ? null : (
        <div data-testid="detail-unsupported-note" style={DETAIL_HINT_STYLE}>
          {t('detail.unsupported', {
            backend: backendLabel(detail.backend, t),
            actions: unsupported.map((key) => t(key)).join(t('common.listSeparator')),
          })}
        </div>
      )}
    </div>
  )
}

/** 一组小块（标签或分配人）：前导图标、已有值、加号；加号展开带补全的编辑器。 */
function TokenGroup(props: {
  readonly kind: 'label' | 'assignee'
  readonly name: string
  readonly icon: React.ReactElement
  readonly values: readonly string[]
  /** 标签颜色表；分配人组为 null，小块显示头像。 */
  readonly colors: ReadonlyMap<string, string> | null
  readonly emptyText: string
  readonly placeholder: string
  readonly editable: boolean
  readonly busy: boolean
  readonly source: SuggestionSource
  readonly onOpen: () => void
  readonly onChange: (values: string[]) => void
  readonly onAssignSelf?: () => void
}): React.ReactElement {
  const { kind, values, busy } = props
  const [editing, setEditing] = React.useState(false)

  return (
    <div
      role="group"
      aria-label={props.name}
      data-testid={kind === 'label' ? 'detail-labels' : 'detail-assignees'}
      // 编辑时整组占满一行，候选列表才有地方展开。
      style={editing ? { ...DETAIL_GROUP_STYLE, flexBasis: '100%' } : DETAIL_GROUP_STYLE}
    >
      <span title={props.name} style={DETAIL_GROUP_ICON_STYLE}>
        {props.icon}
      </span>
      {values.length === 0 && !editing ? (
        <span style={DETAIL_TOKEN_EMPTY_STYLE}>{props.emptyText}</span>
      ) : null}
      {values.map((value) => (
        <Token
          key={value}
          kind={kind}
          name={props.name}
          value={value}
          color={props.colors === null ? undefined : (props.colors.get(value) ?? null)}
          editable={props.editable}
          busy={busy}
          onRemove={() => {
            props.onChange(values.filter((item) => item !== value))
          }}
        />
      ))}
      {!props.editable ? null : editing ? (
        <TokenEditor
          kind={kind}
          name={props.name}
          placeholder={props.placeholder}
          busy={busy}
          selected={values}
          source={props.source}
          onAdd={(value) => {
            if (!values.includes(value)) props.onChange([...values, value])
          }}
          onAssignSelf={props.onAssignSelf}
          onClose={() => {
            setEditing(false)
          }}
        />
      ) : (
        <AddTokenButton
          kind={kind}
          name={props.name}
          busy={busy}
          onOpen={() => {
            props.onOpen()
            setEditing(true)
          }}
        />
      )}
    </div>
  )
}

function AddTokenButton(props: {
  readonly kind: 'label' | 'assignee'
  readonly name: string
  readonly busy: boolean
  readonly onOpen: () => void
}): React.ReactElement {
  const { t } = useI18n()
  return (
    <button
      type="button"
      data-testid={`${props.kind}-edit`}
      data-hover="soft"
      aria-label={t('detail.add', { name: props.name })}
      title={t('detail.add', { name: props.name })}
      disabled={props.busy}
      onClick={props.onOpen}
      style={DETAIL_ADD_STYLE}
    >
      <PlusIcon />
    </button>
  )
}

/**
 * 一个标签或分配人小块；可写时带圆形移除按钮。
 * 标签按仓库颜色着色（`color` 为 null 表示没有颜色）；分配人（`color` 为 undefined）带头像。
 */
function Token(props: {
  readonly kind: 'label' | 'assignee'
  readonly name: string
  readonly value: string
  readonly color: string | null | undefined
  readonly editable: boolean
  readonly busy: boolean
  readonly onRemove: () => void
}): React.ReactElement {
  const { t } = useI18n()
  const label = t('detail.remove', { name: props.name, value: props.value })
  const isAssignee = props.color === undefined
  const style: React.CSSProperties = {
    ...DETAIL_TOKEN_STYLE,
    ...(isAssignee ? { paddingLeft: 2 } : labelColorStyle(props.color ?? null)),
    ...(props.editable ? {} : { paddingRight: 9 }),
  }

  return (
    <span data-testid={`${props.kind}-chip`} style={style}>
      {isAssignee ? <Avatar name={props.value} size={16} /> : null}
      <span data-token-name="" style={isAssignee ? { marginLeft: 3 } : undefined}>
        {props.value}
      </span>
      {props.editable ? (
        <button
          type="button"
          data-testid={`${props.kind}-remove`}
          data-hover="soft"
          aria-label={label}
          title={label}
          disabled={props.busy}
          onClick={props.onRemove}
          style={{ ...DETAIL_TOKEN_REMOVE_STYLE, color: 'inherit', opacity: 0.7 }}
        >
          <CloseIcon />
        </button>
      ) : null}
    </span>
  )
}

function unsupportedActions(detail: TicketDetail): MessageKey[] {
  // 与宿主 `capability-unsupported` 的文案保持同一句式：哪个后端、缺哪项能力。
  const actions: MessageKey[] = []
  if (!detail.capabilities.labels) actions.push('detail.unsupported.labels')
  if (!detail.capabilities.assignees) actions.push('detail.unsupported.assignees')
  if (!detail.capabilities.state) actions.push('detail.unsupported.state')
  if (detail.url === null) actions.push('detail.unsupported.link')
  return actions
}
