/**
 * 工单详情视图（GitHub issue 风格）：
 *
 * - 头部：返回、编号（远端链接）、后端徽标；右侧是技能按钮、关闭/重开、刷新、复制链接，
 *   以及有删除权限时才出现的“更多”菜单；刷新失败的原因固定在这行下面、不随正文滚走；
 * - 标题区：标题、实心状态徽标、作者与时间、评论数，紧跟属性条（见 ticket-detail-fields）；
 * - 阻塞项：被阻塞且快照里有引用时，头部的「阻塞 N」是 disclosure，展开的列表是滚动区的第一块；
 * - 时间线：正文卡片与评论卡片（见 ticket-timeline）。
 *
 * 详情不自动注入提示词：浏览与开工是两个动作，注入由明确的技能按钮触发。
 * 技能动作来自列表快照（判定在 core，只有一处），按钮与列表行徽标共用同一个组件；
 * 写操作后宿主会重建快照，这里用刷新后的快照更新徽标，不重新判定。
 * 按引用打开、快照里没有这张票时只渲染详情数据，不伪造技能徽标与阻塞入口。
 * 手动刷新并行做两件事：重读这张票，并让面板增量刷新列表快照；两者互不等待。
 * 数据读取与写操作在 ticket-detail-hooks 里。
 */
import * as React from 'react'

import type {
  RpcErrorBody,
  TicketDetail,
  TicketPatch,
  TicketSnapshot,
  WorkspaceSnapshot,
} from '../protocol/tracker.ts'
import { backendLabel } from './backend-label.ts'
import { errorText } from './error-text.ts'
import { ChevronLeftIcon } from './icons.tsx'
import { useI18n } from './i18n.tsx'
import type { InjectionTarget, PromptInjection } from './injection.ts'
import type { PanelClient } from './rpc.ts'
import { SkillActionBadge } from './skill-action-badge.tsx'
import { actionBadgeLabel, actionHint } from './skill-action-text.ts'
import {
  BACKEND_BADGE_STYLE,
  BUTTON_STYLE,
  EMPTY_STYLE,
  ERROR_STYLE,
  STATUS_DOT_STYLE,
} from './task-panel-styles.ts'
import {
  BlockersSection,
  BlockersToggle,
  blockerItems,
  findSnapshotTicket,
  type BlockerItem,
} from './ticket-blockers.tsx'
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
  type DetailRequest,
  type TicketDeletion,
  type TicketMutation,
} from './ticket-detail-hooks.ts'
import {
  DETAIL_BACK_LABEL_STYLE,
  DETAIL_BACK_STYLE,
  DETAIL_ERROR_STYLE,
  DETAIL_HEADER_STYLE,
  DETAIL_HINT_STYLE,
  DETAIL_REF_LINK_STYLE,
  DETAIL_REF_STYLE,
  DETAIL_REFRESH_ERROR_STYLE,
  DETAIL_ROOT_STYLE,
  DETAIL_SCROLL_STYLE,
  DETAIL_STACK_STYLE,
  DETAIL_TITLE_STYLE,
} from './ticket-detail-styles.ts'
import { Timeline, formatTime } from './ticket-timeline.tsx'
import { createAttachmentLoader, type AttachmentLoader } from './attachment-loader.ts'
import {
  STATE_PILL_STYLES,
  TITLE_META_NAME_STYLE,
  TITLE_META_ROW_STYLE,
} from './ticket-timeline-styles.ts'
import { useTicketActions } from './ticket-actions.ts'

/** 详情要打开的工单：引用与编号负责读取，快照行只用于头部判定。 */
export interface DetailTarget {
  /** 工单引用：远端是 `#15`，本地 Markdown 是相对工作区的文件路径。 */
  readonly ref: string
  /** 数字编号；本地 Markdown 没有编号，为 null。 */
  readonly number: number | null
  /** 当前快照里的那一行；按引用打开、快照里没有这张票时为 null。 */
  readonly ticket: TicketSnapshot | null
}

/** 工单详情视图依赖。 */
export interface TicketDetailViewProps {
  readonly client: PanelClient
  readonly workspaceRoot: string
  /** 要打开的工单：详情按引用与编号加载，技能动作来自可选的快照行。 */
  readonly target: DetailTarget
  /** 当前快照的全部行：阻塞项按引用查标题与状态。 */
  readonly snapshotTickets: readonly TicketSnapshot[]
  readonly injection: PromptInjection
  /** 返回上一层；Esc、返回按钮与删除成功后都走这里。栈空时面板回列表。 */
  readonly onBack: () => void
  /** 有上一张票时返回按钮显示“返回 {ref}”；null 时显示“返回列表”。 */
  readonly backRef: string | null
  /** 打开一条阻塞项：只导航，不注入提示词。 */
  readonly onOpenBlocker: (ref: string) => void
  /**
   * 面板的增量刷新入口：手动刷新详情时一并更新列表快照，
   * 使技能徽标、返回列表后的行与数据时间跟上。
   */
  readonly onRefreshSnapshot: () => void
}

