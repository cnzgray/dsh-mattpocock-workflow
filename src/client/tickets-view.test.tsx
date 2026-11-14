/**
 * 工单列表的两阶段加载：首屏只等列表，阻塞信息由后台补齐。
 * 这里直接渲染列表视图，用可控的假客户端制造「阶段一已返回、阶段二未返回」的中间态。
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  type RenderResult,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'

import type { EnvCheckReport } from '../protocol/env-check.ts'
import type { RpcResult, TicketSnapshot, WorkspaceSnapshot } from '../protocol/tracker.ts'
import { fakeInjection } from './injection-test-support.ts'
import { emptyMetrics } from '../protocol/snapshot-test-support.ts'
import type { PanelClient } from './rpc.ts'
import { TicketsViewWithRequest } from './tickets-view-test-support.tsx'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const NOW = Date.parse('2026-11-12T15:00:00Z')

const TICKETS: readonly TicketSnapshot[] = [
  {
    ref: '#1',
    number: 1,
    title: 'Bravo',
    state: 'open',
    category: 'enhancement',
    status: 'ready',
    skillAction: 'implement',
    skillActionReason: 'ready-for-agent',
    labels: [],
    author: null,
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
    author: null,
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
    author: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-11-04T00:00:00Z',
    openBlockers: 0,
  },
]

const FINAL: WorkspaceSnapshot = {
  backend: 'gitlab',
  repository: 'cyit/cyit-harness',
  repositoryHost: 'gitlab.com',
  fetchedAt: NOW - 15_000,
  loaded: TICKETS.length,
  total: 3,
  tickets: TICKETS,
  metrics: emptyMetrics(),
  blockersFinalized: true,
  source: 'live',
  stale: false,
  refreshError: null,
}

/** 阶段一快照：#2 还没有原生阻塞数据，按描述回退判定为可接。 */
function phaseOne(overrides: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    ...FINAL,
    blockersFinalized: false,
    tickets: TICKETS.map((ticket) =>
      ticket.ref === '#2'
        ? {
            ...ticket,
            status: 'ready',
            openBlockers: 0,
            skillAction: 'implement',
            skillActionReason: 'ready-for-agent',
          }
        : ticket,
    ),
    ...overrides,
  }
}

interface FakeClient {
  readonly client: PanelClient
  readonly refreshCalls: string[]
  /** 全量刷新的调用记录：宿主收到的请求带 full。 */
  readonly fullRefreshCalls: string[]
  readonly resolveCalls: string[]
}

function deferred<T>(): { readonly promise: Promise<T>; resolve: (value: T) => void } {
  return Promise.withResolvers<T>()
}

const UNUSED_ENV_CHECK = (): Promise<RpcResult<EnvCheckReport>> =>
  Promise.resolve({
    ok: true,
    result: { checkedAt: NOW, backend: null, repository: null, items: [], capabilities: [] },
  })

