/**
 * 工单列表视图。只渲染面板传下来的快照状态与提示词注入函数，不直接接触 DSH，
 * 因此 Vitest + jsdom 就能测统计、过滤、排序、加载与错误状态。
 *
 * 点击工单行只打开详情，不注入提示词；注入由动作栏的按钮（`action-bar.tsx`）
 * 与详情视图触发。
 */
import * as React from 'react'

import {
  type ErrorCode,
  type SnapshotSource,
  type TicketSnapshot,
  type WorkspaceSnapshot,
} from '../protocol/tracker.ts'
import { ActionBar } from './action-bar.tsx'
import { backendLabel } from './backend-label.ts'
import { ErrorBanner } from './error-banner.tsx'
import { FolderIcon, RefreshIcon } from './icons.tsx'
import { useI18n } from './i18n.tsx'
import type { InjectionTarget, PromptInjection } from './injection.ts'
import type { MessageKey } from './messages.ts'
import { formatRelativeTime } from './relative-time.ts'
import { useNow } from './snapshot-age.ts'
import { snapshotRefreshNotice, type SnapshotRequestState } from './snapshot-request.ts'
import { useTicketActions, type TicketActionsState } from './ticket-actions.ts'
import type { NoticeTone } from './use-draft-injection.ts'
import { SortControl } from './sort-control.tsx'
import { TicketList } from './ticket-list.tsx'
import { MoreFooter, moreStateOf, useMoreSentinel, type MoreState } from './tickets-more.tsx'
import {
  ACTION_BAR_STYLE,
  AGE_STYLE,
  BACKEND_BADGE_STYLE,
  BUTTON_STYLE,
  CHIP_ACTIVE_STYLE,
  CHIP_COUNT_STYLE,
  CHIP_DOT_STYLE,
  CHIP_STYLE,
  COLORS,
  EMPTY_STYLE,
  HEADER_STYLE,
  LOADED_STYLE,
  REFRESH_BUTTON_STYLE,
  REPO_CHIP_STYLE,
  REPO_HOST_STYLE,
  REPO_NAME_STYLE,
  SEGMENTED_STYLE,
  TICKET_FILTERS,
  TOOLBAR_STYLE,
} from './task-panel-styles.ts'
import {
  countTickets,
  filterTickets,
  sortTickets,
  type SortDirection,
  type TicketCounts,
  type TicketFilter,
  type TicketSortKey,
} from './ticket-view.ts'
import { useViewPreference } from './use-view-preference.ts'

/** 全量刷新是次要动作：描边按钮，和刷新按钮并排但不同层级。 */
const SECONDARY_BUTTON_STYLE: React.CSSProperties = {
  ...BUTTON_STYLE,
  padding: '2px 6px',
  fontSize: 12,
  color: COLORS.secondary,
}

/** 过滤条件到词典键。 */
const FILTER_KEYS: Readonly<Record<TicketFilter, MessageKey>> = {
  all: 'filter.all',
  open: 'filter.open',
  closed: 'filter.closed',
  blocked: 'filter.blocked',
  ready: 'filter.ready',
}

