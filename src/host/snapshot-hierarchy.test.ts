/**
 * 宿主把父子能力与父级引用随快照透传、缓存与增量合并。
 * 这里只断言外部行为：界面拿到的快照、缓存内容与增量退让日志。
 */
import { describe, expect, it } from 'vitest'

import { LOG_EVENTS } from '../protocol/log-events.ts'
import {
  ROOT,
  expectOk,
  memoryStore,
  resolution,
  serviceWith,
  snapshot,
  storedEntry,
  ticket,
} from './snapshot-service-test-support.ts'

describe('快照里的父子关系', () => {
  it('父子能力与父级引用随快照返回给界面', async () => {
    const tickets = [ticket({ number: 1 }), ticket({ number: 2, parent: '#1' })]
    const { service } = serviceWith([
      snapshot({ hierarchy: 'native', tickets, loaded: tickets.length, total: tickets.length }),
    ])

    const result = expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))

    expect(result.hierarchy).toBe('native')
    expect(result.tickets.find((item) => item.ref === '#2')?.parent).toBe('#1')
  })

  it('缓存首屏直接带父子数据', async () => {
    const tickets = [ticket({ number: 1 }), ticket({ number: 2, parent: '#1' })]
    const store = memoryStore([
      storedEntry({
        hierarchy: 'convention',
        tickets,
        loaded: tickets.length,
        total: tickets.length,
      }),
    ])
    const { service, snapshotCalls } = serviceWith([snapshot()], 'github', undefined, { store })

    const result = expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))

    expect(result.source).toBe('cache')
    expect(result.hierarchy).toBe('convention')
    expect(result.tickets.find((item) => item.ref === '#2')?.parent).toBe('#1')
    expect(snapshotCalls).toHaveLength(0)
  })

  it('增量与库的父子能力不一致时退回全量重拉', async () => {
    const store = memoryStore([storedEntry({ hierarchy: 'native' })])
    const { service, snapshotCalls, logs } = serviceWith([snapshot()], 'github', undefined, {
      store,
      changes: () =>
        Promise.resolve({
          tickets: [ticket({ number: 2 })],
          hierarchy: 'none',
          truncated: false,
          total: 30,
        }),
    })

    const result = expectOk(await service.handle('snapshot.refresh', { workspaceRoot: ROOT }))

    expect(snapshotCalls).toHaveLength(1)
    expect(result.hierarchy).toBe('native')
    expect(
      logs.some(
        (entry) => entry.event === LOG_EVENTS.snapshot && entry.fields.reason === 'hierarchy',
      ),
    ).toBe(true)
  })

  it('增量层级一致时保留未变更票的父级引用', async () => {
    const baseTickets = [
      ticket({ number: 1, parent: '#9' }),
      ticket({ number: 2 }),
      ticket({ number: 3 }),
      ticket({ number: 4 }),
    ]
    const store = memoryStore([
      storedEntry({ hierarchy: 'native', tickets: baseTickets, loaded: 4, total: 30 }),
    ])
    const { service } = serviceWith([snapshot()], 'github', undefined, {
      store,
      changes: () =>
        Promise.resolve({
          tickets: [ticket({ number: 2, parent: '#1', updatedAt: '2026-02-01T00:00:00Z' })],
          hierarchy: 'native',
          truncated: false,
          total: 30,
        }),
    })

    const result = expectOk(await service.handle('snapshot.refresh', { workspaceRoot: ROOT }))

    expect(result.tickets.find((item) => item.ref === '#1')?.parent).toBe('#9')
    expect(result.tickets.find((item) => item.ref === '#2')?.parent).toBe('#1')
  })

  it('全量也取不到层级时快照标为无能力，列表仍然成功', async () => {
    const { service } = serviceWith([snapshot({ hierarchy: 'none' })])

    const result = expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))

    expect(result.hierarchy).toBe('none')
    expect(result.tickets).toHaveLength(4)
  })

  it('阻塞补齐重建快照后父子字段仍在', async () => {
    const tickets = [ticket({ number: 1, parent: '#9' }), ticket({ number: 2 })]
    const { service } = serviceWith(
      [snapshot({ hierarchy: 'native', tickets, loaded: 2, total: 2 })],
      'gitlab',
      () => Promise.resolve(resolution()),
    )

    await service.handle('snapshot.get', { workspaceRoot: ROOT })
    const finalized = expectOk(
      await service.handle('snapshot.resolveBlockers', { workspaceRoot: ROOT }),
    )

    expect(finalized.hierarchy).toBe('native')
    expect(finalized.tickets.find((item) => item.ref === '#1')?.parent).toBe('#9')
  })

  it('加载更多重建快照后父子字段仍在', async () => {
    const first = snapshot({
      tickets: [ticket({ number: 1 }), ticket({ number: 2 })],
      loaded: 2,
      total: 200,
      windowLimit: 100,
    })
    const second = snapshot({
      tickets: [ticket({ number: 1 }), ticket({ number: 2 }), ticket({ number: 3, parent: '#1' })],
      loaded: 3,
      total: 200,
      windowLimit: 200,
    })
    const { service } = serviceWith([first, second])

    await service.handle('snapshot.get', { workspaceRoot: ROOT })
    const more = expectOk(await service.handle('snapshot.more', { workspaceRoot: ROOT }))

    expect(more.hierarchy).toBe('native')
    expect(more.tickets.find((item) => item.ref === '#3')?.parent).toBe('#1')
  })
})
