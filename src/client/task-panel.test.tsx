import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'

import type { RpcResult, TicketSnapshot, WorkspaceSnapshot } from '../protocol/tracker.ts'
import { NEW_BUG_PROMPT, NEW_FEATURE_PROMPT, processTicketPrompt } from './prompts.ts'
import type { SnapshotClient } from './rpc.ts'
import { TaskPanel, type TaskPanelProps } from './task-panel.tsx'

afterEach(cleanup)

const NOW = Date.parse('2026-11-12T15:00:00Z')

const TICKETS: readonly TicketSnapshot[] = [
  {
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
    number: 3,
    title: 'Charlie',
    state: 'closed',
    category: 'bug',
    status: 'closed',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-11-04T00:00:00Z',
    openBlockers: 0,
  },
  {
    number: 4,
    title: 'Delta',
    state: 'open',
    category: null,
    status: 'open',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-11-02T00:00:00Z',
    openBlockers: 0,
  },
  {
    number: 5,
    title: 'Echo',
    state: 'open',
    category: 'enhancement',
    status: 'ready',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    openBlockers: 0,
  },
]

const SNAPSHOT: WorkspaceSnapshot = {
  repository: 'cnzgray/dsh-mattpocock-workflow',
  fetchedAt: NOW - 15_000,
  loaded: TICKETS.length,
  total: 30,
  tickets: TICKETS,
}

interface FakeClient {
  readonly client: SnapshotClient
  readonly getCalls: string[]
  readonly refreshCalls: string[]
}

function fakeClient(
  getResult: RpcResult<WorkspaceSnapshot> | ((root: string) => RpcResult<WorkspaceSnapshot>),
  refreshResult?: RpcResult<WorkspaceSnapshot>,
): FakeClient {
  const getCalls: string[] = []
  const refreshCalls: string[] = []
  const get = (root: string): RpcResult<WorkspaceSnapshot> =>
    typeof getResult === 'function' ? getResult(root) : getResult
  const client: SnapshotClient = {
    get(root) {
      getCalls.push(root)
      return Promise.resolve(get(root))
    },
    refresh(root) {
      refreshCalls.push(root)
      return Promise.resolve(refreshResult ?? get(root))
    },
  }
  return { client, getCalls, refreshCalls }
}

function deferred<T>(): { readonly promise: Promise<T>; resolve: (value: T) => void } {
  return Promise.withResolvers<T>()
}

function panelProps(overrides: Partial<TaskPanelProps> = {}): TaskPanelProps {
  return {
    client: fakeClient({ ok: true, result: SNAPSHOT }).client,
    workspaceRoot: '/repo',
    canInject: true,
    injectDraft: () => true,
    now: () => NOW,
    ...overrides,
  }
}

function rowNumbers(): readonly (string | null)[] {
  return screen.getAllByTestId('ticket-row').map((row) => row.getAttribute('data-number'))
}

function firstRow(): HTMLElement {
  const row = screen.getAllByTestId('ticket-row').at(0)
  if (row === undefined) throw new Error('缺少工单行')
  return row
}

