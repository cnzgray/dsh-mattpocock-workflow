/**
 * 任务面板测试的夹具：快照、环境检查报告、假 RPC 客户端与界面查询辅助。
 * 与用例分开，免得夹具把测试文件挤到 max-lines 之外。
 */
import { fireEvent, screen } from '@testing-library/react'

import type { EnvCheckReport } from '../protocol/env-check.ts'
import { emptyMetrics } from '../protocol/snapshot-test-support.ts'
import type {
  RpcResult,
  SnapshotCacheInfo,
  SnapshotRefreshResult,
  TicketDetail,
  TicketSnapshot,
  WorkspaceSnapshot,
} from '../protocol/tracker.ts'
import { fakeInjection } from './injection-test-support.ts'
import type { PanelClient } from './rpc.ts'
import type { TaskPanelProps } from './task-panel.tsx'
import type { TicketSortKey } from './ticket-view.ts'

export const NOW = Date.parse('2026-11-12T15:00:00Z')

/** 面板夹具里的创建人：没有头像，行内显示首字母色块。 */
const AUTHOR = { login: 'cnzgray', displayName: 'Cnzgray', avatarUrl: null }

export const TICKETS: readonly TicketSnapshot[] = [
  {
    ref: '#1',
    number: 1,
    title: 'Bravo',
    state: 'open',
    category: 'enhancement',
    status: 'ready',
    skillAction: 'implement',
    skillActionReason: 'ready-for-agent',
    labels: ['enhancement', 'ready-for-agent'],
    author: AUTHOR,
    assignees: [AUTHOR.login],
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-05T00:00:00Z',
    openBlockers: 0,
  },
  {
    ref: '#2',
    number: 2,
    title: 'Alpha',
    state: 'open',
    category: 'bug',
    status: 'blocked',
    skillAction: 'none',
    skillActionReason: 'blocked',
    labels: [],
    author: AUTHOR,
    assignees: [],
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-03T00:00:00Z',
    openBlockers: 1,
    blockedBy: ['#1'],
  },
  {
    ref: '#3',
    number: 3,
    title: 'Charlie',
    state: 'closed',
    category: 'bug',
    status: 'closed',
    skillAction: 'none',
    skillActionReason: 'closed',
    labels: [],
    author: AUTHOR,
    assignees: [],
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-11-04T00:00:00Z',
    openBlockers: 0,
  },
  {
    ref: '#4',
    number: 4,
    title: 'Delta',
    state: 'open',
    category: null,
    status: 'open',
    skillAction: 'triage',
    skillActionReason: 'untriaged',
    labels: [],
    author: AUTHOR,
    assignees: [],
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-11-02T00:00:00Z',
    openBlockers: 0,
  },
  {
    ref: '#5',
    number: 5,
    title: 'Echo',
    state: 'open',
    category: 'enhancement',
    status: 'ready',
    skillAction: 'implement',
    skillActionReason: 'ready-for-agent',
    labels: [],
    author: AUTHOR,
    assignees: [],
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    openBlockers: 0,
  },
]

export const ENV_REPORT: EnvCheckReport = {
  checkedAt: NOW,
  backend: 'github',
  repository: 'cnzgray/dsh-mattpocock-workflow',
  items: [
    {
      id: 'home',
      subject: null,
      status: 'pass',
      detail: '/home/dev',
      remedy: null,
      blockedBy: null,
    },
    {
      id: 'cli',
      subject: 'github',
      status: 'fail',
      detail: '未找到 gh 可执行文件',
      remedy: { code: 'install-cli', subject: 'github' },
      blockedBy: null,
    },
  ],
  capabilities: [],
}

export const GITEA_ENV_REPORT: EnvCheckReport = {
  checkedAt: NOW,
  backend: 'gitea',
  repository: 'cnzgray/dsh-mattpocock-workflow',
  items: [
    {
      id: 'backend',
      subject: null,
      status: 'pass',
      detail: 'tea-auth:gitea（gitea.example.com）',
      remedy: null,
      blockedBy: null,
    },
    {
      id: 'auth',
      subject: 'gitea',
      status: 'fail',
      detail: '未登录 gitea.example.com',
      remedy: { code: 'login-cli', subject: 'gitea' },
      blockedBy: null,
    },
  ],
  capabilities: [],
}

