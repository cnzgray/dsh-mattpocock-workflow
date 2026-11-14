/**
 * 工单详情视图（GitHub issue 风格）：
 *
 * - 头部：返回、编号（远端链接）、后端徽标；右侧是技能按钮、关闭/重开、复制链接，
 *   以及有删除权限时才出现的“更多”菜单；
 * - 标题区：标题、实心状态徽标、作者与时间、评论数，紧跟属性条（见 ticket-detail-fields）；
 * - 时间线：正文卡片与评论卡片（见 ticket-timeline）。
 *
 * 详情不自动注入提示词：浏览与开工是两个动作，注入由明确的技能按钮触发。
 * 技能动作来自列表快照（判定在 core，只有一处），按钮与列表行徽标共用同一个组件；
 * 写操作后宿主会重建快照，这里用刷新后的快照更新徽标，不重新判定。
 * 数据读取与写操作在 ticket-detail-hooks 里。
 */
import * as React from 'react'

import { BACKEND_LABELS } from '../protocol/backend.ts'
import type {
  RpcErrorBody,
  TicketDetail,
  TicketPatch,
  TicketSnapshot,
} from '../protocol/tracker.ts'
import { errorText } from './error-text.ts'
import { ChevronLeftIcon } from './icons.tsx'
import type { PromptInjection } from './injection.ts'
import type { PanelClient } from './rpc.ts'
import { SkillActionBadge } from './skill-action-badge.tsx'
import {
  BACKEND_BADGE_STYLE,
  BUTTON_STYLE,
  EMPTY_STYLE,
  ERROR_STYLE,
  STATUS_DOT_STYLE,
} from './task-panel-styles.ts'
import { DeleteConfirm, MoreMenu } from './ticket-delete.tsx'
import {
  CopyFailure,
  HeaderActions,
  PropertyStrip,
  type CopyState,
  type OptionsState,
} from './ticket-detail-fields.tsx'
import {
  useCopyLink,
  useDetailRequest,
  useEscapeKey,
  useTicketDeletion,
  useTicketMutation,
  useTicketOptions,
  type TicketDeletion,
} from './ticket-detail-hooks.ts'
import {
  DETAIL_BACK_STYLE,
  DETAIL_ERROR_STYLE,
  DETAIL_HEADER_STYLE,
  DETAIL_HINT_STYLE,
  DETAIL_REF_LINK_STYLE,
  DETAIL_REF_STYLE,
  DETAIL_ROOT_STYLE,
  DETAIL_SCROLL_STYLE,
  DETAIL_STACK_STYLE,
  DETAIL_TITLE_STYLE,
} from './ticket-detail-styles.ts'
import { Timeline, formatTime } from './ticket-timeline.tsx'
import {
  STATE_PILL_STYLES,
  TITLE_META_NAME_STYLE,
  TITLE_META_ROW_STYLE,
} from './ticket-timeline-styles.ts'
import { useTicketActions } from './ticket-actions.ts'

/** 工单详情视图依赖。 */
export interface TicketDetailViewProps {
  readonly client: PanelClient
  readonly workspaceRoot: string
  /** 列表里选中的那张票：详情按它的引用加载，技能动作也来自它（写操作后按刷新结果更新）。 */
  readonly ticket: TicketSnapshot
  readonly injection: PromptInjection
  /** 返回列表；Esc、返回按钮与删除成功后都走这里。 */
  readonly onBack: () => void
}

/** 工单详情视图。 */
export function TicketDetailView(props: TicketDetailViewProps): React.ReactElement {
  const { client, workspaceRoot, ticket } = props
  const ref = ticket.ref
  const number = ticket.number
  const request = useDetailRequest(client, workspaceRoot, ref, number)
  const detail = request.detail
  // 技能徽标跟着宿主刷新后的快照走：关单/改标签后动作可能变成“已关闭”或换一个技能。
  const [currentTicket, setCurrentTicket] = React.useState(ticket)
  React.useEffect(() => {
    setCurrentTicket(ticket)
  }, [ticket])
  const mutation = useTicketMutation(client, {
    workspaceRoot,
    ref,
    number,
    onUpdated: request.replace,
    onSnapshot: (snapshot) => {
      const next = snapshot.tickets.find((item) => item.ref === ref)
      if (next !== undefined) setCurrentTicket(next)
    },
  })
  const deletion = useTicketDeletion(client, {
    workspaceRoot,
    ref,
    number,
    onDeleted: props.onBack,
  })
  const options = useTicketOptions(client, workspaceRoot, detail?.capabilities.labels === true)
  const { injected, notice, onSkillAction } = useTicketActions(workspaceRoot, props.injection)
  const link = useCopyLink(detail?.url ?? null)
  const busy = mutation.busy || deletion.deleting
  useEscapeKey(props.onBack)

  return (
    <div data-testid="ticket-detail" style={DETAIL_ROOT_STYLE}>
      <DetailHeader refText={ref} detail={detail} onBack={props.onBack}>
        <SkillActionBadge
          ticket={currentTicket}
          injected={injected === currentTicket.ref && currentTicket.skillAction !== 'none'}
          injection={props.injection}
          onSkillAction={onSkillAction}
        />
        {detail === null ? null : (
          <HeaderActions
            detail={detail}
            busy={busy}
            onApply={mutation.apply}
            copy={link.copy}
            onCopy={link.onCopy}
          />
        )}
        {detail?.capabilities.delete === true ? <MoreMenu onDelete={deletion.open} /> : null}
      </DetailHeader>
      {detail !== null ? (
        <DetailContent
          detail={detail}
          busy={busy}
          mutationError={mutation.error}
          copy={link.copy}
          notice={notice}
          options={options}
          deletion={deletion}
          onApply={mutation.apply}
        />
      ) : request.phase === 'error' ? (
        <LoadError error={request.error} onRetry={request.reload} />
      ) : (
        <div data-testid="detail-loading" style={EMPTY_STYLE}>
          正在读取工单详情…
        </div>
      )}
    </div>
  )
}

