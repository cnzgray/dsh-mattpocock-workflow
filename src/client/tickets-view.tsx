/**
 * 工单列表视图。只渲染面板传下来的快照状态与提示词注入函数，不直接接触 DSH，
 * 因此 Vitest + jsdom 就能测统计、过滤、排序、加载与错误状态。
 *
 * 点击工单行只打开详情，不注入提示词；注入由动作栏的按钮（`action-bar.tsx`）
 * 与详情视图触发。
 */
import * as React from 'react'

import { type ErrorCode, type TicketSnapshot, type WorkspaceSnapshot } from '../protocol/tracker.ts'
import { ActionBar } from './action-bar.tsx'
import { ErrorBanner } from './error-banner.tsx'
import { useI18n } from './i18n.tsx'
import type { InjectionTarget, PromptInjection } from './injection.ts'
import { useNow } from './snapshot-age.ts'
import { snapshotRefreshNotice, type SnapshotRequestState } from './snapshot-request.ts'
import { useTicketActions, type TicketActionsState } from './ticket-actions.ts'
import { MyTicketsBar } from './my-tickets-bar.tsx'
import type { NoticeTone } from './use-draft-injection.ts'
import { TicketList } from './ticket-list.tsx'
import { Footer } from './tickets-view-footer.tsx'
import { TicketsHeader } from './tickets-header.tsx'
import { MoreFooter, moreStateOf, useMoreSentinel, type MoreState } from './tickets-more.tsx'
import {
  ACTION_BAR_STYLE,
  EMPTY_STYLE,
  LIST_HEADER_STYLE,
  LOADED_STYLE,
  TREE_DEGRADED_STYLE,
  TREE_NOTE_STYLE,
} from './task-panel-styles.ts'
import { buildTicketTree, type TreeRow } from './ticket-tree.ts'
import { hierarchyHintKey, LayoutControl } from './tickets-tree-controls.tsx'
import { Toolbar } from './tickets-toolbar.tsx'
import { useCollapsedTickets } from './use-collapsed-tickets.ts'
import {
  countMyTickets,
  countTickets,
  filterMyTickets,
  filterTickets,
  sortTickets,
  type MyTicketCounts,
  type SortDirection,
  type TicketCounts,
  type TicketFilter,
  type TicketSortKey,
} from './ticket-view.ts'
import type { RowField, RowFields, TicketLayout, ViewPreference } from './view-preference.ts'
import { useViewPreference } from './use-view-preference.ts'

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

/** 列表视图从快照与偏好派生出的一份渲染状态。 */
interface TicketsViewState {
  readonly snapshot: WorkspaceSnapshot | null
  readonly error: SnapshotRequestState['error']
  readonly phase: SnapshotRequestState['phase']
  readonly busy: boolean
  readonly refresh: SnapshotRequestState['refresh']
  readonly refreshFull: SnapshotRequestState['refreshFull']
  readonly loadMore: SnapshotRequestState['loadMore']
  readonly moreError: SnapshotRequestState['moreError']
  readonly moreLoading: SnapshotRequestState['moreLoading']
  readonly preference: ViewPreference
  /** 行内显示的字段开关，从偏好里取出给工具栏与列表。 */
  readonly rowFields: RowFields
  readonly setFilter: (filter: TicketFilter) => void
  readonly toggleSort: (key: TicketSortKey) => void
  readonly setLayout: (layout: TicketLayout) => void
  readonly toggleAssignedToMe: () => void
  readonly toggleCreatedByMe: () => void
  readonly clearMyTickets: () => void
  readonly toggleRowField: (field: RowField) => void
  readonly tickets: readonly TicketSnapshot[]
  readonly counts: TicketCounts
  readonly myCounts: MyTicketCounts
  readonly visible: readonly TicketSnapshot[]
  readonly focused: string | null
  readonly hierarchyAvailable: boolean
  readonly layout: TicketLayout
  readonly rows: readonly TreeRow[] | undefined
  readonly toggleTree: (ref: string) => void
  readonly now: number
  readonly injected: string | null
  readonly notice: string | null
  readonly noticeTone: NoticeTone | null
  readonly inject: TicketActionsState['inject']
  readonly onSkillAction: TicketActionsState['onSkillAction']
  readonly refreshNotice: string | null
}

