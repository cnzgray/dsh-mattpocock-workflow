/**
 * 工单列表视图。只依赖注入的面板客户端与提示词注入函数，不直接接触 DSH，
 * 因此 Vitest + jsdom 就能测统计、过滤、排序、加载与错误状态。
 *
 * 点击工单行只打开详情，不注入提示词；注入由操作栏的明确按钮与详情视图触发。
 */
import * as React from 'react'

import type { ErrorCode, TicketSnapshot, WorkspaceSnapshot } from '../protocol/tracker.ts'
import { BACKEND_LABELS } from './backend-label.ts'
import { ErrorBanner } from './error-banner.tsx'
import { FolderIcon, PlusIcon, RefreshIcon } from './icons.tsx'
import { newBugPrompt, newFeaturePrompt } from './prompts.ts'
import type { PanelClient } from './rpc.ts'
import { formatAge, useNow } from './snapshot-age.ts'
import { useSnapshotRequest } from './snapshot-request.ts'
import { useTicketActions } from './ticket-actions.ts'
import { TicketList } from './ticket-list.tsx'
import {
  ACTION_BAR_STYLE,
  AGE_STYLE,
  BACKEND_BADGE_STYLE,
  BUG_ACTION_STYLE,
  CHIP_ACTIVE_STYLE,
  CHIP_STYLE,
  COLORS,
  EMPTY_STYLE,
  FEATURE_ACTION_STYLE,
  FILTERS,
  HEADER_STYLE,
  LOADED_STYLE,
  REFRESH_BUTTON_STYLE,
  REPO_CHIP_STYLE,
  REPO_HOST_STYLE,
  REPO_NAME_STYLE,
  SORT_OPTIONS,
  STATS_STYLE,
  STAT_STYLE,
  STAT_VALUE_STYLE,
  SEGMENTED_STYLE,
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

/** 工单列表视图依赖。 */
export interface TicketsViewProps {
  readonly client: PanelClient
  readonly workspaceRoot: string | undefined
  readonly canInject: boolean
  readonly injectDraft: (text: string) => boolean
  readonly now?: (() => number) | undefined
  /** 环境问题导致列表失败时，跳到环境检查视图并带上错误码定位后端。 */
  readonly onOpenEnvCheck: (code: ErrorCode) => void
  /** 点击工单行：打开这张票的详情，不做提示词注入。 */
  readonly onOpenTicket: (ticket: TicketSnapshot) => void
  /** 从概览跳过来时要定位的票；只高亮，不写提示词。 */
  readonly focusRef?: string | null | undefined
  /** 定位完成后清空焦点，避免重新挂载时再次定位。 */
  readonly onFocusHandled?: (() => void) | undefined
}

/** 工单列表视图。 */
export function TicketsView(props: TicketsViewProps): React.ReactElement {
  const clock = props.now ?? Date.now
  const { snapshot, error, phase, refresh } = useSnapshotRequest(props.client, props.workspaceRoot)
  const { preference, setFilter, toggleSort } = useViewPreference(props.workspaceRoot)
  const nowValue = useNow(clock)
  const { injected, notice, inject, onSkillAction } = useTicketActions(
    props.workspaceRoot,
    props.canInject,
    props.injectDraft,
  )

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
        onRefresh={refresh}
      />
      <ActionBar
        counts={snapshot === null ? null : counts}
        canInject={props.canInject}
        onNewFeature={() => {
          inject(newFeaturePrompt())
        }}
        onNewBug={() => {
          inject(newBugPrompt())
        }}
      />
      {error !== null ? <ErrorBanner error={error} onOpenEnvCheck={props.onOpenEnvCheck} /> : null}
      {snapshot !== null ? (
        <>
          <Toolbar
            filter={preference.filter}
            sortKey={preference.sortKey}
            direction={preference.direction}
            onFilter={setFilter}
            onSort={toggleSort}
          />
          <TicketRows
            snapshot={snapshot}
            visible={visible}
            ticketCount={tickets.length}
            injected={injected}
            canInject={props.canInject}
            focused={focused}
            onPick={props.onOpenTicket}
            onSkillAction={onSkillAction}
          />
        </>
      ) : phase === 'loading' ? (
        <div data-testid="loading" style={EMPTY_STYLE}>
          正在读取工单…
        </div>
      ) : null}
      <Footer canInject={props.canInject} notice={notice} />
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
  readonly canInject: boolean
  readonly focused: string | null
  readonly onPick: (ticket: TicketSnapshot) => void
  readonly onSkillAction: (ticket: TicketSnapshot) => void
}): React.ReactElement {
  return (
    <>
      <div data-testid="loaded-total" style={LOADED_STYLE}>
        已加载 {props.snapshot.loaded} / 共 {props.snapshot.total}
      </div>
      <TicketList
        tickets={props.visible}
        emptyText={props.ticketCount === 0 ? '这个仓库还没有工单。' : '没有符合筛选条件的工单。'}
        injected={props.injected}
        canInject={props.canInject}
        focused={props.focused}
        onPick={props.onPick}
        onSkillAction={props.onSkillAction}
      />
    </>
  )
}