function fakeClient(
  getResult: RpcResult<WorkspaceSnapshot>,
  resolveResult: () => Promise<RpcResult<WorkspaceSnapshot>>,
  refreshResult?: () => Promise<RpcResult<WorkspaceSnapshot>>,
): FakeClient {
  const refreshCalls: string[] = []
  const fullRefreshCalls: string[] = []
  const resolveCalls: string[] = []
  const client: PanelClient = {
    get: () => Promise.resolve(getResult),
    refresh(root, options) {
      refreshCalls.push(root)
      if (options?.full === true) fullRefreshCalls.push(root)
      return refreshResult === undefined ? Promise.resolve(getResult) : refreshResult()
    },
    resolveBlockers(root) {
      resolveCalls.push(root)
      return resolveResult()
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
    getDetail: () => Promise.reject(new Error('未使用')),
    updateTicket: () => Promise.reject(new Error('未使用')),
    getOptions: () =>
      Promise.resolve({ ok: false, error: { code: 'capability-unsupported', message: '未使用' } }),
    deleteTicket: () => Promise.reject(new Error('未使用')),
    envCheck: UNUSED_ENV_CHECK,
  }
  return { client, refreshCalls, fullRefreshCalls, resolveCalls }
}

function viewElement(
  client: PanelClient,
  workspaceRoot: string,
  onOpenTicket: (ticket: TicketSnapshot) => void = () => undefined,
): React.ReactElement {
  return (
    <TicketsViewWithRequest
      client={client}
      workspaceRoot={workspaceRoot}
      injection={fakeInjection()}
      now={() => NOW}
      onOpenEnvCheck={() => undefined}
      onOpenTicket={onOpenTicket}
    />
  )
}

function renderView(client: PanelClient, workspaceRoot = '/repo'): RenderResult {
  return render(viewElement(client, workspaceRoot))
}

function rowRefs(): readonly (string | null)[] {
  return screen.getAllByTestId('ticket-row').map((row) => row.getAttribute('data-ref'))
}

function firstRow(): HTMLElement {
  const row = screen.getAllByTestId('ticket-row')[0]
  if (row === undefined) throw new Error('缺少工单行')
  return row
}

describe('工单列表的阻塞补齐', () => {
  it('首屏先渲染未定稿快照，补齐返回后更新统计与卡片', async () => {
    const resolvePending = deferred<RpcResult<WorkspaceSnapshot>>()
    const fake = fakeClient({ ok: true, result: phaseOne() }, () => resolvePending.promise)
    renderView(fake.client)

    await screen.findAllByTestId('ticket-row')
    expect(screen.getByTestId('stat-ready').textContent).toContain('2')
    expect(screen.getByTestId('stat-blocked').textContent).toContain('0')
    expect(screen.getByTestId('loaded-total').textContent).toContain('已加载 3 / 共 3')
    expect(fake.resolveCalls).toEqual(['/repo'])

    resolvePending.resolve({ ok: true, result: FINAL })

    await waitFor(() => {
      expect(screen.getByTestId('stat-blocked').textContent).toContain('1')
    })
    expect(screen.getByTestId('stat-ready').textContent).toContain('1')
    const blockedRow = screen
      .getAllByTestId('ticket-row')
      .find((row) => row.getAttribute('data-ref') === '#2')
    expect(blockedRow?.textContent).toContain('阻塞')
    expect(screen.getByTestId('loaded-total').textContent).toContain('已加载 3 / 共 3')
  })

  it('快照已定稿时不发起补齐请求', async () => {
    const fake = fakeClient({ ok: true, result: FINAL }, () =>
      Promise.resolve({ ok: true, result: FINAL }),
    )
    renderView(fake.client)

    await screen.findAllByTestId('ticket-row')

    expect(fake.resolveCalls).toEqual([])
  })

  it('补齐失败时保留列表且不显示错误横幅', async () => {
    const resolvePending = deferred<RpcResult<WorkspaceSnapshot>>()
    const fake = fakeClient({ ok: true, result: phaseOne() }, () => resolvePending.promise)
    renderView(fake.client)
    await screen.findAllByTestId('ticket-row')

    await act(async () => {
      resolvePending.resolve({
        ok: false,
        error: { code: 'fetch-failed', message: '补齐失败' },
      })
      await Promise.resolve()
    })

    expect(screen.queryByTestId('error')).toBeNull()
    expect(screen.getAllByTestId('ticket-row')).toHaveLength(2)
    expect(screen.getByTestId('stat-ready').textContent).toContain('2')
  })

  it('补齐不重置过滤与排序', async () => {
    const resolvePending = deferred<RpcResult<WorkspaceSnapshot>>()
    const fake = fakeClient({ ok: true, result: phaseOne() }, () => resolvePending.promise)
    renderView(fake.client)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('filter-open'))
    fireEvent.click(screen.getByTestId('sort-title'))
    fireEvent.click(screen.getByTestId('sort-title'))
    const before = rowRefs()

    await act(async () => {
      resolvePending.resolve({ ok: true, result: FINAL })
      await Promise.resolve()
    })

    expect(rowRefs()).toEqual(before)
    expect(screen.getByTestId('filter-open').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('sort-title').textContent).toContain('↓')
  })

  it('刷新同样先渲染新列表，再补齐阻塞数字', async () => {
    const refreshPending = deferred<RpcResult<WorkspaceSnapshot>>()
    const resolvePending = deferred<RpcResult<WorkspaceSnapshot>>()
    const fake = fakeClient(
      { ok: true, result: FINAL },
      () => resolvePending.promise,
      () => refreshPending.promise,
    )
    renderView(fake.client)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('refresh'))
    await waitFor(() => {
      expect(fake.refreshCalls).toEqual(['/repo'])
    })

    refreshPending.resolve({ ok: true, result: phaseOne({ total: 4 }) })
    await waitFor(() => {
      expect(screen.getByTestId('loaded-total').textContent).toContain('共 4')
    })
    expect(screen.getByTestId('stat-blocked').textContent).toContain('0')
    expect(fake.resolveCalls).toEqual(['/repo'])

    resolvePending.resolve({ ok: true, result: FINAL })
    await waitFor(() => {
      expect(screen.getByTestId('stat-blocked').textContent).toContain('1')
    })
    expect(screen.getByTestId('loaded-total').textContent).toContain('已加载 3 / 共 3')
  })

  it('点击工单行只打开详情，不注入提示词', async () => {
    const opened: (string | null)[] = []
    const injectDraft = vi.fn(() => 'filled' as const)
    const fake = fakeClient({ ok: true, result: FINAL }, () =>
      Promise.resolve({ ok: true, result: FINAL }),
    )
    render(
      <TicketsViewWithRequest
        client={fake.client}
        workspaceRoot="/repo"
        injection={fakeInjection({ inject: injectDraft })}
        now={() => NOW}
        onOpenEnvCheck={() => undefined}
        onOpenTicket={(ticket) => {
          opened.push(ticket.ref)
        }}
      />,
    )
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(firstRow())

    expect(opened).toEqual(['#1'])
    expect(injectDraft).not.toHaveBeenCalled()
  })

  it('刷新后旧的补齐结果不会覆盖新列表', async () => {
    const stale = deferred<RpcResult<WorkspaceSnapshot>>()
    const refreshPending = deferred<RpcResult<WorkspaceSnapshot>>()
    const client: PanelClient = {
      get: () => Promise.resolve({ ok: true, result: phaseOne({ repository: 'old/repo' }) }),
      refresh: () => refreshPending.promise,
      resolveBlockers: () => stale.promise,
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
      getDetail: () => Promise.reject(new Error('未使用')),
      updateTicket: () => Promise.reject(new Error('未使用')),
      getOptions: () =>
        Promise.resolve({
          ok: false,
          error: { code: 'capability-unsupported', message: '未使用' },
        }),
      deleteTicket: () => Promise.reject(new Error('未使用')),
      envCheck: UNUSED_ENV_CHECK,
    }
    renderView(client)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('refresh'))
    refreshPending.resolve({ ok: true, result: { ...FINAL, repository: 'new/repo' } })
    await waitFor(() => {
      expect(screen.getByTestId('repo-name').textContent).toBe('new/repo')
    })

    await act(async () => {
      stale.resolve({ ok: true, result: phaseOne({ repository: 'old/repo' }) })
      await Promise.resolve()
    })

    expect(screen.getByTestId('repo-name').textContent).toBe('new/repo')
  })
})