export const SNAPSHOT: WorkspaceSnapshot = {
  backend: 'github',
  repository: 'cnzgray/dsh-mattpocock-workflow',
  repositoryHost: 'github.com',
  viewer: 'cnzgray',
  fetchedAt: NOW - 15_000,
  loaded: TICKETS.length,
  total: 30,
  windowLimit: 100,
  hierarchy: 'native',
  libraryVersion: 1,
  tickets: TICKETS,
  metrics: emptyMetrics(),
  blockersFinalized: true,
  source: 'live',
  stale: false,
  refreshError: null,
}

export const UNUSED_RESOLVE = (): Promise<RpcResult<WorkspaceSnapshot>> =>
  Promise.resolve({ ok: true, result: SNAPSHOT })

export const DETAIL: TicketDetail = {
  ref: '#1',
  number: 1,
  title: 'Bravo',
  state: 'open',
  author: 'carol',
  body: '正文',
  uploadsBaseUrl: null,
  labels: ['enhancement'],
  assignees: [],
  comments: [{ author: 'bob', body: '补充验收标准', createdAt: '2026-11-12T10:00:00Z' }],
  url: 'https://github.com/cnzgray/dsh-mattpocock-workflow/issues/1',
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-05T00:00:00Z',
  backend: 'github',
  capabilities: { labels: true, assignees: true, state: true, link: true, delete: false },
}

export interface FakeClient {
  readonly client: PanelClient
  readonly getCalls: string[]
  readonly refreshCalls: string[]
  /** 每次刷新请求携带的库版本；没带是 undefined。 */
  readonly refreshVersions: (number | undefined)[]
  /** 全量刷新的调用记录：工作区根目录。 */
  readonly fullRefreshCalls: string[]
  /** 详情请求的参数：工作区、引用、编号与可选的跨仓库段。 */
  readonly detailCalls: (readonly [string, string, number | null, string?])[]
}

/** 空的本地快照库：默认夹具没有真实的缓存目录。 */
export const EMPTY_CACHE: SnapshotCacheInfo = {
  location: '~/.dsh/cache/dsh-mattpocock-workflow/',
  entries: 0,
  lastWrittenAt: null,
  cleared: 0,
}

/** 把整份快照包成刷新回包：测试里少写一层 kind/full。 */
export function fullRefresh(snapshot: WorkspaceSnapshot): RpcResult<SnapshotRefreshResult> {
  return { ok: true, result: { kind: 'full', snapshot } }
}

/**
 * 刷新假实现允许的返回形状：整份快照（自动包成 full 回包）或三分支回包。
 * 旧测试大多只关心「刷新拿回来一份完整快照」，包一层由这里代劳。
 */
export type RefreshOutcome = RpcResult<WorkspaceSnapshot> | RpcResult<SnapshotRefreshResult>

/** 把刷新假结果收成协议形状：整份快照包进 full 分支。 */
export async function wrapRefresh(
  result: Promise<RefreshOutcome>,
): Promise<RpcResult<SnapshotRefreshResult>> {
  const settled = await result
  if (!settled.ok) return settled
  const payload = settled.result
  if ('kind' in payload) return { ok: true, result: payload }
  return { ok: true, result: { kind: 'full', snapshot: payload } }
}

export function fakeClient(
  getResult: RpcResult<WorkspaceSnapshot> | ((root: string) => RpcResult<WorkspaceSnapshot>),
  refreshResult?: RpcResult<WorkspaceSnapshot> | RpcResult<SnapshotRefreshResult>,
  resolveResult: () => Promise<RpcResult<WorkspaceSnapshot>> = UNUSED_RESOLVE,
): FakeClient {
  const getCalls: string[] = []
  const refreshCalls: string[] = []
  const refreshVersions: (number | undefined)[] = []
  const fullRefreshCalls: string[] = []
  const detailCalls: (readonly [string, string, number | null, string?])[] = []
  const get = (root: string): RpcResult<WorkspaceSnapshot> =>
    typeof getResult === 'function' ? getResult(root) : getResult
  const client: PanelClient = {
    get(root) {
      getCalls.push(root)
      return Promise.resolve(get(root))
    },
    more(root) {
      // 测试里扩窗与首屏取同一份结果；窗口边界由宿主测试覆盖。
      return Promise.resolve(get(root))
    },
    refresh(root, options) {
      refreshCalls.push(root)
      refreshVersions.push(options?.ifVersion)
      if (options?.full === true) fullRefreshCalls.push(root)
      return wrapRefresh(Promise.resolve(refreshResult ?? get(root)))
    },
    cache: () => Promise.resolve({ ok: true, result: EMPTY_CACHE }),
    resolveBlockers: () => resolveResult(),
    getDetail(root, ref, number, repository) {
      detailCalls.push(repository ? [root, ref, number, repository] : [root, ref, number])
      return Promise.resolve({ ok: true, result: { ...DETAIL, ref, number } })
    },
    updateTicket: () => Promise.resolve({ ok: true, result: { applied: true } }),
    getOptions: () =>
      Promise.resolve({ ok: false, error: { code: 'capability-unsupported', message: '未使用' } }),
    deleteTicket: () => Promise.reject(new Error('未使用')),
    getAttachment: () => Promise.reject(new Error('未使用')),
    envCheck: () => Promise.resolve({ ok: false, error: { code: 'internal', message: '未使用' } }),
  }
  return { client, getCalls, refreshCalls, refreshVersions, fullRefreshCalls, detailCalls }
}