/** 列表视图的状态：快照、视图偏好、过滤排序、布局与折叠都从这里派生。 */
function useTicketsViewState(props: TicketsViewProps): TicketsViewState {
  const { t } = useI18n()
  const { snapshot, error, refreshError, phase, refresh, refreshFull } = props.request
  const { loadMore, moreError, moreLoading } = props.request
  const {
    preference,
    setFilter,
    toggleSort,
    setLayout,
    toggleAssignedToMe,
    toggleCreatedByMe,
    clearMyTickets,
    toggleRowField,
  } = useViewPreference(props.workspaceRoot)
  const now = useNow(props.now ?? Date.now)
  const ownActions = useTicketActions(props.workspaceRoot, props.injection)
  const { injected, notice, noticeTone, inject, onSkillAction } = props.actions ?? ownActions

  const tickets = snapshot?.tickets ?? []
  const statusFiltered = filterTickets(tickets, preference.filter)
  const viewer = snapshot?.viewer ?? null
  const counts = countTickets(tickets)
  const myCounts = countMyTickets(statusFiltered, viewer)
  const visible = sortTickets(
    filterMyTickets(statusFiltered, preference, viewer),
    preference.sortKey,
    preference.direction,
  )
  const focused = useFocusedTicket(props.focusRef, props.onFocusHandled, props.workspaceRoot)
  const hierarchyAvailable = snapshot !== null && snapshot.hierarchy !== 'none'
  const layout: TicketLayout = preference.layout === 'tree' && hierarchyAvailable ? 'tree' : 'flat'
  const { collapsed, toggle: toggleTree } = useCollapsedTickets(
    props.workspaceRoot,
    focused,
    visible,
  )

  return {
    snapshot,
    error,
    phase,
    busy: phase === 'loading' || phase === 'refreshing',
    refresh,
    refreshFull,
    loadMore,
    moreError,
    moreLoading,
    preference,
    rowFields: {
      showAuthor: preference.showAuthor,
      showCreatedAt: preference.showCreatedAt,
      showUpdatedAt: preference.showUpdatedAt,
      showAssignees: preference.showAssignees,
    },
    setFilter,
    toggleSort,
    setLayout,
    toggleAssignedToMe,
    toggleCreatedByMe,
    clearMyTickets,
    toggleRowField,
    tickets,
    counts,
    myCounts,
    visible,
    focused,
    hierarchyAvailable,
    layout,
    rows: layout === 'tree' ? buildTicketTree(visible, collapsed) : undefined,
    toggleTree,
    now,
    injected,
    notice,
    noticeTone,
    inject,
    onSkillAction,
    refreshNotice: snapshotRefreshNotice(snapshot, refreshError, t),
  }
}

/** 工单列表视图。 */
export function TicketsView(props: TicketsViewProps): React.ReactElement {
  const { t } = useI18n()
  const state = useTicketsViewState(props)

  return (
    <div
      data-testid="tickets-view"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      <TicketsHeader
        snapshot={state.snapshot}
        now={state.now}
        loading={state.phase === 'loading'}
        busy={state.busy}
        notice={state.refreshNotice}
        onRefresh={state.refresh}
        onRefreshFull={state.refreshFull}
      />
      {props.actions === undefined ? (
        <div style={ACTION_BAR_STYLE}>
          <ActionBar injection={props.injection} onInject={state.inject} />
        </div>
      ) : null}
      {state.error !== null ? (
        <ErrorBanner error={state.error} onOpenEnvCheck={props.onOpenEnvCheck} />
      ) : null}
      {state.snapshot !== null ? (
        <SnapshotContent
          snapshot={state.snapshot}
          visible={state.visible}
          rows={state.rows}
          layout={state.layout}
          preferenceLayout={state.preference.layout}
          hierarchyAvailable={state.hierarchyAvailable}
          filter={state.preference.filter}
          sortKey={state.preference.sortKey}
          direction={state.preference.direction}
          counts={state.counts}
          myCounts={state.myCounts}
          assignedToMe={state.preference.assignedToMe}
          createdByMe={state.preference.createdByMe}
          rowFields={state.rowFields}
          ticketCount={state.tickets.length}
          injected={state.injected}
          injection={props.injection}
          focused={state.focused}
          now={state.now}
          more={{
            ...moreStateOf(state.snapshot),
            loading: state.moreLoading,
            error: state.moreError,
            onLoadMore: state.loadMore,
          }}
          onFilter={state.setFilter}
          onSort={state.toggleSort}
          onLayout={state.setLayout}
          onToggleAssigned={state.toggleAssignedToMe}
          onToggleCreated={state.toggleCreatedByMe}
          onToggleRowField={state.toggleRowField}
          onClearMyTickets={state.clearMyTickets}
          onToggleTree={state.toggleTree}
          onPick={props.onOpenTicket}
          onSkillAction={state.onSkillAction}
        />
      ) : state.phase === 'loading' ? (
        <div data-testid="loading" style={EMPTY_STYLE}>
          {t('snapshot.loading')}
        </div>
      ) : null}
      <Footer injection={props.injection} notice={state.notice} tone={state.noticeTone} />
    </div>
  )
}