describe('视图偏好', () => {
  function readyClient(): PanelClient {
    return fakeClient({ ok: true, result: FINAL }, () =>
      Promise.resolve({ ok: true, result: FINAL }),
    ).client
  }

  it('默认只显示未关闭工单，并按状态升序', async () => {
    renderView(readyClient())
    await screen.findAllByTestId('ticket-row')

    expect(screen.getByTestId('filter-open').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('sort-status').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('sort-status').textContent).toContain('↑')
    expect(rowRefs()).toEqual(['#1', '#2'])
    // 统计仍然基于整份快照，不随当前筛选变化。
    expect(screen.getByTestId('stat-closed').textContent).toContain('1')
    expect(screen.getByTestId('loaded-total').textContent).toContain('已加载 3 / 共 3')
  })

  it('改动筛选、排序键与方向后，重新挂载原样恢复', async () => {
    const first = renderView(readyClient())
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('filter-all'))
    fireEvent.click(screen.getByTestId('sort-number'))
    fireEvent.click(screen.getByTestId('sort-number'))
    const before = rowRefs()
    expect(before).toEqual(['#1', '#2', '#3'])

    first.unmount()
    renderView(readyClient())
    await screen.findAllByTestId('ticket-row')

    expect(screen.getByTestId('filter-all').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('sort-number').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('sort-number').textContent).toContain('↑')
    expect(rowRefs()).toEqual(before)
  })

  it('两个工作区各自恢复自己的视图，互不污染', async () => {
    const client = readyClient()
    const view = renderView(client, '/one')
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('filter-closed'))
    expect(rowRefs()).toEqual(['#3'])

    view.rerender(viewElement(client, '/two'))
    await waitFor(() => {
      expect(rowRefs()).toEqual(['#1', '#2'])
    })
    expect(screen.getByTestId('filter-open').getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByTestId('filter-ready'))
    expect(rowRefs()).toEqual(['#1'])

    view.rerender(viewElement(client, '/one'))
    await waitFor(() => {
      expect(rowRefs()).toEqual(['#3'])
    })
    expect(screen.getByTestId('filter-closed').getAttribute('aria-pressed')).toBe('true')

    view.rerender(viewElement(client, '/two'))
    await waitFor(() => {
      expect(rowRefs()).toEqual(['#1'])
    })
    expect(screen.getByTestId('filter-ready').getAttribute('aria-pressed')).toBe('true')
  })

  it('刷新快照不改变当前筛选、排序键与方向', async () => {
    const fake = fakeClient(
      { ok: true, result: FINAL },
      () => Promise.resolve({ ok: true, result: FINAL }),
      () => Promise.resolve({ ok: true, result: FINAL }),
    )
    renderView(fake.client)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('filter-all'))
    fireEvent.click(screen.getByTestId('sort-title'))
    fireEvent.click(screen.getByTestId('sort-title'))
    fireEvent.click(screen.getByTestId('refresh'))

    await waitFor(() => {
      expect(fake.refreshCalls).toEqual(['/repo'])
    })
    expect(screen.getByTestId('filter-all').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('sort-title').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('sort-title').textContent).toContain('↓')
  })

  it('存储不可用时仍按默认视图渲染', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('storage disabled')
      },
    })

    try {
      renderView(readyClient())
      await screen.findAllByTestId('ticket-row')

      expect(screen.getByTestId('filter-open').getAttribute('aria-pressed')).toBe('true')
      expect(screen.getByTestId('sort-status').getAttribute('aria-pressed')).toBe('true')
      expect(screen.queryByTestId('error')).toBeNull()
      expect(rowRefs()).toEqual(['#1', '#2'])
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(window, 'localStorage')
      else Object.defineProperty(window, 'localStorage', descriptor)
    }
  })
})

