/**
 * agent 活动触发的按需刷新：面板常驻右栏，agent 改完工单只能靠会话活动把变化拉回来。
 * 这里用真实的面板状态验证四件事：变化才落地、没变化不重绘、失败保数据、换工作区不串数据。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import * as React from 'react'

import type { RpcResult, TicketSnapshot, WorkspaceSnapshot } from '../protocol/tracker.ts'
import { fakeInjection } from './injection-test-support.ts'
import type { PanelClient } from './rpc.ts'
import {
  chooseSort,
  clientWith,
  NOW,
  SNAPSHOT,
  sortState,
  TICKETS,
} from './task-panel-test-support.ts'
import { TicketsViewWithRequest } from './tickets-view-test-support.tsx'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const NEW_TICKET: TicketSnapshot = {
  ref: '#6',
  number: 6,
  title: 'Foxtrot',
  state: 'open',
  category: 'bug',
  status: 'open',
  skillAction: 'triage',
  skillActionReason: 'untriaged',
  labels: [],
  author: null,
  assignees: [],
  createdAt: '2026-11-12T10:00:00Z',
  updatedAt: '2026-11-12T10:00:00Z',
  openBlockers: 0,
}

/** 多一张开放票的列表。 */
function withNewTicket(base: WorkspaceSnapshot = SNAPSHOT): WorkspaceSnapshot {
  return { ...base, tickets: [...TICKETS, NEW_TICKET], loaded: TICKETS.length + 1, total: 31 }
}

function viewElement(
  client: PanelClient,
  refreshSignal: number,
  workspaceRoot = '/repo',
): React.ReactElement {
  return (
    <TicketsViewWithRequest
      client={client}
      workspaceRoot={workspaceRoot}
      injection={fakeInjection()}
      now={() => NOW}
      onOpenEnvCheck={() => undefined}
      onOpenTicket={() => undefined}
      refreshSignal={refreshSignal}
    />
  )
}

function rowRefs(): readonly (string | null)[] {
  return screen.getAllByTestId('ticket-row').map((row) => row.getAttribute('data-ref'))
}

