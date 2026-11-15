/**
 * 列表底部的「加载更多」：哨兵进入视口就自动扩一页，失败时停下等重试，
 * 到窗口上限后不再请求。宿主与后端的窗口边界在各自的测试里覆盖，这里只验界面行为。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'

import { SNAPSHOT_MAX_WINDOW, type RpcResult, type WorkspaceSnapshot } from '../protocol/tracker.ts'
import { fakeInjection } from './injection-test-support.ts'
import type { PanelClient } from './rpc.ts'
import { SNAPSHOT, TICKETS, clientWith, NOW } from './task-panel-test-support.ts'
import { TicketsViewWithRequest } from './tickets-view-test-support.tsx'

/** 记录所有 IntersectionObserver 实例，测试手动触发「哨兵进入视口」。 */
const observers: IntersectionObserverCallback[] = []

beforeEach(() => {
  observers.length = 0
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

class FakeIntersectionObserver {
  readonly root = null
  readonly rootMargin = ''
  readonly thresholds: readonly number[] = []
  target: Element | null = null

  constructor(callback: IntersectionObserverCallback) {
    observers.push(callback)
  }

  observe(target: Element): void {
    this.target = target
  }
  unobserve(): void {
    this.target = null
  }
  disconnect(): void {
    this.target = null
  }
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

/** 触发最近一个哨兵的「进入视口」回调。 */
function scrollToBottom(): void {
  const callback = observers.at(-1)
  act(() => {
    callback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
  })
}

function renderView(client: PanelClient): void {
  render(
    <TicketsViewWithRequest
      client={client}
      workspaceRoot="/repo"
      injection={fakeInjection()}
      now={() => NOW}
      onOpenEnvCheck={vi.fn()}
      onOpenTicket={vi.fn()}
    />,
  )
}

describe('加载更多', () => {
  it('滚到底自动扩一页，覆盖全部工单后不再显示哨兵', async () => {
    const first: WorkspaceSnapshot = {
      ...SNAPSHOT,
      loaded: 2,
      total: 4,
      windowLimit: 2,
      tickets: TICKETS.slice(0, 2),
    }
    const second: WorkspaceSnapshot = {
      ...SNAPSHOT,
      loaded: 4,
      total: 4,
      windowLimit: 4,
      tickets: TICKETS,
    }
    const client = clientWith({
      get: () => Promise.resolve({ ok: true, result: first }),
      more: () => Promise.resolve({ ok: true, result: second }),
    })

    renderView(client)

    await waitFor(() => {
      expect(screen.getByTestId('loaded-total').textContent).toContain('已加载 2 / 共 4')
    })
    expect(screen.getByTestId('load-more')).toBeTruthy()

    scrollToBottom()

    await waitFor(() => {
      expect(screen.getByTestId('loaded-total').textContent).toContain('已加载 4 / 共 4')
    })
    expect(screen.queryByTestId('load-more')).toBeNull()
  })

  it('加载失败时保留列表并可重试，重试成功后窗口继续扩大', async () => {
    const first: WorkspaceSnapshot = {
      ...SNAPSHOT,
      loaded: 2,
      total: 4,
      windowLimit: 2,
      tickets: TICKETS.slice(0, 2),
    }
    const second: WorkspaceSnapshot = {
      ...SNAPSHOT,
      loaded: 4,
      total: 4,
      windowLimit: 4,
      tickets: TICKETS,
    }
    const results: RpcResult<WorkspaceSnapshot>[] = [
      { ok: false, error: { code: 'fetch-failed', message: '读取超时' } },
      { ok: true, result: second },
    ]
    const client = clientWith({
      get: () => Promise.resolve({ ok: true, result: first }),
      more: () => Promise.resolve(results.shift() ?? { ok: true, result: second }),
    })

    renderView(client)

    await waitFor(() => {
      expect(screen.getByTestId('loaded-total').textContent).toContain('已加载 2 / 共 4')
    })
    scrollToBottom()

    await screen.findByTestId('load-more-retry')
    expect(screen.getByTestId('loaded-total').textContent).toContain('已加载 2 / 共 4')
    expect(screen.getAllByTestId('ticket-row')).toHaveLength(2)

    fireEvent.click(screen.getByTestId('load-more-retry'))

    await waitFor(() => {
      expect(screen.getByTestId('loaded-total').textContent).toContain('已加载 4 / 共 4')
    })
    expect(screen.queryByTestId('load-more-retry')).toBeNull()
  })

  it('到达窗口上限后显示已达上限，不再出现哨兵', async () => {
    const capped: WorkspaceSnapshot = {
      ...SNAPSHOT,
      loaded: SNAPSHOT_MAX_WINDOW,
      total: 3000,
      windowLimit: SNAPSHOT_MAX_WINDOW,
    }
    const client = clientWith({
      get: () => Promise.resolve({ ok: true, result: capped }),
    })

    renderView(client)

    await waitFor(() => {
      expect(screen.getByTestId('loaded-total').textContent).toContain(
        `已加载 ${String(SNAPSHOT_MAX_WINDOW)} / 共 3000，已达上限`,
      )
    })
    expect(screen.queryByTestId('load-more')).toBeNull()
  })
})