/** 工单详情视图。 */
export function TicketDetailView(props: TicketDetailViewProps): React.ReactElement {
  const { t } = useI18n()
  const { client, workspaceRoot } = props
  const {
    ref,
    request,
    detail,
    loadAttachment,
    currentTicket,
    blockers,
    canExpandBlockers,
    blockersExpanded,
    toggleBlockers,
    mutation,
    deletion,
  } = useDetailViewState(props)
  const options = useTicketOptions(client, workspaceRoot, detail?.capabilities.labels === true)
  const { injected, notice, onSkillAction } = useTicketActions(workspaceRoot, props.injection)
  const link = useCopyLink(detail?.url ?? null, t)
  const { busy, refreshDisabled, onRefresh } = refreshControls(request, {
    onRefreshSnapshot: props.onRefreshSnapshot,
    writeBusy: mutation.busy || deletion.deleting,
    confirming: deletion.confirming,
  })
  useEscapeKey(props.onBack)

  return (
    <div data-testid="ticket-detail" style={DETAIL_ROOT_STYLE}>
      <DetailHeader refText={ref} detail={detail} backRef={props.backRef} onBack={props.onBack}>
        <TicketHeaderAction
          ticket={currentTicket}
          canExpandBlockers={canExpandBlockers}
          expanded={blockersExpanded}
          onToggleBlockers={toggleBlockers}
          injected={injected}
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
            onRefresh={onRefresh}
            refreshing={request.refreshing}
            refreshDisabled={refreshDisabled}
          />
        )}
        {detail?.capabilities.delete === true ? <MoreMenu onDelete={deletion.open} /> : null}
      </DetailHeader>
      <RefreshFailure error={request.refreshError} />
      <DetailStage
        request={request}
        detail={detail}
        loadAttachment={loadAttachment}
        busy={busy}
        mutationError={mutation.error}
        copy={link.copy}
        notice={notice}
        options={options}
        deletion={deletion}
        blockers={blockers}
        blockersExpanded={blockersExpanded}
        onOpenBlocker={props.onOpenBlocker}
        onApply={mutation.apply}
      />
    </div>
  )
}

/** 详情视图的请求、当前快照行与阻塞项展开状态。 */
function useDetailViewState(props: TicketDetailViewProps): {
  readonly ref: string
  readonly request: DetailRequest
  readonly detail: TicketDetail | null
  readonly loadAttachment: AttachmentLoader
  readonly currentTicket: TicketSnapshot | null
  readonly blockers: readonly BlockerItem[]
  readonly canExpandBlockers: boolean
  readonly blockersExpanded: boolean
  readonly toggleBlockers: () => void
  readonly mutation: TicketMutation
  readonly deletion: TicketDeletion
} {
  const { client, workspaceRoot } = props
  const { ref, number, ticket } = props.target
  // 技能徽标与阻塞项跟着宿主刷新后的快照走：关单/改标签后动作可能变成“已关闭”或换一个技能。
  // 排在取数钩子前面：列表里这张票的更新时间是详情缓存的有效性键。
  const { current: currentTicket, updateFromSnapshot } = useCurrentTicket(ref, ticket)
  const request = useDetailRequest(client, workspaceRoot, ref, number, currentTicket?.updatedAt)
  // 换工作区才换缓存；同一份详情的重渲染、刷新都复用已取回的图片。
  const loadAttachment = React.useMemo(
    () => createAttachmentLoader(client, workspaceRoot),
    [client, workspaceRoot],
  )
  const blockers = blockerItems(currentTicket, props.snapshotTickets)
  const canExpandBlockers =
    currentTicket !== null && currentTicket.skillActionReason === 'blocked' && blockers.length > 0
  // 展开状态只在当前这张票上有效：换票或从返回栈重新打开时都收起。
  const [expandedRef, setExpandedRef] = React.useState<string | null>(null)
  React.useEffect(() => {
    setExpandedRef(null)
  }, [ref])
  const blockersExpanded = expandedRef === ref && canExpandBlockers
  const mutation = useTicketMutation(client, {
    workspaceRoot,
    ref,
    number,
    onUpdated: request.replace,
    onSnapshot: updateFromSnapshot,
  })
  const deletion = useTicketDeletion(client, {
    workspaceRoot,
    ref,
    number,
    onDeleted: props.onBack,
  })

  return {
    ref,
    request,
    detail: request.detail,
    loadAttachment,
    currentTicket,
    blockers,
    canExpandBlockers,
    blockersExpanded,
    toggleBlockers: () => {
      setExpandedRef(blockersExpanded ? null : ref)
    },
    mutation,
    deletion,
  }
}

