import { describe, expect, it } from 'vitest'

import type { Ticket } from '../core/ticket.ts'
import { TrackerError } from '../core/tracker-error.ts'
import { SNAPSHOT_MAX_WINDOW, SNAPSHOT_PAGE_SIZE } from '../protocol/tracker.ts'
import {
  ROOT,
  expectOk,
  memoryStore,
  serviceWith,
  snapshot,
  storedEntry,
  ticket,
} from './snapshot-service-test-support.ts'

/**
 * 构造 `count` 张按更新时间倒序的票：编号越大越新。
 * @param count - 票数。
 * @returns 工单数组。
 */
function manyTickets(count: number): Ticket[] {
  return Array.from({ length: count }, (_, index) =>
    ticket({
      number: count - index,
      title: `第 ${String(count - index)} 张票`,
      updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, count - index)).toISOString(),
    }),
  )
}

describe('加载更多', () => {
  it('250 张工单的仓库：滚到底继续取页，列表最终覆盖全部工单', async () => {
    const tickets = manyTickets(250)
    const { service } = serviceWith([
      snapshot({ tickets: tickets.slice(0, 100), loaded: 100, total: 250, windowLimit: 100 }),
      snapshot({ tickets: tickets.slice(0, 200), loaded: 200, total: 250, windowLimit: 200 }),
      snapshot({ tickets, loaded: 250, total: 250, windowLimit: 300 }),
    ])

    const first = expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))
    expect(first.loaded).toBe(100)

    const second = expectOk(await service.handle('snapshot.more', { workspaceRoot: ROOT }))
    expect(second.loaded).toBe(200)
    expect(second.total).toBe(250)
    expect(second.metrics.coverage.truncated).toBe(true)

    const third = expectOk(await service.handle('snapshot.more', { workspaceRoot: ROOT }))
    expect(third.loaded).toBe(250)
    expect(third.metrics.coverage.truncated).toBe(false)
    expect(third.tickets.map((item) => item.ref)).toEqual(tickets.map((item) => item.ref))
  })

  it('首屏与扩窗都按一页的步长请求窗口', async () => {
    const tickets = manyTickets(250)
    const { service, snapshotWindows } = serviceWith([
      snapshot({ tickets: tickets.slice(0, 100), loaded: 100, total: 250, windowLimit: 100 }),
      snapshot({ tickets: tickets.slice(0, 200), loaded: 200, total: 250, windowLimit: 200 }),
    ])

    expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))
    expectOk(await service.handle('snapshot.more', { workspaceRoot: ROOT }))

    expect(snapshotWindows).toEqual([SNAPSHOT_PAGE_SIZE, SNAPSHOT_PAGE_SIZE * 2])
  })

  it('到窗口上限后不再向后端请求', async () => {
    const tickets = manyTickets(SNAPSHOT_MAX_WINDOW)
    const { service, snapshotCalls } = serviceWith([
      snapshot({
        tickets,
        loaded: SNAPSHOT_MAX_WINDOW,
        total: 3000,
        windowLimit: SNAPSHOT_MAX_WINDOW,
      }),
    ])

    expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))
    const more = expectOk(await service.handle('snapshot.more', { workspaceRoot: ROOT }))

    expect(more.loaded).toBe(SNAPSHOT_MAX_WINDOW)
    expect(more.total).toBe(3000)
    expect(snapshotCalls).toHaveLength(1)
  })

  it('加载更多失败时保留现有列表，重试后窗口继续扩大', async () => {
    const tickets = manyTickets(250)
    const { service } = serviceWith([
      snapshot({ tickets: tickets.slice(0, 100), loaded: 100, total: 250, windowLimit: 100 }),
      new TrackerError('fetch-failed', '读取超时'),
      snapshot({ tickets: tickets.slice(0, 200), loaded: 200, total: 250, windowLimit: 200 }),
    ])

    expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))
    const failed = await service.handle('snapshot.more', { workspaceRoot: ROOT })
    expect(failed.ok).toBe(false)

    const kept = expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))
    expect(kept.loaded).toBe(100)
    expect(kept.windowLimit).toBe(100)

    const retried = expectOk(await service.handle('snapshot.more', { workspaceRoot: ROOT }))
    expect(retried.loaded).toBe(200)
  })

  it('全量刷新保留当前窗口，不缩回首屏', async () => {
    const tickets = manyTickets(250)
    const { service, snapshotWindows } = serviceWith([
      snapshot({ tickets: tickets.slice(0, 100), loaded: 100, total: 250, windowLimit: 100 }),
      snapshot({ tickets: tickets.slice(0, 200), loaded: 200, total: 250, windowLimit: 200 }),
      snapshot({ tickets: tickets.slice(0, 200), loaded: 200, total: 250, windowLimit: 200 }),
    ])

    expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))
    expectOk(await service.handle('snapshot.more', { workspaceRoot: ROOT }))
    expectOk(await service.handle('snapshot.refresh', { workspaceRoot: ROOT, full: true }))

    expect(snapshotWindows).toEqual([100, 200, 200])
  })

  it('后到的较小结果不会把已加载的票丢掉', async () => {
    const tickets = manyTickets(250)
    const { service } = serviceWith([
      snapshot({ tickets: tickets.slice(0, 100), loaded: 100, total: 250, windowLimit: 100 }),
      snapshot({ tickets: tickets.slice(0, 200), loaded: 200, total: 250, windowLimit: 200 }),
      snapshot({ tickets: tickets.slice(0, 50), loaded: 50, total: 250, windowLimit: 100 }),
    ])

    expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))
    expectOk(await service.handle('snapshot.more', { workspaceRoot: ROOT }))
    const third = expectOk(await service.handle('snapshot.more', { workspaceRoot: ROOT }))

    expect(third.loaded).toBe(200)
    expect(new Set(third.tickets.map((item) => item.ref)).size).toBe(200)
  })

  it('旧快照没有窗口字段时按首屏一页处理', async () => {
    const store = memoryStore([storedEntry()])
    const { service } = serviceWith([snapshot()], 'github', undefined, { store })

    const result = expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))

    expect(result.windowLimit).toBe(SNAPSHOT_PAGE_SIZE)
    expect(result.loaded).toBe(4)
    expect(result.total).toBe(30)
  })

  it('重开面板沿用库里的窗口', async () => {
    const tickets = manyTickets(200)
    const store = memoryStore([storedEntry({ loaded: 200, total: 250, windowLimit: 200, tickets })])
    const { service } = serviceWith([snapshot()], 'github', undefined, { store })

    const result = expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))

    expect(result.windowLimit).toBe(200)
    expect(result.loaded).toBe(200)
    expect(result.total).toBe(250)
  })
})