/** 有快照时的列表主体：工具栏、父子说明与工单行。 */
interface SnapshotContentProps {
  readonly snapshot: WorkspaceSnapshot
  readonly visible: readonly TicketSnapshot[]
  readonly rows: readonly TreeRow[] | undefined
  readonly layout: TicketLayout
  readonly preferenceLayout: TicketLayout
  readonly hierarchyAvailable: boolean
  readonly filter: TicketFilter
  readonly sortKey: TicketSortKey
  readonly direction: SortDirection
  readonly counts: TicketCounts
  readonly myCounts: MyTicketCounts
  readonly assignedToMe: boolean
  readonly createdByMe: boolean
  readonly rowFields: RowFields
  readonly ticketCount: number
  readonly injected: string | null
  readonly injection: PromptInjection
  readonly focused: string | null
  readonly now: number
  readonly more: MoreState
  readonly onFilter: (filter: TicketFilter) => void
  readonly onSort: (key: TicketSortKey) => void
  readonly onLayout: (layout: TicketLayout) => void
  readonly onToggleAssigned: () => void
  readonly onToggleCreated: () => void
  readonly onToggleRowField: (field: RowField) => void
  readonly onClearMyTickets: () => void
  readonly onToggleTree: (ref: string) => void
  readonly onPick: (ticket: TicketSnapshot) => void
  readonly onSkillAction: (ticket: TicketSnapshot, target: InjectionTarget) => void
}

function SnapshotContent(props: SnapshotContentProps): React.ReactElement {
  const { t } = useI18n()
  return (
    <>
      <Toolbar
        filter={props.filter}
        sortKey={props.sortKey}
        direction={props.direction}
        counts={props.counts}
        fields={props.rowFields}
        assigneesAvailable={props.snapshot.backend !== 'markdown'}
        onFilter={props.onFilter}
        onSort={props.onSort}
        onToggleField={props.onToggleRowField}
      />
      {props.snapshot.viewer === null ? null : (
        <MyTicketsBar
          viewer={props.snapshot.viewer}
          counts={props.myCounts}
          assignedToMe={props.assignedToMe}
          createdByMe={props.createdByMe}
          onToggleAssigned={props.onToggleAssigned}
          onToggleCreated={props.onToggleCreated}
          onClear={props.onClearMyTickets}
        />
      )}
      <TicketRows
        layoutControl={
          <LayoutControl
            layout={props.preferenceLayout}
            hierarchyAvailable={props.hierarchyAvailable}
            hierarchyHint={t(hierarchyHintKey(props.snapshot))}
            onLayout={props.onLayout}
          />
        }
        notes={<TreeNotes {...props} />}
        snapshot={props.snapshot}
        visible={props.visible}
        rows={props.rows}
        onToggleTree={props.onToggleTree}
        ticketCount={props.ticketCount}
        injected={props.injected}
        injection={props.injection}
        focused={props.focused}
        now={props.now}
        fields={props.rowFields}
        more={props.more}
        onPick={props.onPick}
        onSkillAction={props.onSkillAction}
      />
    </>
  )
}

/** 父子模式的覆盖范围与降级说明。 */
function TreeNotes(props: {
  readonly snapshot: WorkspaceSnapshot
  readonly layout: TicketLayout
  readonly preferenceLayout: TicketLayout
  readonly hierarchyAvailable: boolean
}): React.ReactElement {
  const { t } = useI18n()
  return (
    <>
      {props.layout === 'tree' && props.snapshot.total > props.snapshot.loaded ? (
        <div data-testid="tree-coverage" style={TREE_NOTE_STYLE}>
          {t('tree.coverage', { loaded: props.snapshot.loaded })}
        </div>
      ) : null}
      {props.preferenceLayout === 'tree' && !props.hierarchyAvailable ? (
        <div data-testid="tree-degraded" style={TREE_DEGRADED_STYLE}>
          {t('tree.degraded')}
        </div>
      ) : null}
      {props.preferenceLayout !== 'tree' && !props.hierarchyAvailable ? (
        <div data-testid="tree-unavailable" style={TREE_NOTE_STYLE}>
          {t(hierarchyHintKey(props.snapshot))}
        </div>
      ) : null}
    </>
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
  /** 列表头右侧的布局切换。 */
  readonly layoutControl: React.ReactNode
  /** 列表头下方的父子说明。 */
  readonly notes: React.ReactNode
  readonly snapshot: WorkspaceSnapshot
  readonly visible: readonly TicketSnapshot[]
  readonly rows: readonly TreeRow[] | undefined
  readonly onToggleTree: (ref: string) => void
  readonly ticketCount: number
  readonly injected: string | null
  readonly injection: PromptInjection
  readonly focused: string | null
  readonly now: number
  readonly fields: RowFields
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
      <div style={LIST_HEADER_STYLE}>
        <span data-testid="loaded-total" style={LOADED_STYLE}>
          {t('tickets.loaded', { loaded: props.snapshot.loaded, total: props.snapshot.total })}
          {more.capped ? t('tickets.loadedCapped') : ''}
        </span>
        {props.layoutControl}
      </div>
      {props.notes}
      <TicketList
        tickets={props.visible}
        rows={props.rows}
        onToggleTree={props.onToggleTree}
        emptyText={t(props.ticketCount === 0 ? 'tickets.emptyRepo' : 'tickets.emptyFilter')}
        injected={props.injected}
        injection={props.injection}
        focused={props.focused}
        now={props.now}
        fields={props.fields}
        onPick={props.onPick}
        onSkillAction={props.onSkillAction}
        footer={more.available ? <MoreFooter state={more} sentinel={sentinel} /> : null}
      />
    </>
  )
}
