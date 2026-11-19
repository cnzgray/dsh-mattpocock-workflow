/**
 * 工单详情里的阻塞项：展开入口、引用集合过滤、点击交接与换票收起。
 * 与详情视图的其他用例分开，免得一个测试文件超过行数上限。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TicketSnapshot } from '../protocol/tracker.ts'
import { fakeInjection } from './injection-test-support.ts'
import {
  button,
  element,
  fakeBackend,
  renderView,
  snapshotTicket,
  target,
  view,
} from './ticket-detail-view-test-support.tsx'
import type { TicketDetailViewProps } from './ticket-detail-view.tsx'

afterEach(() => {
  cleanup()
})

const BLOCKER_OPEN = snapshotTicket({
  ref: '#3',
  number: 3,
  title: 'Alpha',
  state: 'open',
  status: 'open',
  skillAction: 'none',
  skillActionReason: 'untriaged',
})

const BLOCKER_CLOSED = snapshotTicket({
  ref: '#4',
  number: 4,
  title: 'Done',
  state: 'closed',
  status: 'closed',
  skillAction: 'none',
  skillActionReason: 'closed',
})

/** 一张被阻塞的票；refs 为 null 表示快照行没有 blockedBy（GitHub 只有计数）。 */
function blocked(
  overrides: Partial<TicketSnapshot> = {},
  refs: readonly string[] | null = ['#3', '#3', '#4', '#9'],
): TicketSnapshot {
  return snapshotTicket({
    status: 'blocked',
    skillAction: 'none',
    skillActionReason: 'blocked',
    openBlockers: 2,
    ...overrides,
    ...(refs === null ? {} : { blockedBy: refs }),
  })
}

function blockerItem(ref: string): HTMLElement {
  const item = screen
    .getAllByTestId('blocker-item')
    .find((element) => element.getAttribute('data-ref') === ref)
  if (item === undefined) throw new Error(`缺少阻塞项 ${ref}`)
  return item
}

function renderBlocked(overrides: Partial<TicketDetailViewProps> = {}): void {
  const ticket = blocked()
  renderView(fakeBackend().client, {
    target: target(ticket),
    snapshotTickets: [ticket, BLOCKER_OPEN, BLOCKER_CLOSED],
    ...overrides,
  })
}

