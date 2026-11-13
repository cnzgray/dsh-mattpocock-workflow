import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import * as React from 'react'

import type { EnvCheckReport } from '../protocol/env-check.ts'
import { emptyMetrics } from '../protocol/snapshot-test-support.ts'
import type {
  PressureDimensionReport,
  RpcResult,
  SnapshotMetrics,
  TicketSnapshot,
  WorkspaceSnapshot,
} from '../protocol/tracker.ts'
import { OverviewView, type OverviewViewProps } from './overview-view.tsx'
import type { PanelClient } from './rpc.ts'

afterEach(() => {
  cleanup()
})

const NOW = Date.parse('2026-11-13T00:00:00Z')

const TICKETS: readonly TicketSnapshot[] = [
  {
    ref: '#1',
    number: 1,
    title: '修复登录',
    state: 'open',
    category: 'bug',
    status: 'blocked',
    labels: [],
    author: null,
    skillAction: 'none',
    skillActionReason: 'blocked',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-11-12T00:00:00Z',
    openBlockers: 2,
  },
  {
    ref: '#2',
    number: 2,
    title: '新增导出',
    state: 'open',
    category: 'enhancement',
    status: 'ready',
    labels: [],
    author: null,
    skillAction: 'implement',
    skillActionReason: 'ready-for-agent',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-12T00:00:00Z',
    openBlockers: 0,
  },
  {
    ref: '#3',
    number: 3,
    title: '陈旧的需求',
    state: 'open',
    category: null,
    status: 'open',
    labels: [],
    author: null,
    skillAction: 'triage',
    skillActionReason: 'needs-triage',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    openBlockers: 0,
  },
  {
    ref: '#4',
    number: 4,
    title: '已修好的缺陷',
    state: 'closed',
    category: 'bug',
    status: 'closed',
    labels: [],
    author: null,
    skillAction: 'none',
    skillActionReason: 'closed',
    createdAt: '2026-10-10T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    openBlockers: 0,
    closedAt: '2026-11-01T00:00:00Z',
  },
]

function dimension(
  name: PressureDimensionReport['dimension'],
  report: Partial<PressureDimensionReport> = {},
): PressureDimensionReport {
  return {
    dimension: name,
    tier: 'light',
    signals: [],
    triggers: [],
    gaps: [],
    provisional: false,
    ...report,
  }
}

const METRICS: SnapshotMetrics = emptyMetrics({
  openBacklog: 3,
  readyCapacity: 1,
  blockedRatio: 1 / 3,
  needsTriage: 1,
  stalled: 1,
  staleCount: { value: 2, gap: null },
  staleRatio: { value: 2 / 3, gap: null },
  oldestUpdateDays: { value: 45, gap: null },
  longestBlockerChain: { value: 3, gap: null },
  openedLast30Days: { value: 6, gap: null },
  closedLast30Days: { value: 1, gap: null },
  netFlow: { value: 5, gap: null },
  coverage: { truncated: true },
  pressure: {
    tier: 'tight',
    dimensions: [
      dimension('scale', {
        tier: 'normal',
        signals: [
          { metric: 'backlog', value: 3 },
          { metric: 'netFlow', value: 5 },
        ],
        triggers: ['netFlow'],
      }),
      dimension('blocking', {
        tier: 'normal',
        signals: [{ metric: 'blockedRatio', value: 1 / 3 }],
        triggers: ['blockedRatio'],
        provisional: true,
      }),
      dimension('freshness', {
        tier: 'tight',
        signals: [
          { metric: 'stalled', value: 1 },
          { metric: 'staleRatio', value: 2 / 3 },
        ],
        triggers: ['staleRatio'],
      }),
    ],
  },
  attention: [
    { ref: '#1', title: '修复登录', reason: 'most-blocking', evidence: 2 },
    { ref: '#3', title: '陈旧的需求', reason: 'stale', evidence: 45 },
  ],
})

const SNAPSHOT: WorkspaceSnapshot = {
  backend: 'gitea',
  repository: 'cnzgray/dsh-mattpocock-workflow',
  repositoryHost: 'gitea.example.com',
  fetchedAt: NOW - 120_000,
  loaded: 4,
  total: 10,
  tickets: TICKETS,
  metrics: METRICS,
  blockersFinalized: true,
  source: 'live',
  stale: false,
  refreshError: null,
}

