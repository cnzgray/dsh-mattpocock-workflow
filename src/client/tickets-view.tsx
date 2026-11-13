/**
 * 工单列表视图。只依赖注入的面板客户端与提示词注入函数，不直接接触 DSH，
 * 因此 Vitest + jsdom 就能测统计、过滤、排序、加载与错误状态。
 */
import * as React from 'react'

import {
  ENV_ISSUE_ERROR_CODES,
  type ErrorCode,
  type RpcErrorBody,
  type TicketSnapshot,
  type WorkspaceSnapshot,
} from '../protocol/tracker.ts'
import { NEW_BUG_PROMPT, NEW_FEATURE_PROMPT, processTicketPrompt } from './prompts.ts'
import type { PanelClient } from './rpc.ts'
import { TicketList } from './ticket-list.tsx'
import {
  ACTION_BAR_STYLE,
  AGE_STYLE,
  BACKEND_BADGE_STYLE,
  BACKEND_LABELS,
  BUG_ACTION_STYLE,
  BUTTON_STYLE,
  CHIP_ACTIVE_STYLE,
  CHIP_STYLE,
  COLORS,
  DIVIDER_STYLE,
  EMPTY_STYLE,
  ERROR_STYLE,
  FEATURE_ACTION_STYLE,
  FILTERS,
  HEADER_STYLE,
  LOADED_STYLE,
  REPO_CHIP_STYLE,
  REPO_HOST_STYLE,
  REPO_NAME_STYLE,
  SORT_OPTIONS,
  STATS_STYLE,
  STAT_STYLE,
  STAT_VALUE_STYLE,
  TOOLBAR_GROUP_STYLE,
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

/** 工单列表视图依赖。 */
export interface TicketsViewProps {
  readonly client: PanelClient
  readonly workspaceRoot: string | undefined
  readonly canInject: boolean
  readonly injectDraft: (text: string) => boolean
  readonly now?: (() => number) | undefined
  /** 环境问题导致列表失败时，跳到环境检查视图。 */
  readonly onOpenEnvCheck: () => void
}

type Phase = 'loading' | 'ready' | 'refreshing' | 'error'

interface SnapshotRequestState {
  readonly snapshot: WorkspaceSnapshot | null
  readonly error: RpcErrorBody | null
  readonly phase: Phase
  readonly refresh: () => void
}

const AGE_TICK_MS = 30_000

const ERROR_MESSAGES: Partial<Record<ErrorCode, string>> = {
  'gh-missing': '未找到 gh 命令，请先安装 GitHub CLI（https://cli.github.com）。',
  'gh-unauthenticated': 'gh 未登录，请运行 gh auth login 后重试。',
  'glab-missing': '未找到 glab 命令，请先安装 GitLab CLI（https://gitlab.com/gitlab-org/cli）。',
  'glab-unauthenticated': 'glab 未登录或令牌已失效，请运行 glab auth login 后重试。',
  'tea-missing': '未找到 tea 命令，请先安装 Gitea CLI（https://gitea.com/gitea/tea）。',
  'tea-unauthenticated': 'tea 未登录该实例或令牌已失效，请运行 tea login add 后重试。',
  'markdown-read-failed': '读取 .scratch 里的工单失败，请检查文件读取权限。',
}

/** 工单列表视图。 */
export function TicketsView(props: TicketsViewProps): React.ReactElement {
  const clock = props.now ?? Date.now
  const { snapshot, error, phase, refresh } = useSnapshotRequest(props.client, props.workspaceRoot)
  const [filter, setFilter] = React.useState<TicketFilter>('all')
  const [sortKey, setSortKey] = React.useState<TicketSortKey>('updated')
  const [direction, setDirection] = React.useState<SortDirection>('desc')
  const [selected, setSelected] = React.useState<string | null>(null)
  const nowValue = useNow(clock)
  const { notice, inject } = useDraftInjection(props.canInject, props.injectDraft)

  React.useEffect(() => {
    setSelected(null)
  }, [props.workspaceRoot])

  const tickets = snapshot?.tickets ?? []
  const counts = countTickets(tickets)
  const visible = sortTickets(filterTickets(tickets, filter), sortKey, direction)
  const busy = phase === 'loading' || phase === 'refreshing'

  const onSort = (key: TicketSortKey): void => {
    if (key === sortKey) {
      setDirection(direction === 'asc' ? 'desc' : 'asc')
      return
    }
    setSortKey(key)
    setDirection(key === 'title' ? 'asc' : 'desc')
  }

  const onPick = (ticket: TicketSnapshot): void => {
    setSelected(ticket.ref)
    inject(processTicketPrompt(ticket.ref))
  }

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
        canInject={props.canInject}
        onNewFeature={() => {
          inject(NEW_FEATURE_PROMPT)
        }}
        onNewBug={() => {
          inject(NEW_BUG_PROMPT)
        }}
      />
      {error !== null ? <ErrorBanner error={error} onOpenEnvCheck={props.onOpenEnvCheck} /> : null}
      {snapshot !== null ? (
        <>
          <StatsRow counts={counts} />
          <Toolbar
            filter={filter}
            sortKey={sortKey}
            direction={direction}
            onFilter={setFilter}
            onSort={onSort}
          />
          <div data-testid="loaded-total" style={LOADED_STYLE}>
            已加载 {snapshot.loaded} / 共 {snapshot.total}
          </div>
          <TicketList tickets={visible} selected={selected} onPick={onPick} />
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

function useDraftInjection(
  canInject: boolean,
  injectDraft: (text: string) => boolean,
): { readonly notice: string | null; readonly inject: (text: string) => void } {
  const [notice, setNotice] = React.useState<string | null>(null)

  const inject = (text: string): void => {
    if (!canInject) {
      setNotice('当前没有可用会话，无法填入提示词。')
      return
    }
    setNotice(injectDraft(text) ? null : '没有找到当前会话的输入框，未能填入提示词。')
  }

  return { notice, inject }
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

      if (result.ok) {
        setSnapshot(result.result)
        setError(null)
        setPhase('ready')
      } else {
        setError(result.error)
        setPhase('error')
      }
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <div style={REPO_CHIP_STYLE}>
          <FolderIcon />
          <span data-testid="repo-name" style={REPO_NAME_STYLE}>
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          data-testid="refresh"
          disabled={props.busy}
          onClick={props.onRefresh}
          style={BUTTON_STYLE}
        >
          {props.busy ? '刷新中…' : '刷新'}
        </button>
        <span data-testid="snapshot-age" style={AGE_STYLE}>
          {props.snapshot === null ? '尚无快照' : formatAge(props.snapshot.fetchedAt, props.now)}
        </span>
      </div>
    </header>
  )
}

function ActionBar(props: {
  readonly canInject: boolean
  readonly onNewFeature: () => void
  readonly onNewBug: () => void
}): React.ReactElement {
  const disabledStyle = { ...FEATURE_ACTION_STYLE, opacity: props.canInject ? 1 : 0.45 }

  return (
    <div style={ACTION_BAR_STYLE}>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          data-testid="new-feature"
          disabled={!props.canInject}
          onClick={props.onNewFeature}
          style={disabledStyle}
        >
          + 新建需求
        </button>
        <button
          type="button"
          data-testid="new-bug"
          disabled={!props.canInject}
          onClick={props.onNewBug}
          style={{ ...BUG_ACTION_STYLE, opacity: props.canInject ? 1 : 0.45 }}
        >
          + bug
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
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          border: `1.5px solid ${props.color}`,
        }}
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
      <div role="group" aria-label="状态过滤" style={TOOLBAR_GROUP_STYLE}>
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
      <span style={DIVIDER_STYLE} />
      <div role="group" aria-label="排序" style={TOOLBAR_GROUP_STYLE}>
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
  readonly onOpenEnvCheck: () => void
}): React.ReactElement {
  return (
    <div role="alert" data-testid="error" style={ERROR_STYLE}>
      <div>{ERROR_MESSAGES[props.error.code] ?? props.error.message}</div>
      {ENV_ISSUE_ERROR_CODES.includes(props.error.code) ? (
        <button
          type="button"
          data-testid="open-env-check"
          onClick={props.onOpenEnvCheck}
          style={{ ...BUTTON_STYLE, marginTop: 6 }}
        >
          查看环境检查
        </button>
      ) : null}
    </div>
  )
}

function FolderIcon(): React.ReactElement {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{ flex: 'none' }}
    >
      <path
        d="M1.8 4.2A1.2 1.2 0 0 1 3 3h3.1l1.4 1.5H13a1.2 1.2 0 0 1 1.2 1.2v6.1A1.2 1.2 0 0 1 13 13H3a1.2 1.2 0 0 1-1.2-1.2V4.2Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
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