/** 只覆盖用得到的方法；其余方法被调用即视为测试写错。refresh 覆盖允许直接返回整份快照。 */
export function clientWith(
  overrides: Partial<Omit<PanelClient, 'refresh'>> & {
    readonly refresh?: (
      workspaceRoot: string,
      options?: { readonly full?: boolean; readonly ifVersion?: number },
    ) => Promise<RefreshOutcome>
  },
): PanelClient {
  const { refresh, ...rest } = overrides
  return {
    get: () => Promise.reject(new Error('未使用')),
    more: () => Promise.reject(new Error('未使用')),
    cache: () => Promise.resolve({ ok: true, result: EMPTY_CACHE }),
    resolveBlockers: () => Promise.reject(new Error('未使用')),
    getDetail: () => Promise.reject(new Error('未使用')),
    updateTicket: () => Promise.reject(new Error('未使用')),
    getOptions: () =>
      Promise.resolve({ ok: false, error: { code: 'capability-unsupported', message: '未使用' } }),
    deleteTicket: () => Promise.reject(new Error('未使用')),
    getAttachment: () => Promise.reject(new Error('未使用')),
    envCheck: () => Promise.reject(new Error('未使用')),
    ...rest,
    ...(refresh === undefined
      ? { refresh: () => Promise.reject(new Error('未使用')) }
      : { refresh: (root, options) => wrapRefresh(Promise.resolve(refresh(root, options))) }),
  }
}

export function deferred<T>(): { readonly promise: Promise<T>; resolve: (value: T) => void } {
  return Promise.withResolvers<T>()
}

export function panelProps(overrides: Partial<TaskPanelProps> = {}): TaskPanelProps {
  return {
    client: fakeClient({ ok: true, result: SNAPSHOT }).client,
    workspaceRoot: '/repo',
    injection: fakeInjection(),
    now: () => NOW,
    ...overrides,
  }
}

export function rowRefs(): readonly (string | null)[] {
  return screen.getAllByTestId('ticket-row').map((row) => row.getAttribute('data-ref'))
}

export function firstRow(): HTMLElement {
  const row = screen.getAllByTestId('ticket-row').at(0)
  if (row === undefined) throw new Error('缺少工单行')
  return row
}

export function badgeFor(ref: string): HTMLElement {
  const badge = screen
    .getAllByTestId('skill-badge')
    .find((item) => item.getAttribute('data-ref') === ref)
  if (badge === undefined) throw new Error(`缺少 ${ref} 的技能徽标`)
  return badge
}

/** 在排序下拉里选一个排序键；方向回到该键的默认值。 */
export function chooseSort(key: TicketSortKey): void {
  fireEvent.change(screen.getByTestId('sort-key'), { target: { value: key } })
}

/** 点排序方向按钮，翻转升降序。 */
export function flipSortDirection(): void {
  fireEvent.click(screen.getByTestId('sort-direction'))
}

/** 当前排序：下拉选中的键与方向按钮上的方向。 */
export function sortState(): { readonly key: string; readonly direction: string | null } {
  const select = screen.getByTestId('sort-key')
  if (!(select instanceof HTMLSelectElement)) throw new Error('排序下拉不是 select')
  return {
    key: select.value,
    direction: screen.getByTestId('sort-direction').getAttribute('data-direction'),
  }
}