const ENV_CHECK: EnvCheckReport = {
  checkedAt: NOW,
  backend: 'gitea',
  repository: SNAPSHOT.repository,
  items: [],
  capabilities: [],
}

function deferred<T>(): { readonly promise: Promise<T>; resolve: (value: T) => void } {
  return Promise.withResolvers<T>()
}

interface FakeClient {
  readonly client: PanelClient
  readonly getCalls: string[]
  readonly refreshCalls: string[]
  readonly resolveCalls: string[]
}

function fakeClient(
  getResult: RpcResult<WorkspaceSnapshot> | ((root: string) => RpcResult<WorkspaceSnapshot>),
  options: {
    readonly refreshResult?: RpcResult<WorkspaceSnapshot>
    readonly resolveResult?: () => Promise<RpcResult<WorkspaceSnapshot>>
    readonly pendingGet?: Promise<RpcResult<WorkspaceSnapshot>>
  } = {},
): FakeClient {
  const getCalls: string[] = []
  const refreshCalls: string[] = []
  const resolveCalls: string[] = []
  const client: PanelClient = {
    get(root) {
      getCalls.push(root)
      if (options.pendingGet !== undefined) return options.pendingGet
      return Promise.resolve(typeof getResult === 'function' ? getResult(root) : getResult)
    },
    refresh(root) {
      refreshCalls.push(root)
      return Promise.resolve(
        options.refreshResult ?? (typeof getResult === 'function' ? getResult(root) : getResult),
      )
    },
    resolveBlockers(root) {
      resolveCalls.push(root)
      return options.resolveResult?.() ?? Promise.resolve({ ok: true, result: SNAPSHOT })
    },
    cache: () =>
      Promise.resolve({
        ok: true,
        result: {
          location: '~/.dsh/cache/dsh-mattpocock-workflow/',
          entries: 0,
          lastWrittenAt: null,
          cleared: 0,
        },
      }),
    envCheck: () => Promise.resolve({ ok: true, result: ENV_CHECK }),
    getDetail: () => Promise.reject(new Error('未使用')),
    updateTicket: () => Promise.reject(new Error('未使用')),
    getOptions: () => Promise.reject(new Error('未使用')),
    deleteTicket: () => Promise.reject(new Error('未使用')),
  }
  return { client, getCalls, refreshCalls, resolveCalls }
}

function renderView(
  fake: FakeClient,
  overrides: Partial<OverviewViewProps> = {},
): {
  readonly calls: { readonly tickets: string[]; readonly env: string[] }
} {
  const calls = { tickets: [] as string[], env: [] as string[] }
  render(
    <OverviewView
      client={fake.client}
      workspaceRoot="/repo"
      now={() => NOW}
      onOpenTicket={(ref) => {
        calls.tickets.push(ref)
      }}
      onOpenEnvCheck={(code) => {
        calls.env.push(code)
      }}
      {...overrides}
    />,
  )
  return { calls }
}