/** 详情主体：已加载的滚动内容、读取失败的重试页，或加载中提示。 */
function DetailStage(props: {
  readonly request: DetailRequest
  readonly detail: TicketDetail | null
  readonly loadAttachment: AttachmentLoader
  readonly busy: boolean
  readonly mutationError: RpcErrorBody | null
  readonly copy: CopyState
  readonly notice: string | null
  readonly options: OptionsState
  readonly deletion: TicketDeletion
  readonly blockers: readonly BlockerItem[]
  readonly blockersExpanded: boolean
  readonly onOpenBlocker: (ref: string) => void
  readonly onApply: (patch: TicketPatch) => void
}): React.ReactElement {
  const { t } = useI18n()
  const { detail } = props
  if (detail !== null) {
    return (
      <DetailContent
        detail={detail}
        loadAttachment={props.loadAttachment}
        busy={props.busy}
        mutationError={props.mutationError}
        copy={props.copy}
        notice={props.notice}
        options={props.options}
        deletion={props.deletion}
        blockers={props.blockers}
        blockersExpanded={props.blockersExpanded}
        onOpenBlocker={props.onOpenBlocker}
        onApply={props.onApply}
      />
    )
  }
  if (props.request.phase === 'error') {
    return <LoadError error={props.request.error} onRetry={props.request.reload} />
  }
  return (
    <div data-testid="detail-loading" style={EMPTY_STYLE}>
      {t('detail.loading')}
    </div>
  )
}

/** 头部的技能按钮，或被阻塞且有阻塞引用时的「阻塞 N」disclosure。 */
function TicketHeaderAction(props: {
  readonly ticket: TicketSnapshot | null
  readonly canExpandBlockers: boolean
  readonly expanded: boolean
  readonly onToggleBlockers: () => void
  readonly injected: string | null
  readonly injection: PromptInjection
  readonly onSkillAction: (ticket: TicketSnapshot, target: InjectionTarget) => void
}): React.ReactElement | null {
  const { t } = useI18n()
  const { ticket } = props
  if (ticket === null) return null

  if (props.canExpandBlockers) {
    return (
      <BlockersToggle
        label={actionBadgeLabel(ticket, t)}
        hint={actionHint(ticket, t)}
        expanded={props.expanded}
        onToggle={props.onToggleBlockers}
      />
    )
  }

  return (
    <SkillActionBadge
      ticket={ticket}
      injected={props.injected === ticket.ref && ticket.skillAction !== 'none'}
      injection={props.injection}
      onSkillAction={props.onSkillAction}
    />
  )
}

/**
 * 详情头部的工单行跟着当前快照走；写操作后的快照也能立即反映到技能徽标。
 * 按引用打开、快照里没有这张票时没有行，头部不渲染技能与阻塞入口。
 */
function useCurrentTicket(
  ref: string,
  ticket: TicketSnapshot | null,
): {
  readonly current: TicketSnapshot | null
  readonly updateFromSnapshot: (snapshot: WorkspaceSnapshot) => void
} {
  const [current, setCurrent] = React.useState(ticket)
  React.useEffect(() => {
    setCurrent(ticket)
  }, [ticket])
  return {
    current,
    updateFromSnapshot: (snapshot) => {
      const next = findSnapshotTicket(snapshot.tickets, ref)
      if (next !== null) setCurrent(next)
    },
  }
}

/** 刷新与写操作的互斥：刷新中禁用写控件；写、删除或删除确认期间禁用刷新。 */
function refreshControls(
  request: DetailRequest,
  options: {
    readonly onRefreshSnapshot: () => void
    readonly writeBusy: boolean
    readonly confirming: boolean
  },
): {
  readonly busy: boolean
  readonly refreshDisabled: boolean
  readonly onRefresh: () => void
} {
  const busy = options.writeBusy || request.refreshing
  return {
    busy,
    refreshDisabled: busy || options.confirming,
    onRefresh: () => {
      // 两件事并行、互不等待：详情重读失败不影响列表快照，列表失败也不改写详情。
      request.refresh()
      options.onRefreshSnapshot()
    },
  }
}

/** 刷新失败：固定在头部下方、正文滚动区之外，失败时才占一行。 */
function RefreshFailure(props: { readonly error: RpcErrorBody | null }): React.ReactElement | null {
  const { t } = useI18n()
  if (props.error === null) return null
  return (
    <div role="alert" data-testid="detail-refresh-error" style={DETAIL_REFRESH_ERROR_STYLE}>
      {t('detail.refreshFailed', { detail: errorText(props.error, t) })}
    </div>
  )
}