/** 刷新失败原因：贴在数据时间旁边，说明数据没更新，但不盖住列表。 */
const REFRESH_ERROR_STYLE: React.CSSProperties = {
  color: COLORS.error,
  fontSize: 12,
  maxWidth: 160,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

/** 工单列表视图依赖。 */
export interface TicketsViewProps {
  /** 面板共用的快照状态：首屏两阶段加载与刷新都在面板层，视图只渲染。 */
  readonly request: SnapshotRequestState
  readonly workspaceRoot: string | undefined
  readonly injection: PromptInjection
  readonly now?: (() => number) | undefined
  /** 环境问题导致列表失败时，跳到环境检查视图并带上错误码定位后端。 */
  readonly onOpenEnvCheck: (code: ErrorCode) => void
  /** 点击工单行：打开这张票的详情，不做提示词注入。 */
  readonly onOpenTicket: (ticket: TicketSnapshot) => void
  /** 从概览跳过来时要定位的票；只高亮，不写提示词。 */
  readonly focusRef?: string | null | undefined
  /** 定位完成后清空焦点，避免重新挂载时再次定位。 */
  readonly onFocusHandled?: (() => void) | undefined
  /**
   * 面板层持有的注入状态：提示词按钮放在页签栏里，和列表共用同一份提示与标记。
   * 省略时列表自己管注入，并把按钮放在列表顶部。
   */
  readonly actions?: TicketActionsState | undefined
}

/** 工单列表视图。 */
export function TicketsView(props: TicketsViewProps): React.ReactElement {
  const { t } = useI18n()
  const clock = props.now ?? Date.now
  const { snapshot, error, refreshError, phase, refresh, refreshFull } = props.request
  const { loadMore, moreError, moreLoading } = props.request
  const { preference, setFilter, toggleSort } = useViewPreference(props.workspaceRoot)
  const nowValue = useNow(clock)
  const ownActions = useTicketActions(props.workspaceRoot, props.injection)
  const { injected, notice, noticeTone, inject, onSkillAction } = props.actions ?? ownActions

  const tickets = snapshot?.tickets ?? []
  const counts = countTickets(tickets)
  const visible = sortTickets(
    filterTickets(tickets, preference.filter),
    preference.sortKey,
    preference.direction,
  )
  const busy = phase === 'loading' || phase === 'refreshing'

  const focused = useFocusedTicket(props.focusRef, props.onFocusHandled, props.workspaceRoot)

  return (
    <div
      data-testid="tickets-view"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      <Header
        snapshot={snapshot}
        now={nowValue}
        loading={phase === 'loading'}
        busy={busy}
        notice={snapshotRefreshNotice(snapshot, refreshError, t)}
        onRefresh={refresh}
        onRefreshFull={refreshFull}
      />
      {props.actions === undefined ? (
        <div style={ACTION_BAR_STYLE}>
          <ActionBar injection={props.injection} onInject={inject} />
        </div>
      ) : null}
      {error !== null ? <ErrorBanner error={error} onOpenEnvCheck={props.onOpenEnvCheck} /> : null}
      {snapshot !== null ? (
        <>
          <Toolbar
            filter={preference.filter}
            sortKey={preference.sortKey}
            direction={preference.direction}
            counts={counts}
            onFilter={setFilter}
            onSort={toggleSort}
          />
          <TicketRows
            snapshot={snapshot}
            visible={visible}
            ticketCount={tickets.length}
            injected={injected}
            injection={props.injection}
            focused={focused}
            now={nowValue}
            more={{
              ...moreStateOf(snapshot),
              loading: moreLoading,
              error: moreError,
              onLoadMore: loadMore,
            }}
            onPick={props.onOpenTicket}
            onSkillAction={onSkillAction}
          />
        </>
      ) : phase === 'loading' ? (
        <div data-testid="loading" style={EMPTY_STYLE}>
          {t('snapshot.loading')}
        </div>
      ) : null}
      <Footer injection={props.injection} notice={notice} tone={noticeTone} />
    </div>
  )
}

/**
 * 从概览跳过来时要定位的票：只高亮，不写提示词——概览是只读视图。
 * @param focusRef - 面板传下来的待定位引用。
 * @param onFocusHandled - 定位完成后的回调，面板据此清空待定位状态。
 * @param workspaceRoot - 当前工作区；换工作区时定位失效。
 * @returns 当前要定位的引用；没有时为 null。
 */
function useFocusedTicket(
  focusRef: string | null | undefined,
  onFocusHandled: (() => void) | undefined,
  workspaceRoot: string | undefined,
): string | null {
  const [focused, setFocused] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (focusRef === null || focusRef === undefined) return
    setFocused(focusRef)
    onFocusHandled?.()
  }, [focusRef, onFocusHandled])

  // 换工作区时清掉定位；首次挂载不清，刚跳过来的定位要留住。
  const previousRoot = React.useRef(workspaceRoot)
  React.useEffect(() => {
    if (previousRoot.current === workspaceRoot) return
    previousRoot.current = workspaceRoot
    setFocused(null)
  }, [workspaceRoot])

  return focused
}

function TicketRows(props: {
  readonly snapshot: WorkspaceSnapshot
  readonly visible: readonly TicketSnapshot[]
  readonly ticketCount: number
  readonly injected: string | null
  readonly injection: PromptInjection
  readonly focused: string | null
  readonly now: number
  readonly more: MoreState
  readonly onPick: (ticket: TicketSnapshot) => void
  readonly onSkillAction: (ticket: TicketSnapshot, target: InjectionTarget) => void
}): React.ReactElement {
  const { t } = useI18n()
  const { more } = props
  // 失败时停住自动加载，只能点重试：否则哨兵还在视口里就会反复打宿主。
  const sentinel = useMoreSentinel(
    more.available && more.error === null && !more.loading,
    more.onLoadMore,
  )

  return (
    <>
      <div data-testid="loaded-total" style={LOADED_STYLE}>
        {t('tickets.loaded', { loaded: props.snapshot.loaded, total: props.snapshot.total })}
        {more.capped ? t('tickets.loadedCapped') : ''}
      </div>
      <TicketList
        tickets={props.visible}
        emptyText={t(props.ticketCount === 0 ? 'tickets.emptyRepo' : 'tickets.emptyFilter')}
        injected={props.injected}
        injection={props.injection}
        focused={props.focused}
        now={props.now}
        onPick={props.onPick}
        onSkillAction={props.onSkillAction}
        footer={more.available ? <MoreFooter state={more} sentinel={sentinel} /> : null}
      />
    </>
  )
}

/** 数据来源徽标：本地缓存的数据不是实时的，标出来才不会误判。 */
function SourceBadge(props: { readonly source: SnapshotSource }): React.ReactElement {
  const { t } = useI18n()
  return (
    <span
      data-testid="snapshot-source"
      style={{
        ...BACKEND_BADGE_STYLE,
        color: props.source === 'cache' ? COLORS.warn : COLORS.secondary,
      }}
    >
      {props.source === 'cache' ? t('source.cache') : t('source.live')}
    </span>
  )
}