describe('空列表的提示', () => {
  it('仓库本来没有工单时，不说成被筛选条件过滤掉', async () => {
    const empty = { ...FINAL, tickets: [], loaded: 0, total: 0 }
    const { client } = fakeClient({ ok: true, result: empty }, () =>
      Promise.resolve({ ok: true, result: empty }),
    )
    renderView(client)

    await waitFor(() => {
      expect(screen.getByTestId('empty').textContent).toBe('这个仓库还没有工单。')
    })
  })

  it('筛选后没有结果时说明是被筛选条件过滤掉', async () => {
    const onlyOpen = { ...FINAL, tickets: TICKETS.filter((ticket) => ticket.state === 'open') }
    const { client } = fakeClient({ ok: true, result: onlyOpen }, () =>
      Promise.resolve({ ok: true, result: onlyOpen }),
    )
    renderView(client)
    await waitFor(() => {
      expect(screen.getAllByTestId('ticket-row')).toHaveLength(2)
    })

    fireEvent.click(screen.getByTestId('filter-closed'))

    expect(screen.getByTestId('empty').textContent).toBe('没有符合筛选条件的工单。')
  })
})

describe('数据来源与刷新', () => {
  it('实时快照标出数据来源是实时', async () => {
    const { client } = fakeClient({ ok: true, result: FINAL }, () =>
      Promise.resolve({ ok: true, result: FINAL }),
    )
    renderView(client)

    await screen.findAllByTestId('ticket-row')

    expect(screen.getByTestId('snapshot-source').textContent).toBe('实时')
  })

  it('快照来自本地缓存时先显示数据，再自动发起一次增量刷新', async () => {
    const refreshPending = deferred<RpcResult<WorkspaceSnapshot>>()
    const cached = { ...FINAL, source: 'cache' as const, stale: true }
    const fake = fakeClient({ ok: true, result: cached }, () =>
      Promise.resolve({ ok: true, result: FINAL }),
    )
    const client: PanelClient = {
      ...fake.client,
      refresh: (root, options) => {
        fake.refreshCalls.push(root)
        if (options?.full === true) fake.fullRefreshCalls.push(root)
        return refreshPending.promise
      },
    }
    renderView(client)

    // 缓存数据先渲染出来，刷新还没回来也不空屏。
    await screen.findAllByTestId('ticket-row')
    expect(screen.getByTestId('snapshot-source').textContent).toBe('本地缓存')
    expect(screen.getAllByTestId('ticket-row')).toHaveLength(2)

    await waitFor(() => {
      expect(fake.refreshCalls).toEqual(['/repo'])
    })
    expect(fake.fullRefreshCalls).toEqual([])
  })

  it('刷新失败时保留列表，并在数据旁边显示失败原因', async () => {
    const fake = fakeClient(
      { ok: true, result: FINAL },
      () => Promise.resolve({ ok: true, result: FINAL }),
      () => Promise.resolve({ ok: false, error: { code: 'fetch-failed', message: '网络断了' } }),
    )
    renderView(fake.client)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('refresh'))

    await screen.findByTestId('refresh-error')
    expect(screen.getByTestId('refresh-error').textContent).toContain('网络断了')
    expect(screen.queryByTestId('error')).toBeNull()
    expect(screen.getAllByTestId('ticket-row')).toHaveLength(2)
  })

  it('快照自带刷新失败原因时在数据旁边显示该原因', async () => {
    const refreshPending = deferred<RpcResult<WorkspaceSnapshot>>()
    const stale = {
      ...FINAL,
      stale: true,
      refreshError: { code: 'fetch-failed' as const, message: '上次刷新失败' },
    }
    const fake = fakeClient({ ok: true, result: stale }, () =>
      Promise.resolve({ ok: true, result: FINAL }),
    )
    const client: PanelClient = {
      ...fake.client,
      refresh: () => refreshPending.promise,
    }
    renderView(client)
    await screen.findAllByTestId('ticket-row')

    await screen.findByTestId('refresh-error')
    expect(screen.getByTestId('refresh-error').textContent).toContain('上次刷新失败')
  })

  it('数据陈旧但没有失败原因时说明数据不是最新的', async () => {
    const refreshPending = deferred<RpcResult<WorkspaceSnapshot>>()
    const stale = { ...FINAL, stale: true }
    const fake = fakeClient({ ok: true, result: stale }, () =>
      Promise.resolve({ ok: true, result: FINAL }),
    )
    const client: PanelClient = {
      ...fake.client,
      refresh: () => refreshPending.promise,
    }
    renderView(client)
    await screen.findAllByTestId('ticket-row')

    await screen.findByTestId('refresh-error')
    expect(screen.getByTestId('refresh-error').textContent).toContain('数据可能不是最新的')
  })

  it('点击全量刷新时让宿主忽略本地快照库重拉一次', async () => {
    const fake = fakeClient({ ok: true, result: FINAL }, () =>
      Promise.resolve({ ok: true, result: FINAL }),
    )
    renderView(fake.client)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('refresh-full'))

    await waitFor(() => {
      expect(fake.fullRefreshCalls).toEqual(['/repo'])
    })
    expect(fake.refreshCalls).toEqual(['/repo'])
  })
})