function DetailHeader(props: {
  readonly refText: string
  readonly detail: TicketDetail | null
  /** 有详情返回栈时是上一张票的引用，栈空时为 null。 */
  readonly backRef: string | null
  readonly onBack: () => void
  /** 右侧的技能按钮、工单操作与更多菜单。 */
  readonly children: React.ReactNode
}): React.ReactElement {
  const { t } = useI18n()
  const { detail, backRef } = props
  const url = detail?.url ?? null
  const backLabel = backRef === null ? t('detail.back') : t('detail.backTo', { ref: backRef })
  const backTitle =
    backRef === null ? t('detail.backTitle') : t('detail.backToTitle', { ref: backRef })

  return (
    <header style={DETAIL_HEADER_STYLE}>
      <button
        type="button"
        data-testid="detail-back"
        data-hover="soft"
        title={backTitle}
        onClick={props.onBack}
        style={DETAIL_BACK_STYLE}
      >
        <ChevronLeftIcon />
        <span style={DETAIL_BACK_LABEL_STYLE}>{backLabel}</span>
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
          title={t('detail.openInBrowser', { url })}
          style={DETAIL_REF_LINK_STYLE}
        >
          {props.refText}
        </a>
      )}
      {detail === null ? null : (
        <span data-testid="detail-backend" style={BACKEND_BADGE_STYLE}>
          {backendLabel(detail.backend, t)}
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
  readonly loadAttachment: AttachmentLoader
  readonly busy: boolean
  readonly mutationError: RpcErrorBody | null
  readonly copy: CopyState
  /** 提示词注入失败的说明；成功时为空。 */
  readonly notice: string | null
  readonly options: OptionsState
  readonly deletion: TicketDeletion
  readonly blockers: readonly BlockerItem[]
  readonly blockersExpanded: boolean
  readonly onOpenBlocker: (ref: string) => void
  readonly onApply: (patch: TicketPatch) => void
}): React.ReactElement {
  const { t } = useI18n()
  const { detail, deletion } = props
  const fieldProps = { detail, busy: props.busy, onApply: props.onApply }

  return (
    <div data-testid="detail-content" aria-busy={props.busy} style={DETAIL_SCROLL_STYLE}>
      {props.blockersExpanded && props.blockers.length > 0 ? (
        <BlockersSection items={props.blockers} onOpen={props.onOpenBlocker} />
      ) : null}
      {deletion.confirming ? (
        <DeleteConfirm
          refText={detail.ref}
          title={detail.title}
          backendLabel={backendLabel(detail.backend, t)}
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
          {errorText(props.mutationError, t)}
        </div>
      )}
      <Timeline detail={detail} loadAttachment={props.loadAttachment} />
    </div>
  )
}

const NOWRAP_STYLE: React.CSSProperties = { whiteSpace: 'nowrap' }

/** 标题、实心状态徽标，以及“谁在何时创建、更新时间、几条评论”。 */
function TitleBlock(props: { readonly detail: TicketDetail }): React.ReactElement {
  const { t } = useI18n()
  const { detail } = props
  return (
    <div style={DETAIL_STACK_STYLE}>
      <h2 data-testid="detail-title" title={detail.title} style={DETAIL_TITLE_STYLE}>
        {detail.title}
      </h2>
      <div data-testid="detail-meta" style={TITLE_META_ROW_STYLE}>
        <span data-testid="detail-state" style={STATE_PILL_STYLES[detail.state]}>
          <span style={STATUS_DOT_STYLE} aria-hidden="true" />
          {t(detail.state === 'open' ? 'detail.state.open' : 'detail.state.closed')}
        </span>
        {/* 每段整体不断行，分隔点跟在上一段末尾，换行时新行不会以“·”开头。 */}
        <span style={NOWRAP_STYLE}>
          {detail.author === null ? null : (
            <span style={TITLE_META_NAME_STYLE}>{detail.author} </span>
          )}
          {t('detail.createdAt', { time: formatTime(detail.createdAt) })} ·
        </span>
        <span style={NOWRAP_STYLE}>
          {t('detail.updatedAt', { time: formatTime(detail.updatedAt) })} ·
        </span>
        <span style={NOWRAP_STYLE}>{t('detail.comments', { count: detail.comments.length })}</span>
      </div>
    </div>
  )
}

function LoadError(props: {
  readonly error: RpcErrorBody | null
  readonly onRetry: () => void
}): React.ReactElement {
  const { t } = useI18n()
  return (
    <div style={DETAIL_SCROLL_STYLE}>
      <div role="alert" data-testid="detail-load-error" style={ERROR_STYLE}>
        <div>{props.error === null ? t('detail.loadFailed') : errorText(props.error, t)}</div>
        <button
          type="button"
          data-testid="detail-retry"
          data-hover="soft"
          onClick={props.onRetry}
          style={{ ...BUTTON_STYLE, marginTop: 6 }}
        >
          {t('common.retry')}
        </button>
      </div>
    </div>
  )
}