describe('详情里的阻塞项', () => {
  it('展开「阻塞 N」列出未关闭且去重后的阻塞项，再点收起', async () => {
    renderBlocked()
    await screen.findByTestId('detail-title')

    const toggle = button('blockers-toggle')
    expect(toggle.textContent).toContain('阻塞 2')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('detail-blockers')).toBeNull()

    fireEvent.click(toggle)

    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(element('detail-blockers').getAttribute('id')).toBe(toggle.getAttribute('aria-controls'))
    const items = screen.getAllByTestId('blocker-item')
    // #3 重复只出现一次；#4 已关闭被排除；#9 不在快照里但保留引用。
    expect(items.map((item) => item.getAttribute('data-ref'))).toEqual(['#3', '#9'])
    expect(items[0]?.querySelector('[data-testid="blocker-title"]')?.textContent).toBe('Alpha')
    expect(items[0]?.querySelector('[data-testid="blocker-state"]')?.textContent).toBe('开放')
    expect(items[1]?.querySelector('[data-testid="blocker-unloaded"]')?.textContent).toBe('未加载')
    expect(items[1]?.querySelector('[data-testid="blocker-title"]')).toBeNull()

    fireEvent.click(toggle)

    expect(screen.queryByTestId('detail-blockers')).toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('点击阻塞项只把引用交给面板，不注入提示词', async () => {
    const inject = vi.fn(() => 'filled' as const)
    const onOpenBlocker = vi.fn()
    renderBlocked({
      injection: fakeInjection({ inject }),
      onOpenBlocker,
    })
    await screen.findByTestId('detail-title')

    fireEvent.click(button('blockers-toggle'))
    fireEvent.click(blockerItem('#3'))

    expect(onOpenBlocker).toHaveBeenCalledWith('#3')
    expect(inject).not.toHaveBeenCalled()
  })

  it('单条跨仓库阻塞项不会被本地同号已关闭票过滤，仍可展开', async () => {
    const localSameNumber = snapshotTicket({
      ref: '#33',
      number: 33,
      title: '本仓库同号票',
      state: 'closed',
      status: 'closed',
      skillAction: 'none',
      skillActionReason: 'closed',
    })
    const ticket = blocked({ ref: '#97', number: 97, openBlockers: 1 }, [
      'cyit-platform/cyit-harness#33',
    ])
    renderView(fakeBackend().client, {
      target: target(ticket),
      snapshotTickets: [ticket, localSameNumber],
    })
    await screen.findByTestId('detail-title')

    const toggle = button('blockers-toggle')
    expect(toggle.textContent).toContain('阻塞 1')
    fireEvent.click(toggle)

    const items = screen.getAllByTestId('blocker-item')
    expect(items.map((item) => item.getAttribute('data-ref'))).toEqual([
      'cyit-platform/cyit-harness#33',
    ])
    expect(items[0]?.querySelector('[data-testid="blocker-unloaded"]')?.textContent).toBe('未加载')
  })

  it('同仓库与跨仓库阻塞项混排时都列出，跨仓库不借用本地同号票的标题', async () => {
    const localSameNumber = snapshotTicket({
      ref: '#33',
      number: 33,
      title: '本仓库同号票',
      state: 'open',
      status: 'open',
      skillAction: 'none',
      skillActionReason: 'untriaged',
    })
    const ticket = blocked({ ref: '#97', number: 97, openBlockers: 2 }, [
      '#3',
      'cyit-platform/cyit-harness#33',
    ])
    renderView(fakeBackend().client, {
      target: target(ticket),
      snapshotTickets: [ticket, BLOCKER_OPEN, localSameNumber],
    })
    await screen.findByTestId('detail-title')

    fireEvent.click(button('blockers-toggle'))

    const items = screen.getAllByTestId('blocker-item')
    expect(items.map((item) => item.getAttribute('data-ref'))).toEqual([
      '#3',
      'cyit-platform/cyit-harness#33',
    ])
    expect(items[0]?.querySelector('[data-testid="blocker-title"]')?.textContent).toBe('Alpha')
    expect(items[1]?.querySelector('[data-testid="blocker-title"]')).toBeNull()
    expect(items[1]?.querySelector('[data-testid="blocker-unloaded"]')).toBeTruthy()
  })

  it('没有阻塞引用时保持只读徽标，不出现可点击入口', async () => {
    const ticket = blocked({ openBlockers: 2 }, null)
    renderView(fakeBackend().client, { target: target(ticket), snapshotTickets: [ticket] })
    await screen.findByTestId('detail-title')

    expect(screen.queryByTestId('blockers-toggle')).toBeNull()
    expect(element('action-reason').textContent).toBe('阻塞 2')
    expect(element('action-reason').title).toContain('未关闭的阻塞')
  })

  it('引用全部已关闭时不展开空面板，入口保持只读', async () => {
    const ticket = blocked({ openBlockers: 1 }, ['#4'])
    renderView(fakeBackend().client, {
      target: target(ticket),
      snapshotTickets: [ticket, BLOCKER_CLOSED],
    })
    await screen.findByTestId('detail-title')

    expect(screen.queryByTestId('blockers-toggle')).toBeNull()
    expect(element('action-reason').textContent).toBe('阻塞 1')
  })

  it('换一张票时展开状态重置', async () => {
    const backend = fakeBackend()
    const first = blocked()
    const second = blocked({ ref: '#26', number: 26, openBlockers: 1 }, ['#3'])
    const { rerender } = render(
      view(backend.client, {
        target: target(first),
        snapshotTickets: [first, BLOCKER_OPEN],
      }),
    )
    await screen.findByTestId('detail-title')
    fireEvent.click(button('blockers-toggle'))
    expect(element('detail-blockers')).toBeTruthy()

    rerender(
      view(backend.client, {
        target: target(second),
        snapshotTickets: [second, BLOCKER_OPEN],
      }),
    )

    expect(screen.queryByTestId('detail-blockers')).toBeNull()
    expect(button('blockers-toggle').getAttribute('aria-expanded')).toBe('false')
  })

  it('快照补齐阻塞引用后入口从只读变成可展开', async () => {
    const backend = fakeBackend()
    const pending = blocked({ openBlockers: 1 }, null)
    const { rerender } = render(
      view(backend.client, { target: target(pending), snapshotTickets: [pending] }),
    )
    await screen.findByTestId('detail-title')
    expect(screen.queryByTestId('blockers-toggle')).toBeNull()

    const finalized = blocked({ openBlockers: 1 }, ['#3'])
    rerender(
      view(backend.client, {
        target: target(finalized),
        snapshotTickets: [finalized, BLOCKER_OPEN],
      }),
    )

    expect(button('blockers-toggle').textContent).toContain('阻塞 1')
  })

  it('有上一张票时返回按钮显示它的引用', async () => {
    renderView(fakeBackend().client, { backRef: '#2' })
    await screen.findByTestId('detail-title')

    expect(element('detail-back').textContent).toContain('返回 #2')
    expect(element('detail-back').title).toBe('返回 #2（Esc）')
  })

  it('按引用打开、快照里没有这张票时不渲染技能徽标与阻塞入口', async () => {
    renderView(fakeBackend().client, {
      target: { ref: '#9', number: 9, ticket: null, repository: null },
      snapshotTickets: [],
    })
    await screen.findByTestId('detail-title')

    expect(element('detail-ref').textContent).toBe('#9')
    expect(screen.queryByTestId('skill-badge')).toBeNull()
    expect(screen.queryByTestId('action-reason')).toBeNull()
    expect(screen.queryByTestId('blockers-toggle')).toBeNull()
  })
})