describe('agent 活动后的按需刷新', () => {
  it('信号到达时只做增量刷新，新票随后出现在列表里', async () => {
    const refreshes: string[] = []
    const client = clientWith({
      get: () => Promise.resolve({ ok: true, result: SNAPSHOT }),
      refresh: (root) => {
        refreshes.push(root)
        return Promise.resolve({ ok: true, result: withNewTicket() })
      },
    })
    const view = render(viewElement(client, 0))
    await screen.findAllByTestId('ticket-row')
    expect(rowRefs()).not.toContain('#6')

    view.rerender(viewElement(client, 1))

    await waitFor(() => {
      expect(rowRefs()).toContain('#6')
    })
    expect(refreshes).toEqual(['/repo'])
    expect(screen.getByTestId('loaded-total').textContent).toContain('已加载 6 / 共 31')
  })

  it('拉回来还是同一份数据时不改写快照，数据时间不动', async () => {
    const refetched = Promise.withResolvers<RpcResult<WorkspaceSnapshot>>()
    const client = clientWith({
      get: () => Promise.resolve({ ok: true, result: SNAPSHOT }),
      refresh: () => refetched.promise,
    })
    const view = render(viewElement(client, 0))
    await screen.findAllByTestId('ticket-row')
    expect(screen.getByTestId('snapshot-age').textContent).toBe('刚刚')

    view.rerender(viewElement(client, 1))
    await act(async () => {
      refetched.resolve({ ok: true, result: { ...SNAPSHOT, fetchedAt: NOW - 3_600_000 } })
      await refetched.promise
    })

    expect(screen.getByTestId('snapshot-age').textContent).toBe('刚刚')
    expect(screen.getAllByTestId('ticket-row')).toHaveLength(4)
  })

  it('列表阶段还没定稿时先补齐再比较，定稿结果没变就不落地', async () => {
    const refetched = Promise.withResolvers<RpcResult<WorkspaceSnapshot>>()
    const finalized = Promise.withResolvers<RpcResult<WorkspaceSnapshot>>()
    const resolves: string[] = []
    const client = clientWith({
      get: () => Promise.resolve({ ok: true, result: SNAPSHOT }),
      refresh: () => refetched.promise,
      resolveBlockers: (root) => {
        resolves.push(root)
        return finalized.promise
      },
    })
    const view = render(viewElement(client, 0))
    await screen.findAllByTestId('ticket-row')

    view.rerender(viewElement(client, 1))
    await act(async () => {
      refetched.resolve({
        ok: true,
        result: { ...SNAPSHOT, fetchedAt: NOW - 3_600_000, blockersFinalized: false },
      })
      await refetched.promise
    })
    await waitFor(() => {
      expect(resolves).toEqual(['/repo'])
    })
    await act(async () => {
      finalized.resolve({ ok: true, result: { ...SNAPSHOT, fetchedAt: NOW - 3_600_000 } })
      await finalized.promise
    })

    expect(screen.getByTestId('snapshot-age').textContent).toBe('刚刚')
  })

  it('补齐之后确实出现了新票才落地', async () => {
    const client = clientWith({
      get: () => Promise.resolve({ ok: true, result: SNAPSHOT }),
      refresh: () =>
        Promise.resolve({ ok: true, result: { ...SNAPSHOT, blockersFinalized: false } }),
      resolveBlockers: () => Promise.resolve({ ok: true, result: withNewTicket() }),
    })
    const view = render(viewElement(client, 0))
    await screen.findAllByTestId('ticket-row')
    expect(rowRefs()).not.toContain('#6')

    view.rerender(viewElement(client, 1))

    await waitFor(() => {
      expect(rowRefs()).toContain('#6')
    })
  })

  it('刷新途中换工作区，旧仓库的结果不会写进新工作区', async () => {
    const pending = Promise.withResolvers<RpcResult<WorkspaceSnapshot>>()
    const oldRepo: WorkspaceSnapshot = { ...SNAPSHOT, repository: 'old/repo' }
    const newRepo: WorkspaceSnapshot = { ...SNAPSHOT, repository: 'new/repo' }
    const refreshes: string[] = []
    const client = clientWith({
      get: (root) => Promise.resolve({ ok: true, result: root === '/new' ? newRepo : oldRepo }),
      refresh: (root) => {
        refreshes.push(root)
        return pending.promise
      },
    })
    const view = render(viewElement(client, 0, '/old'))
    await screen.findAllByTestId('ticket-row')
    expect(screen.getByTestId('repo-name').textContent).toBe('old/repo')

    view.rerender(viewElement(client, 1, '/old'))
    await waitFor(() => {
      expect(refreshes).toEqual(['/old'])
    })
    // 这次刷新还没回来时又来一次信号：这一轮要被压下来，不能拿旧工作区再拉一次。
    view.rerender(viewElement(client, 2, '/old'))

    view.rerender(viewElement(client, 2, '/new'))
    await waitFor(() => {
      expect(screen.getByTestId('repo-name').textContent).toBe('new/repo')
    })
    await act(async () => {
      pending.resolve({ ok: true, result: oldRepo })
      await pending.promise
    })

    expect(screen.getByTestId('repo-name').textContent).toBe('new/repo')
    expect(refreshes).toEqual(['/old'])
  })

  it('刷新失败时保留列表，并把原因显示在数据旁边', async () => {
    const client = clientWith({
      get: () => Promise.resolve({ ok: true, result: SNAPSHOT }),
      refresh: () =>
        Promise.resolve({ ok: false, error: { code: 'fetch-failed', message: '网络断了' } }),
    })
    const view = render(viewElement(client, 0))
    await screen.findAllByTestId('ticket-row')

    view.rerender(viewElement(client, 1))

    await screen.findByTestId('refresh-error')
    expect(screen.getByTestId('refresh-error').textContent).toContain('网络断了')
    expect(screen.queryByTestId('error')).toBeNull()
    expect(screen.getAllByTestId('ticket-row')).toHaveLength(4)
  })

  it('刷新期间用户选的过滤与排序不回到默认', async () => {
    const client = clientWith({
      get: () => Promise.resolve({ ok: true, result: SNAPSHOT }),
      refresh: () => Promise.resolve({ ok: true, result: withNewTicket() }),
    })
    const view = render(viewElement(client, 0))
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('filter-all'))
    chooseSort('title')

    view.rerender(viewElement(client, 1))

    await waitFor(() => {
      expect(rowRefs()).toContain('#6')
    })
    expect(screen.getByTestId('filter-all').getAttribute('aria-pressed')).toBe('true')
    expect(sortState().key).toBe('title')
    expect(sortState().direction).toBe('asc')
  })
})