function Header(props: {
  readonly snapshot: WorkspaceSnapshot | null
  readonly now: number
  readonly loading: boolean
  readonly busy: boolean
  /** 数据旁边的失败原因：有数据时显示在时间旁边，不用整屏横幅盖住列表。 */
  readonly notice: string | null
  readonly onRefresh: () => void
  readonly onRefreshFull: () => void
}): React.ReactElement {
  const { t } = useI18n()
  return (
    <header style={HEADER_STYLE}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <div style={REPO_CHIP_STYLE}>
          <FolderIcon />
          <span
            data-testid="repo-name"
            style={REPO_NAME_STYLE}
            {...(props.snapshot === null ? {} : { title: props.snapshot.repository })}
          >
            {props.snapshot?.repository ??
              (props.loading ? t('repo.identifying') : t('repo.unidentified'))}
          </span>
        </div>
        {props.snapshot === null ? null : (
          <span data-testid="backend-badge" style={BACKEND_BADGE_STYLE}>
            {backendLabel(props.snapshot.backend, t)}
          </span>
        )}
        {/* 数据来源：本地缓存的数据不是实时的，必须让用户一眼看出来。 */}
        {props.snapshot === null ? null : <SourceBadge source={props.snapshot.source} />}
        {/* 自建 Gitea 可能同时登录多个实例，主机名是区分同名仓库的唯一线索。 */}
        {props.snapshot?.backend === 'gitea' && props.snapshot.repositoryHost !== null ? (
          <span
            data-testid="repo-host"
            title={props.snapshot.repositoryHost}
            style={REPO_HOST_STYLE}
          >
            {props.snapshot.repositoryHost}
          </span>
        ) : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 'none' }}>
        <span data-testid="snapshot-age" style={AGE_STYLE}>
          {props.snapshot === null
            ? t('snapshot.none')
            : formatRelativeTime(props.snapshot.fetchedAt, props.now, t)}
        </span>
        {props.notice === null ? null : (
          <span data-testid="refresh-error" title={props.notice} style={REFRESH_ERROR_STYLE}>
            {props.notice}
          </span>
        )}
        <button
          type="button"
          data-testid="refresh"
          data-hover="soft"
          disabled={props.busy}
          onClick={props.onRefresh}
          style={{ ...REFRESH_BUTTON_STYLE, opacity: props.busy ? 0.6 : 1 }}
        >
          <RefreshIcon />
          {props.busy ? t('refresh.busy') : t('refresh.action')}
        </button>
        <button
          type="button"
          data-testid="refresh-full"
          data-hover="soft"
          disabled={props.busy}
          onClick={props.onRefreshFull}
          style={{ ...SECONDARY_BUTTON_STYLE, opacity: props.busy ? 0.6 : 1 }}
        >
          {t('refresh.full')}
        </button>
      </div>
    </header>
  )
}

function Toolbar(props: {
  readonly filter: TicketFilter
  readonly sortKey: TicketSortKey
  readonly direction: SortDirection
  readonly counts: TicketCounts
  readonly onFilter: (filter: TicketFilter) => void
  readonly onSort: (key: TicketSortKey) => void
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
    </div>
  )
}

/** 带计数的筛选段：数字基于整份快照，不随当前筛选变化。 */
const CHIP_STATS: Partial<
  Record<TicketFilter, { readonly key: keyof TicketCounts; readonly color: string }>
> = {
  closed: { key: 'closed', color: COLORS.tertiary },
  blocked: { key: 'blocked', color: COLORS.warn },
  ready: { key: 'ready', color: COLORS.success },
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
    <button
      type="button"
      data-testid={props.testId}
      aria-pressed={props.active}
      data-hover="soft"
      onClick={props.onClick}
      style={{ ...CHIP_STYLE, ...(props.active ? CHIP_ACTIVE_STYLE : undefined) }}
    >
      {stat === undefined ? null : (
        <span aria-hidden="true" style={{ ...CHIP_DOT_STYLE, background: stat.color }} />
      )}
      {props.label}
      {stat === undefined ? null : (
        <span data-testid={`stat-${stat.key}`} style={CHIP_COUNT_STYLE}>
          {props.count[stat.key]}
        </span>
      )}
    </button>
  )
}

function Footer(props: {
  readonly injection: PromptInjection
  readonly notice: string | null
  readonly tone: NoticeTone | null
}): React.ReactElement | null {
  const { t } = useI18n()
  if (props.injection.canInjectCurrent && props.notice === null) return null

  return (
    <footer
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '8px 12px',
        borderTop: `1px solid ${COLORS.border}`,
      }}
    >
      {props.injection.canInjectCurrent ? null : (
        <div data-testid="no-session-hint" style={{ color: COLORS.secondary, fontSize: 12 }}>
          {t(
            props.injection.canStartNewSession
              ? 'injection.footerNewSession'
              : 'injection.footerUnavailable',
          )}
        </div>
      )}
      {props.notice === null ? null : (
        <div
          role="status"
          data-testid="inject-notice"
          style={{ color: props.tone === 'error' ? COLORS.warn : COLORS.secondary, fontSize: 12 }}
        >
          {props.notice}
        </div>
      )}
    </footer>
  )
}