describe('任务面板', () => {
  it('显示仓库、快照时间、统计与已加载数量', async () => {
    render(<TaskPanel {...panelProps()} />)

    await screen.findAllByTestId('ticket-row')
    expect(screen.getByTestId('repo-name').textContent).toBe('cnzgray/dsh-mattpocock-workflow')
    expect(screen.getByTestId('snapshot-age').textContent).toContain('刚刚')
    expect(screen.getByTestId('stat-ready').textContent).toContain('2')
    expect(screen.getByTestId('stat-blocked').textContent).toContain('1')
    expect(screen.getByTestId('stat-closed').textContent).toContain('1')
    expect(screen.getByTestId('loaded-total').textContent).toContain('已加载 5 / 共 30')
    expect(screen.getAllByTestId('ticket-row')).toHaveLength(5)
  })

  it('首次加载时显示正在读取状态', async () => {
    const pending = Promise.withResolvers<RpcResult<WorkspaceSnapshot>>()
    const client: SnapshotClient = {
      get: () => pending.promise,
      refresh: () => pending.promise,
    }
    render(<TaskPanel {...panelProps({ client })} />)

    expect(screen.getByTestId('loading').textContent).toContain('正在读取工单')

    pending.resolve({ ok: true, result: SNAPSHOT })
    await screen.findAllByTestId('ticket-row')
    expect(screen.queryByTestId('loading')).toBeNull()
  })

  it('按状态过滤列表', async () => {
    render(<TaskPanel {...panelProps()} />)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('filter-ready'))
    expect(rowNumbers()).toEqual(['1', '5'])

    fireEvent.click(screen.getByTestId('filter-blocked'))
    expect(rowNumbers()).toEqual(['2'])

    fireEvent.click(screen.getByTestId('filter-closed'))
    expect(rowNumbers()).toEqual(['3'])

    fireEvent.click(screen.getByTestId('filter-open'))
    expect(rowNumbers()).toEqual(['1', '2', '4', '5'])
  })

  it('按标题和编号排序，再次点击当前排序切换升降序', async () => {
    render(<TaskPanel {...panelProps()} />)
    await screen.findAllByTestId('ticket-row')

    expect(rowNumbers()).toEqual(['1', '3', '2', '4', '5'])

    fireEvent.click(screen.getByTestId('sort-title'))
    expect(rowNumbers()).toEqual(['2', '1', '3', '4', '5'])

    fireEvent.click(screen.getByTestId('sort-title'))
    expect(rowNumbers()).toEqual(['5', '4', '3', '1', '2'])

    fireEvent.click(screen.getByTestId('sort-number'))
    expect(rowNumbers()).toEqual(['5', '4', '3', '2', '1'])

    fireEvent.click(screen.getByTestId('sort-number'))
    expect(rowNumbers()).toEqual(['1', '2', '3', '4', '5'])
  })

  it('刷新会重新拉取并更新快照', async () => {
    const fake = fakeClient(
      { ok: true, result: SNAPSHOT },
      { ok: true, result: { ...SNAPSHOT, fetchedAt: NOW, total: 31 } },
    )
    render(<TaskPanel {...panelProps({ client: fake.client })} />)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('refresh'))

    await waitFor(() => {
      expect(fake.refreshCalls).toEqual(['/repo'])
    })
    await waitFor(() => {
      expect(screen.getByTestId('loaded-total').textContent).toContain('共 31')
    })
  })

  it('刷新进行中时按钮禁用且不能重复触发', async () => {
    const pending = deferred<RpcResult<WorkspaceSnapshot>>()
    const client: SnapshotClient = {
      get: () => Promise.resolve({ ok: true, result: SNAPSHOT }),
      refresh: () => pending.promise,
    }
    render(<TaskPanel {...panelProps({ client })} />)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('refresh'))
    const button = screen.getByTestId<HTMLButtonElement>('refresh')
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('刷新中…')

    fireEvent.click(button)
    expect(button.disabled).toBe(true)

    pending.resolve({ ok: true, result: SNAPSHOT })
    await waitFor(() => {
      expect(button.disabled).toBe(false)
    })
  })

  it('刷新失败时保留旧列表并显示失败原因', async () => {
    const fake = fakeClient(
      { ok: true, result: SNAPSHOT },
      { ok: false, error: { code: 'gh-missing', message: '未找到 gh' } },
    )
    render(<TaskPanel {...panelProps({ client: fake.client })} />)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('refresh'))

    await screen.findByTestId('error')
    expect(screen.getByTestId('error').textContent).toContain('未找到 gh 命令')
    expect(screen.getAllByTestId('ticket-row')).toHaveLength(5)
  })

  it('首次读取失败时显示可操作提示且没有列表', async () => {
    const fake = fakeClient({
      ok: false,
      error: { code: 'not-a-repo', message: '不是仓库' },
    })
    render(<TaskPanel {...panelProps({ client: fake.client })} />)

    await screen.findByTestId('error')
    expect(screen.getByTestId('error').textContent).toContain('不是 git 仓库')
    expect(screen.queryAllByTestId('ticket-row')).toHaveLength(0)
  })

  it('三个注入入口分别填入对应提示词', async () => {
    const injectDraft = vi.fn(() => true)
    render(<TaskPanel {...panelProps({ injectDraft })} />)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('new-feature'))
    expect(injectDraft).toHaveBeenLastCalledWith(NEW_FEATURE_PROMPT)

    fireEvent.click(screen.getByTestId('new-bug'))
    expect(injectDraft).toHaveBeenLastCalledWith(NEW_BUG_PROMPT)

    fireEvent.click(firstRow())
    expect(injectDraft).toHaveBeenLastCalledWith(processTicketPrompt(1))
  })

  it('没有可用会话时禁用注入按钮并给出提示', async () => {
    const injectDraft = vi.fn(() => true)
    render(<TaskPanel {...panelProps({ canInject: false, injectDraft })} />)
    await screen.findAllByTestId('ticket-row')

    expect(screen.getByTestId<HTMLButtonElement>('new-feature').disabled).toBe(true)
    expect(screen.getByTestId<HTMLButtonElement>('new-bug').disabled).toBe(true)
    expect(screen.getByTestId('no-session-hint').textContent).toContain('没有可用会话')

    fireEvent.click(firstRow())
    expect(injectDraft).not.toHaveBeenCalled()
    expect(screen.getByTestId('inject-notice').textContent).toContain('无法填入提示词')
  })

  it('切换工作区后清空旧快照并读取新工作区', async () => {
    const fake = fakeClient((root) => ({
      ok: true,
      result: { ...SNAPSHOT, repository: `${root}/repo` },
    }))
    const { rerender } = render(
      <TaskPanel {...panelProps({ client: fake.client, workspaceRoot: '/one' })} />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('repo-name').textContent).toBe('/one/repo')
    })

    rerender(<TaskPanel {...panelProps({ client: fake.client, workspaceRoot: '/two' })} />)

    await waitFor(() => {
      expect(screen.getByTestId('repo-name').textContent).toBe('/two/repo')
    })
    expect(fake.getCalls).toEqual(['/one', '/two'])
  })
})
