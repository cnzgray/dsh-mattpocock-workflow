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
import { afterEach, describe, expect, it } from 'vitest'
import * as React from 'react'

import type { EnvCheckReport } from '../protocol/env-check.ts'
import type { RpcResult, TicketSnapshot, WorkspaceSnapshot } from '../protocol/tracker.ts'
import type { PanelClient } from './rpc.ts'
import { TicketsView } from './tickets-view.tsx'

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
  blockersFinalized: true,
}

/** 阶段一快照：#2 还没有原生阻塞数据，按描述回退判定为可接。 */
function phaseOne(overrides: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    ...FINAL,
    blockersFinalized: false,
    tickets: TICKETS.map((ticket) =>
      ticket.ref === '#2' ? { ...ticket, status: 'ready', openBlockers: 0 } : ticket,
    ),
    ...overrides,
  }
}

interface FakeClient {
  readonly client: PanelClient
  readonly refreshCalls: string[]
  readonly resolveCalls: string[]
}

function deferred<T>(): { readonly promise: Promise<T>; resolve: (value: T) => void } {
  return Promise.withResolvers<T>()
}

const UNUSED_ENV_CHECK = (): Promise<RpcResult<EnvCheckReport>> =>
  Promise.resolve({
    ok: true,
    result: { checkedAt: NOW, backend: null, items: [], capabilities: [] },
  })

function fakeClient(
  getResult: RpcResult<WorkspaceSnapshot>,
  resolveResult: () => Promise<RpcResult<WorkspaceSnapshot>>,
  refreshResult?: () => Promise<RpcResult<WorkspaceSnapshot>>,
): FakeClient {
  const refreshCalls: string[] = []
  const resolveCalls: string[] = []
  const client: PanelClient = {
    get: () => Promise.resolve(getResult),
    refresh(root) {
      refreshCalls.push(root)
      return refreshResult === undefined ? Promise.resolve(getResult) : refreshResult()
    },
    resolveBlockers(root) {
      resolveCalls.push(root)
      return resolveResult()
    },
    envCheck: UNUSED_ENV_CHECK,
  }
  return { client, refreshCalls, resolveCalls }
}

function viewElement(client: PanelClient, workspaceRoot: string): React.ReactElement {
  return (
    <TicketsView
      client={client}
      workspaceRoot={workspaceRoot}
      canInject
      injectDraft={() => true}
      now={() => NOW}
      onOpenEnvCheck={() => undefined}
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
  const row = screen.getAllByTestId('ticket-row').at(0)
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

  it('补齐不重置过滤、排序与选中项', async () => {
    const resolvePending = deferred<RpcResult<WorkspaceSnapshot>>()
    const fake = fakeClient({ ok: true, result: phaseOne() }, () => resolvePending.promise)
    renderView(fake.client)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('filter-open'))
    fireEvent.click(screen.getByTestId('sort-title'))
    fireEvent.click(screen.getByTestId('sort-title'))
    const before = rowRefs()
    fireEvent.click(firstRow())
    expect(firstRow().getAttribute('aria-pressed')).toBe('true')

    await act(async () => {
      resolvePending.resolve({ ok: true, result: FINAL })
      await Promise.resolve()
    })

    expect(rowRefs()).toEqual(before)
    expect(screen.getByTestId('filter-open').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('sort-title').textContent).toContain('↓')
    expect(firstRow().getAttribute('aria-pressed')).toBe('true')
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

  it('刷新后旧的补齐结果不会覆盖新列表', async () => {
    const stale = deferred<RpcResult<WorkspaceSnapshot>>()
    const refreshPending = deferred<RpcResult<WorkspaceSnapshot>>()
    const client: PanelClient = {
      get: () => Promise.resolve({ ok: true, result: phaseOne({ repository: 'old/repo' }) }),
      refresh: () => refreshPending.promise,
      resolveBlockers: () => stale.promise,
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