describe('概览视图', () => {
  it('显示仓库、后端、实例主机、快照时间与样本量', async () => {
    renderView(fakeClient({ ok: true, result: SNAPSHOT }))

    expect(await screen.findByTestId('metric-grid')).toBeTruthy()
    expect(screen.getByTestId('overview-repo').textContent).toBe(SNAPSHOT.repository)
    expect(screen.getByTestId('overview-backend').textContent).toBe('Gitea')
    expect(screen.getByTestId('overview-host').textContent).toBe('gitea.example.com')
    expect(screen.getByTestId('overview-age').textContent).toBe('2 分钟前')
    expect(screen.getByTestId('overview-loaded').textContent).toContain('已加载 4 / 共 10 张')
  })

  it('三张档位卡纵向给出档位、触发事实与暂估标记', async () => {
    renderView(fakeClient({ ok: true, result: SNAPSHOT }))
    await screen.findByTestId('metric-grid')

    expect(screen.getByTestId('pressure-tier').textContent).toBe('吃紧')
    expect(screen.getByTestId('pressure-scale').dataset.tier).toBe('normal')
    expect(screen.getByTestId('pressure-scale').textContent).toContain('规模')
    expect(screen.getByTestId('pressure-facts-scale').textContent).toBe('近 30 天净流入 +5 张')

    expect(screen.getByTestId('pressure-blocking').dataset.tier).toBe('normal')
    expect(screen.getByTestId('pressure-facts-blocking').textContent).toBe('阻塞占比 33%')
    expect(screen.getByTestId('pressure-provisional-blocking').textContent).toBe('暂估')

    expect(screen.getByTestId('pressure-freshness').dataset.tier).toBe('tight')
    expect(screen.getByTestId('pressure-facts-freshness').textContent).toBe('陈旧率 67%')
    expect(screen.queryByTestId('pressure-provisional-scale')).toBeNull()
  })

  it('关键数字与构成比例来自快照指标与票集合', async () => {
    renderView(fakeClient({ ok: true, result: SNAPSHOT }))
    await screen.findByTestId('metric-grid')

    expect(screen.getByTestId('metric-backlog').textContent).toContain('3 张')
    expect(screen.getByTestId('metric-ready').textContent).toContain('1 张')
    expect(screen.getByTestId('metric-triage').textContent).toContain('1 张')
    expect(screen.getByTestId('metric-stale').textContent).toContain('2 张')
    expect(screen.getByTestId('metric-opened').textContent).toContain('6 张')
    expect(screen.getByTestId('metric-closed').textContent).toContain('1 张')
    expect(screen.getByTestId('metric-closed').textContent).toContain('可能低估')
    expect(screen.getByTestId('metric-net-flow').textContent).toContain('+5')
    expect(screen.getByTestId('metric-net-flow').textContent).toContain('可能高估')
    expect(screen.getByTestId('metric-oldest-update').textContent).toContain('45 天')
    expect(screen.getByTestId('metric-chain').textContent).toContain('3 层')
    // 阻塞占比已写在触发说明里，卡片不再重复；停滞票没触发，仍列在数字里。
    expect(screen.queryByTestId('metric-blocked-ratio')).toBeNull()
    expect(screen.getByTestId('metric-stalled').textContent).toContain('1 张')

    // 样本范围在压力区底部说一次，不在每个数字后面重复。
    expect(screen.getByTestId('metric-backlog').textContent).not.toContain('样本')
    expect(screen.getByTestId('metric-closed').textContent).toContain('可能低估')
    expect(screen.getByTestId('metric-closed').textContent).toContain('样本 4/10')
    expect(screen.getByTestId('pressure-coverage').textContent).toContain('按已加载的 4 / 共 10 张')
    expect(screen.getByTestId('status-distribution-ready').textContent).toContain('可接 1（25%）')
    expect(screen.getByTestId('status-distribution-blocked').textContent).toContain('阻塞 1（25%）')
    expect(screen.getByTestId('category-distribution-bug').textContent).toContain('bug 2（50%）')
    expect(screen.getByTestId('category-distribution-untriaged').textContent).toContain(
      '未定级 1（25%）',
    )
  })

  it('关注清单写明原因，点击后交给列表定位', async () => {
    const fake = fakeClient({ ok: true, result: SNAPSHOT })
    const { calls } = renderView(fake)
    await screen.findByTestId('metric-grid')

    const items = screen.getAllByTestId('attention-item')
    expect(items).toHaveLength(2)
    expect(items[0]?.dataset.reason).toBe('most-blocking')
    expect(items[0]?.textContent).toContain('被 2 张未关闭票挡住')
    expect(items[1]?.dataset.reason).toBe('stale')
    expect(items[1]?.textContent).toContain('陈旧 45 天未更新')

    const first = items[0]
    if (first === undefined) throw new Error('缺少关注清单条目')
    fireEvent.click(first)
    expect(calls.tickets).toEqual(['#1'])
  })

  it('没有需要关注的票时给出空清单', async () => {
    const result: WorkspaceSnapshot = {
      ...SNAPSHOT,
      metrics: { ...METRICS, attention: [] },
    }
    renderView(fakeClient({ ok: true, result }))
    await screen.findByTestId('metric-grid')

    expect(screen.getByTestId('attention-empty').textContent).toContain('没有需要特别关注的票')
    expect(screen.queryAllByTestId('attention-item')).toHaveLength(0)
  })

  it('流量图按周画出新开与关闭，悬停或聚焦某周时读数跟着切换', async () => {
    renderView(fakeClient({ ok: true, result: SNAPSHOT }))
    await screen.findByTestId('flow-chart')

    const weeks = screen.getAllByTestId('flow-week')
    expect(weeks).toHaveLength(8)
    // 默认读数是最近一周：#1、#2 都不在本周新开，#4 也不在本周关闭。
    expect(screen.getByTestId('flow-readout').textContent).toContain('0 新开')

    const latestOpened = weeks.findIndex((week) =>
      (week.getAttribute('aria-label') ?? '').includes('新开 1 张，关闭 1 张'),
    )
    expect(latestOpened).toBeGreaterThanOrEqual(0)
    const target = weeks[latestOpened]
    if (target === undefined) throw new Error('缺少周柱')
    fireEvent.focus(target)
    expect(screen.getByTestId('flow-readout').textContent).toContain('1 新开')
    expect(screen.getByTestId('flow-readout').textContent).toContain('1 关闭')
  })

  it('时效分布按距上次更新的天数统计开放票', async () => {
    renderView(fakeClient({ ok: true, result: SNAPSHOT }))
    await screen.findByTestId('age-histogram')

    expect(screen.getByTestId('age-week').textContent).toBe('2')
    expect(screen.getByTestId('age-older').textContent).toBe('1')
  })

  it('指标不可用时显示不可用与缺口说明，不用 0 冒充', async () => {
    const result: WorkspaceSnapshot = {
      ...SNAPSHOT,
      backend: 'markdown',
      repositoryHost: null,
      metrics: {
        ...METRICS,
        staleCount: { value: null, gap: 'no-timestamps' },
        staleRatio: { value: null, gap: 'no-timestamps' },
        openedLast30Days: { value: null, gap: 'no-timestamps' },
        closedLast30Days: { value: null, gap: 'no-closed-time' },
        netFlow: { value: null, gap: 'no-timestamps' },
        longestBlockerChain: { value: null, gap: 'no-dependency-edges' },
        pressure: {
          tier: 'normal',
          dimensions: [
            dimension('scale', {
              tier: 'normal',
              signals: [{ metric: 'backlog', value: 3 }],
              triggers: ['backlog'],
              gaps: ['no-timestamps'],
            }),
            dimension('blocking'),
            dimension('freshness', {
              tier: null,
              signals: [{ metric: 'stalled', value: 1 }],
              gaps: ['no-timestamps'],
            }),
          ],
        },
      },
    }
    renderView(fakeClient({ ok: true, result }))
    await screen.findByTestId('metric-grid')

    expect(screen.getByTestId('metric-stale').textContent).toContain('不可用')
    expect(screen.getByTestId('metric-stale').textContent).toContain('缺时间数据')
    expect(screen.getByTestId('metric-closed').textContent).toContain('缺关闭时间')
    expect(screen.getByTestId('metric-chain').textContent).toContain('缺依赖边')
    expect(screen.getByTestId('pressure-gap-scale').textContent).toContain('后端不提供工单时间')
    expect(screen.getByTestId('pressure-gap-freshness').textContent).toContain('后端不提供工单时间')
    expect(screen.getByTestId('pressure-tier-freshness').textContent).toBe('不可用')
    expect(screen.queryByTestId('overview-host')).toBeNull()
    expect(screen.queryByTestId('flow-chart')).toBeNull()
    expect(screen.queryByTestId('age-histogram')).toBeNull()
  })

  it('首屏显示加载态', async () => {
    const pending = deferred<RpcResult<WorkspaceSnapshot>>()
    renderView(fakeClient({ ok: true, result: SNAPSHOT }, { pendingGet: pending.promise }))

    expect(screen.getByTestId('overview-loading').textContent).toContain('正在读取工单')

    pending.resolve({ ok: true, result: SNAPSHOT })
    expect(await screen.findByTestId('metric-grid')).toBeTruthy()
    expect(screen.queryByTestId('overview-loading')).toBeNull()
  })

  it('加载失败时给出与列表一致的错误提示，并提供环境检查入口', async () => {
    const fake = fakeClient({
      ok: false,
      error: { code: 'tea-missing', message: '未找到 tea' },
    })
    const { calls } = renderView(fake)

    await screen.findByTestId('error')
    expect(screen.getByTestId('error').textContent).toContain('未找到 tea 命令')

    fireEvent.click(screen.getByTestId('open-env-check'))
    expect(calls.env).toEqual(['tea-missing'])
  })

  it('失败后可以从概览刷新重试', async () => {
    const fake = fakeClient(
      { ok: false, error: { code: 'fetch-failed', message: '网络错误' } },
      { refreshResult: { ok: true, result: SNAPSHOT } },
    )
    renderView(fake)

    await screen.findByTestId('error')
    fireEvent.click(screen.getByTestId('overview-refresh'))

    await waitFor(() => {
      expect(fake.refreshCalls).toEqual(['/repo'])
    })
    expect(await screen.findByTestId('metric-grid')).toBeTruthy()
  })

  it('阻塞补齐完成后指标自动更新，去掉暂估标记', async () => {
    const phaseOne: WorkspaceSnapshot = {
      ...SNAPSHOT,
      blockersFinalized: false,
      metrics: METRICS,
    }
    const finalized: WorkspaceSnapshot = {
      ...SNAPSHOT,
      blockersFinalized: true,
      metrics: {
        ...METRICS,
        pressure: {
          tier: 'tight',
          dimensions: METRICS.pressure.dimensions.map((entry) =>
            entry.dimension === 'blocking' ? { ...entry, provisional: false } : entry,
          ),
        },
      },
    }
    const resolve = deferred<RpcResult<WorkspaceSnapshot>>()
    const fake = fakeClient(
      { ok: true, result: phaseOne },
      {
        resolveResult: () => resolve.promise,
      },
    )
    renderView(fake)

    await screen.findByTestId('metric-grid')
    expect(screen.getByTestId('pressure-provisional-blocking').textContent).toBe('暂估')

    resolve.resolve({ ok: true, result: finalized })

    await waitFor(() => {
      expect(screen.queryByTestId('pressure-provisional-blocking')).toBeNull()
    })
    expect(fake.resolveCalls).toEqual(['/repo'])
  })

  it('切换工作区后按新仓库重新读取', async () => {
    const fake = fakeClient((root) => ({
      ok: true,
      result: {
        ...SNAPSHOT,
        repository: `${root}/repo`,
        repositoryHost: null,
      },
    }))
    const { rerender } = render(
      <OverviewView
        client={fake.client}
        workspaceRoot="/one"
        now={() => NOW}
        onOpenTicket={() => undefined}
        onOpenEnvCheck={() => undefined}
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('overview-repo').textContent).toBe('/one/repo')
    })

    rerender(
      <OverviewView
        client={fake.client}
        workspaceRoot="/two"
        now={() => NOW}
        onOpenTicket={() => undefined}
        onOpenEnvCheck={() => undefined}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('overview-repo').textContent).toBe('/two/repo')
    })
    expect(fake.getCalls).toEqual(['/one', '/two'])
  })
  it('实时快照标出数据来源是实时', async () => {
    renderView(fakeClient({ ok: true, result: SNAPSHOT }))
    await screen.findByTestId('metric-grid')

    expect(screen.getByTestId('overview-source').textContent).toBe('实时')
  })

  it('快照来自本地缓存时标出本地缓存', async () => {
    const cached: WorkspaceSnapshot = { ...SNAPSHOT, source: 'cache', stale: true }
    renderView(fakeClient({ ok: true, result: cached }))
    await screen.findByTestId('metric-grid')

    expect(screen.getByTestId('overview-source').textContent).toBe('本地缓存')
  })

  it('刷新失败时保留概览数据，并在时间旁边显示失败原因', async () => {
    const fake = fakeClient(
      { ok: true, result: SNAPSHOT },
      { refreshResult: { ok: false, error: { code: 'fetch-failed', message: '网络断了' } } },
    )
    renderView(fake)
    await screen.findByTestId('metric-grid')

    fireEvent.click(screen.getByTestId('overview-refresh'))

    await screen.findByTestId('overview-refresh-error')
    expect(screen.getByTestId('overview-refresh-error').textContent).toContain('网络断了')
    expect(screen.queryByTestId('error')).toBeNull()
    expect(screen.getByTestId('metric-grid')).toBeTruthy()
  })
})
