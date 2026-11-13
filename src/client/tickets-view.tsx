/**
 * 工单列表视图。只依赖注入的面板客户端与提示词注入函数，不直接接触 DSH，
 * 因此 Vitest + jsdom 就能测统计、过滤、排序、加载与错误状态。
 *
 * 点击工单行只打开详情，不注入提示词；注入由操作栏的明确按钮与详情视图触发。
 */
import * as React from 'react'

import type {
  ErrorCode,
  RpcErrorBody,
  TicketSnapshot,
  WorkspaceSnapshot,
} from '../protocol/tracker.ts'
import { BACKEND_LABELS } from './backend-label.ts'
import { errorText, isEnvIssue } from './error-text.ts'
import { FolderIcon, PlusIcon, RefreshIcon } from './icons.tsx'
import { newBugPrompt, newFeaturePrompt } from './prompts.ts'
import type { PanelClient } from './rpc.ts'
import { useTicketActions } from './ticket-actions.ts'
import { TicketList } from './ticket-list.tsx'
import {
  ACTION_BAR_STYLE,
  AGE_STYLE,
  BACKEND_BADGE_STYLE,
  BUG_ACTION_STYLE,
  BUTTON_STYLE,
  CHIP_ACTIVE_STYLE,
  CHIP_STYLE,
  COLORS,
  EMPTY_STYLE,
  ERROR_STYLE,
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
}

type Phase = 'loading' | 'ready' | 'refreshing' | 'error'

interface SnapshotRequestState {
  readonly snapshot: WorkspaceSnapshot | null
  readonly error: RpcErrorBody | null
  readonly phase: Phase
  readonly refresh: () => void
}

const AGE_TICK_MS = 30_000

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
          <div data-testid="loaded-total" style={LOADED_STYLE}>
            已加载 {snapshot.loaded} / 共 {snapshot.total}
          </div>
          <TicketList
            tickets={visible}
            emptyText={tickets.length === 0 ? '这个仓库还没有工单。' : '没有符合筛选条件的工单。'}
            injected={injected}
            canInject={props.canInject}
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

function useNow(clock: () => number): number {
  const [now, setNow] = React.useState(() => clock())

  React.useEffect(() => {
    const id = setInterval(() => {
      setNow(clock())
    }, AGE_TICK_MS)
    return () => {
      clearInterval(id)
    }
  }, [clock])

  return now
}

function useSnapshotRequest(
  client: PanelClient,
  workspaceRoot: string | undefined,
): SnapshotRequestState {
  const [snapshot, setSnapshot] = React.useState<WorkspaceSnapshot | null>(null)
  const [error, setError] = React.useState<RpcErrorBody | null>(null)
  const [phase, setPhase] = React.useState<Phase>('loading')
  const sequence = React.useRef(0)

  const request = React.useCallback(
    async (mode: 'get' | 'refresh'): Promise<void> => {
      const current = sequence.current + 1
      sequence.current = current

      if (workspaceRoot === undefined) {
        setSnapshot(null)
        setError({ code: 'invalid-params', message: '当前会话没有工作区目录，无法读取工单。' })
        setPhase('error')
        return
      }

      setPhase(mode === 'refresh' ? 'refreshing' : 'loading')
      setError(null)
      const result =
        mode === 'refresh' ? await client.refresh(workspaceRoot) : await client.get(workspaceRoot)
      if (current !== sequence.current) return

      if (!result.ok) {
        setError(result.error)
        setPhase('error')
        return
      }

      // 首屏只等列表：阻塞数先按描述回退显示，补齐结果到了再原子替换。
      setSnapshot(result.result)
      setError(null)
      setPhase('ready')
      if (result.result.blockersFinalized) return

      const finalized = await client.resolveBlockers(workspaceRoot)
      // 刷新会推进序号；旧补齐结果不能覆盖新列表。
      if (current !== sequence.current) return
      // 补齐失败保留首屏结果：列表已经可用，不弹错误横幅。
      if (finalized.ok) setSnapshot(finalized.result)
    },
    [client, workspaceRoot],
  )

  React.useEffect(() => {
    setSnapshot(null)
    setError(null)
    void request('get')
  }, [request])

  const refresh = React.useCallback(() => {
    if (phase === 'loading' || phase === 'refreshing') return
    void request('refresh')
  }, [phase, request])

  return { snapshot, error, phase, refresh }
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

function ErrorBanner(props: {
  readonly error: RpcErrorBody
  readonly onOpenEnvCheck: (code: ErrorCode) => void
}): React.ReactElement {
  return (
    <div role="alert" data-testid="error" style={ERROR_STYLE}>
      <div>{errorText(props.error)}</div>
      {isEnvIssue(props.error.code) ? (
        <button
          type="button"
          data-testid="open-env-check"
          data-hover="soft"
          onClick={() => {
            props.onOpenEnvCheck(props.error.code)
          }}
          style={{ ...BUTTON_STYLE, marginTop: 6 }}
        >
          查看环境检查
        </button>
      ) : null}
    </div>
  )
}

function formatAge(fetchedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - fetchedAt) / 1000))
  if (seconds < 60) return '刚刚'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${String(minutes)} 分钟前`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)} 小时前`

  return `${String(Math.floor(hours / 24))} 天前`
}
