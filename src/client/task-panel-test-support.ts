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
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-03T00:00:00Z',
    openBlockers: 1,
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
  fetchedAt: NOW - 15_000,
  loaded: TICKETS.length,
  total: 30,
  windowLimit: 100,
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
  /** 全量刷新的调用记录：工作区根目录。 */
  readonly fullRefreshCalls: string[]
  /** 详情请求的参数：工作区、引用、编号。 */
  readonly detailCalls: (readonly [string, string, number | null])[]
}

/** 空的本地快照库：默认夹具没有真实的缓存目录。 */
export const EMPTY_CACHE: SnapshotCacheInfo = {
  location: '~/.dsh/cache/dsh-mattpocock-workflow/',
  entries: 0,
  lastWrittenAt: null,
  cleared: 0,
}

export function fakeClient(
  getResult: RpcResult<WorkspaceSnapshot> | ((root: string) => RpcResult<WorkspaceSnapshot>),
  refreshResult?: RpcResult<WorkspaceSnapshot>,
  resolveResult: () => Promise<RpcResult<WorkspaceSnapshot>> = UNUSED_RESOLVE,
): FakeClient {
  const getCalls: string[] = []
  const refreshCalls: string[] = []
  const fullRefreshCalls: string[] = []
  const detailCalls: (readonly [string, string, number | null])[] = []
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
      if (options?.full === true) fullRefreshCalls.push(root)
      return Promise.resolve(refreshResult ?? get(root))
    },
    cache: () => Promise.resolve({ ok: true, result: EMPTY_CACHE }),
    resolveBlockers: () => resolveResult(),
    getDetail(root, ref, number) {
      detailCalls.push([root, ref, number])
      return Promise.resolve({ ok: true, result: { ...DETAIL, ref, number } })
    },
    updateTicket: () => Promise.resolve({ ok: true, result: { applied: true } }),
    getOptions: () =>
      Promise.resolve({ ok: false, error: { code: 'capability-unsupported', message: '未使用' } }),
    deleteTicket: () => Promise.reject(new Error('未使用')),
    envCheck: () => Promise.resolve({ ok: false, error: { code: 'internal', message: '未使用' } }),
  }
  return { client, getCalls, refreshCalls, fullRefreshCalls, detailCalls }
}

/** 只覆盖用得到的方法；其余方法被调用即视为测试写错。 */
export function clientWith(overrides: Partial<PanelClient>): PanelClient {
  return {
    get: () => Promise.reject(new Error('未使用')),
    more: () => Promise.reject(new Error('未使用')),
    refresh: () => Promise.reject(new Error('未使用')),
    cache: () => Promise.resolve({ ok: true, result: EMPTY_CACHE }),
    resolveBlockers: () => Promise.reject(new Error('未使用')),
    getDetail: () => Promise.reject(new Error('未使用')),
    updateTicket: () => Promise.reject(new Error('未使用')),
    getOptions: () =>
      Promise.resolve({ ok: false, error: { code: 'capability-unsupported', message: '未使用' } }),
    deleteTicket: () => Promise.reject(new Error('未使用')),
    envCheck: () => Promise.reject(new Error('未使用')),
    ...overrides,
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