function Header(props: {
  readonly snapshot: WorkspaceSnapshot | null
  readonly now: number
  readonly loading: boolean
  readonly busy: boolean
  readonly onRefresh: () => void
}): React.ReactElement {
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
            {props.snapshot?.repository ?? (props.loading ? '正在识别仓库…' : '未识别到仓库')}
          </span>
        </div>
        {props.snapshot === null ? null : (
          <span data-testid="backend-badge" style={BACKEND_BADGE_STYLE}>
            {BACKEND_LABELS[props.snapshot.backend]}
          </span>
        )}
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
          {props.snapshot === null ? '尚无快照' : formatAge(props.snapshot.fetchedAt, props.now)}
        </span>
        <button
          type="button"
          data-testid="refresh"
          data-hover="soft"
          disabled={props.busy}
          onClick={props.onRefresh}
          style={{ ...REFRESH_BUTTON_STYLE, opacity: props.busy ? 0.6 : 1 }}
        >
          <RefreshIcon />
          {props.busy ? '刷新中…' : '刷新'}
        </button>
      </div>
    </header>
  )
}

function ActionBar(props: {
  readonly counts: TicketCounts | null
  readonly canInject: boolean
  readonly onNewFeature: () => void
  readonly onNewBug: () => void
}): React.ReactElement {
  const opacity = props.canInject ? 1 : 0.45

  return (
    <div style={ACTION_BAR_STYLE}>
      {props.counts === null ? <span /> : <StatsRow counts={props.counts} />}
      <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
        <button
          type="button"
          data-testid="new-feature"
          data-hover="primary"
          disabled={!props.canInject}
          onClick={props.onNewFeature}
          style={{ ...FEATURE_ACTION_STYLE, opacity }}
        >
          <PlusIcon />
          新建需求
        </button>
        <button
          type="button"
          data-testid="new-bug"
          data-hover="secondary"
          disabled={!props.canInject}
          onClick={props.onNewBug}
          style={{ ...BUG_ACTION_STYLE, opacity }}
        >
          <PlusIcon />
          bug
        </button>
      </div>
    </div>
  )
}

function StatsRow(props: { readonly counts: TicketCounts }): React.ReactElement {
  return (
    <div style={STATS_STYLE}>
      <Stat testId="stat-ready" label="可接" value={props.counts.ready} color={COLORS.success} />
      <Stat testId="stat-blocked" label="阻塞" value={props.counts.blocked} color={COLORS.warn} />
      <Stat
        testId="stat-closed"
        label="已关闭"
        value={props.counts.closed}
        color={COLORS.tertiary}
      />
    </div>
  )
}

function Stat(props: {
  readonly testId: string
  readonly label: string
  readonly value: number
  readonly color: string
}): React.ReactElement {
  return (
    <div data-testid={props.testId} style={STAT_STYLE}>
      <span
        aria-hidden="true"
        style={{ width: 7, height: 7, borderRadius: '50%', background: props.color, flex: 'none' }}
      />
      <strong style={STAT_VALUE_STYLE}>{props.value}</strong>
      <span>{props.label}</span>
    </div>
  )
}

function Toolbar(props: {
  readonly filter: TicketFilter
  readonly sortKey: TicketSortKey
  readonly direction: SortDirection
  readonly onFilter: (filter: TicketFilter) => void
  readonly onSort: (key: TicketSortKey) => void
}): React.ReactElement {
  return (
    <div style={TOOLBAR_STYLE}>
      <div role="group" aria-label="状态过滤" style={SEGMENTED_STYLE}>
        {FILTERS.map((item) => (
          <Chip
            key={item.value}
            testId={`filter-${item.value}`}
            label={item.label}
            active={props.filter === item.value}
            onClick={() => {
              props.onFilter(item.value)
            }}
          />
        ))}
      </div>
      <div role="group" aria-label="排序" style={SEGMENTED_STYLE}>
        {SORT_OPTIONS.map((item) => (
          <Chip
            key={item.value}
            testId={`sort-${item.value}`}
            label={item.label}
            active={props.sortKey === item.value}
            suffix={props.sortKey === item.value ? (props.direction === 'asc' ? ' ↑' : ' ↓') : ''}
            onClick={() => {
              props.onSort(item.value)
            }}
          />
        ))}
      </div>
    </div>
  )
}

function Chip(props: {
  readonly testId: string
  readonly label: string
  readonly active: boolean
  readonly suffix?: string
  readonly onClick: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      data-testid={props.testId}
      aria-pressed={props.active}
      data-hover="soft"
      onClick={props.onClick}
      style={{ ...CHIP_STYLE, ...(props.active ? CHIP_ACTIVE_STYLE : undefined) }}
    >
      {props.label}
      {props.suffix ?? ''}
    </button>
  )
}

function Footer(props: {
  readonly canInject: boolean
  readonly notice: string | null
}): React.ReactElement | null {
  if (props.canInject && props.notice === null) return null

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
      {props.canInject ? null : (
        <div data-testid="no-session-hint" style={{ color: COLORS.secondary, fontSize: 12 }}>
          当前没有可用会话，提示词无法填入输入框。
        </div>
      )}
      {props.notice === null ? null : (
        <div role="status" data-testid="inject-notice" style={{ color: COLORS.warn, fontSize: 12 }}>
          {props.notice}
        </div>
      )}
    </footer>
  )
}