function DetailHeader(props: {
  readonly refText: string
  readonly detail: TicketDetail | null
  readonly onBack: () => void
  /** 右侧的技能按钮、工单操作与更多菜单。 */
  readonly children: React.ReactNode
}): React.ReactElement {
  const { detail } = props
  const url = detail?.url ?? null

  return (
    <header style={DETAIL_HEADER_STYLE}>
      <button
        type="button"
        data-testid="detail-back"
        data-hover="soft"
        title="返回列表（Esc）"
        onClick={props.onBack}
        style={DETAIL_BACK_STYLE}
      >
        <ChevronLeftIcon />
        返回列表
      </button>
      {url === null ? (
        <span data-testid="detail-ref" title={props.refText} style={DETAIL_REF_STYLE}>
          {props.refText}
        </span>
      ) : (
        <a
          data-testid="detail-ref"
          data-hover="link"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          title={`在浏览器打开 ${url}`}
          style={DETAIL_REF_LINK_STYLE}
        >
          {props.refText}
        </a>
      )}
      {detail === null ? null : (
        <span data-testid="detail-backend" style={BACKEND_BADGE_STYLE}>
          {BACKEND_LABELS[detail.backend]}
        </span>
      )}
      {/* 左边是身份（编号、后端），右边是工单操作。 */}
      <span style={{ flex: 1 }} />
      {props.children}
    </header>
  )
}

function DetailContent(props: {
  readonly detail: TicketDetail
  readonly busy: boolean
  readonly mutationError: RpcErrorBody | null
  readonly copy: CopyState
  /** 提示词注入失败的说明；成功时为空。 */
  readonly notice: string | null
  readonly options: OptionsState
  readonly deletion: TicketDeletion
  readonly onApply: (patch: TicketPatch) => void
}): React.ReactElement {
  const { detail, deletion } = props
  const fieldProps = { detail, busy: props.busy, onApply: props.onApply }

  return (
    <div data-testid="detail-content" aria-busy={props.busy} style={DETAIL_SCROLL_STYLE}>
      {deletion.confirming ? (
        <DeleteConfirm
          refText={detail.ref}
          title={detail.title}
          backendLabel={BACKEND_LABELS[detail.backend]}
          deleting={deletion.deleting}
          error={deletion.error}
          onCancel={deletion.cancel}
          onConfirm={deletion.confirm}
        />
      ) : null}
      <CopyFailure copy={props.copy} url={detail.url} />
      {props.notice === null ? null : (
        <div role="status" data-testid="inject-notice" style={DETAIL_HINT_STYLE}>
          {props.notice}
        </div>
      )}
      <TitleBlock detail={detail} />
      <PropertyStrip {...fieldProps} options={props.options} />
      {props.mutationError === null ? null : (
        <div role="alert" data-testid="detail-error" style={DETAIL_ERROR_STYLE}>
          {errorText(props.mutationError)}
        </div>
      )}
      <Timeline detail={detail} />
    </div>
  )
}

const NOWRAP_STYLE: React.CSSProperties = { whiteSpace: 'nowrap' }

/** 标题、实心状态徽标，以及“谁在何时创建、更新时间、几条评论”。 */
function TitleBlock(props: { readonly detail: TicketDetail }): React.ReactElement {
  const { detail } = props
  return (
    <div style={DETAIL_STACK_STYLE}>
      <h2 data-testid="detail-title" title={detail.title} style={DETAIL_TITLE_STYLE}>
        {detail.title}
      </h2>
      <div data-testid="detail-meta" style={TITLE_META_ROW_STYLE}>
        <span data-testid="detail-state" style={STATE_PILL_STYLES[detail.state]}>
          <span style={STATUS_DOT_STYLE} aria-hidden="true" />
          {detail.state === 'open' ? '开放' : '已关闭'}
        </span>
        {/* 每段整体不断行，分隔点跟在上一段末尾，换行时新行不会以“·”开头。 */}
        <span style={NOWRAP_STYLE}>
          {detail.author === null ? null : (
            <span style={TITLE_META_NAME_STYLE}>{detail.author} </span>
          )}
          创建于 {formatTime(detail.createdAt)} ·
        </span>
        <span style={NOWRAP_STYLE}>更新于 {formatTime(detail.updatedAt)} ·</span>
        <span style={NOWRAP_STYLE}>{detail.comments.length} 条评论</span>
      </div>
    </div>
  )
}

function LoadError(props: {
  readonly error: RpcErrorBody | null
  readonly onRetry: () => void
}): React.ReactElement {
  return (
    <div style={DETAIL_SCROLL_STYLE}>
      <div role="alert" data-testid="detail-load-error" style={ERROR_STYLE}>
        <div>{props.error === null ? '读取工单详情失败。' : errorText(props.error)}</div>
        <button
          type="button"
          data-testid="detail-retry"
          data-hover="soft"
          onClick={props.onRetry}
          style={{ ...BUTTON_STYLE, marginTop: 6 }}
        >
          重试
        </button>
      </div>
    </div>
  )
}
