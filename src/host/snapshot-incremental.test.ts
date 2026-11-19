import { describe, expect, it } from 'vitest'

import { TrackerError } from '../core/tracker-error.ts'
import { SNAPSHOT_CHANGELOG_LIMIT } from '../adapters/fs/snapshot-store.ts'
import { SNAPSHOT_CLEAR_CONFIRMATION, SNAPSHOT_DELTA_MAX_ROWS } from '../protocol/tracker.ts'
import {
  ROOT,
  expectFull,
  expectOk,
  memoryStore,
  serviceWith,
  snapshot,
  storedEntry,
  ticket,
  TICKETS,
} from './snapshot-service-test-support.ts'

describe('本地快照库与增量刷新', () => {
  it('库里有数据时先返回缓存，不发远端列表请求', async () => {
    const store = memoryStore([storedEntry()])
    const { service, snapshotCalls } = serviceWith([snapshot()], 'github', undefined, { store })

    const result = expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))

    expect(result.source).toBe('cache')
    expect(result.stale).toBe(true)
    expect(result.refreshError).toBeNull()
    expect(result.tickets.map((item) => item.ref)).toEqual(['#1', '#2', '#3', '#4'])
    expect(snapshotCalls).toHaveLength(0)
  })

  it('库里的计数不自洽时作废并全量拉取', async () => {
    const store = memoryStore([
      storedEntry({
        backend: 'gitea',
        repositoryKey: 'gitea@github.com/cnzgray/repo',
        loaded: 3,
        total: 2,
        tickets: [ticket({ number: 1 }), ticket({ number: 2 }), ticket({ number: 3 })],
      }),
    ])
    const { service, snapshotCalls } = serviceWith(
      [snapshot({ tickets: [ticket({ number: 1 }), ticket({ number: 3 })], loaded: 2, total: 2 })],
      'gitea',
      undefined,
      { store },
    )

    const result = expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))

    // 已加载数不可能大于后端总数：这份库不可能是对的，直接重拉。
    expect(store.removed).toEqual([ROOT])
    expect(snapshotCalls).toHaveLength(1)
    expect(result.loaded).toBeLessThanOrEqual(result.total)
  })

  it('刷新时走增量，把变更合并进缓存', async () => {
    const store = memoryStore([
      storedEntry({ backend: 'gitea', repositoryKey: 'gitea@github.com/cnzgray/repo' }),
    ])
    const { service, changeCalls, snapshotCalls } = serviceWith([snapshot()], 'gitea', undefined, {
      store,
      changes: () =>
        Promise.resolve({
          tickets: [ticket({ number: 2, title: '改过的票', updatedAt: '2026-02-01T00:00:00Z' })],
          hierarchy: 'native',
          truncated: false,
          total: 30,
        }),
    })

    const result = expectFull(await service.refresh({ workspaceRoot: ROOT }))

    expect(changeCalls).toHaveLength(1)
    expect(snapshotCalls).toHaveLength(0)
    expect(result.source).toBe('live')
    expect(result.stale).toBe(false)
    expect(result.tickets.find((item) => item.ref === '#2')?.title).toBe('改过的票')
  })

  it('拉取覆盖全仓时以无窗口身份落库，之后的刷新走增量', async () => {
    const store = memoryStore()
    // 首屏全量按窗口拉取（真实后端总会带上窗口），但已取数 ≥ 权威总数：覆盖全仓。
    const { service, changeCalls, snapshotCalls } = serviceWith(
      [
        snapshot({
          tickets: TICKETS,
          loaded: TICKETS.length,
          total: TICKETS.length,
          windowLimit: 100,
        }),
        snapshot(),
      ],
      'gitea',
      undefined,
      {
        store,
        changes: () =>
          Promise.resolve({
            tickets: [],
            hierarchy: 'native',
            truncated: false,
            total: TICKETS.length,
          }),
      },
    )

    const first = expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))
    expect(first.source).toBe('live')
    // 覆盖全仓：条目以「无窗口」身份落库，增量对账从此可用。
    expect(store.writes[0]?.windowLimit).toBeUndefined()

    const second = expectFull(await service.refresh({ workspaceRoot: ROOT }))
    expect(changeCalls).toHaveLength(1)
    // 全量只发生在首屏那一次；这次刷新走的是增量。
    expect(snapshotCalls).toHaveLength(1)
    expect(second.source).toBe('live')
  })

  it('拉取未覆盖全仓时维持带窗口身份，刷新仍按全量重拉', async () => {
    const store = memoryStore()
    // 后端总数 30，窗口只取回 4 张：窗口截断，窗口外删除不可见，不能走增量对账。
    const { service, changeCalls, snapshotCalls } = serviceWith(
      [snapshot({ windowLimit: 100 }), snapshot()],
      'gitea',
      undefined,
      {
        store,
        changes: () =>
          Promise.resolve({ tickets: [], hierarchy: 'native', truncated: false, total: 30 }),
      },
    )

    await service.handle('snapshot.get', { workspaceRoot: ROOT })
    expect(store.writes[0]?.windowLimit).toBe(100)

    await service.refresh({ workspaceRoot: ROOT })

    expect(changeCalls).toHaveLength(0)
    expect(snapshotCalls).toHaveLength(2)
  })

  it('覆盖全仓的基准走增量时不裁回窗口：扩窗后的刷新不丢票', async () => {
    // 300 张票已全量覆盖（无窗口身份）。增量合并不得把结果裁回首屏 100 张。
    const many = Array.from({ length: 300 }, (_, index) => ticket({ number: index + 1 }))
    const store = memoryStore([
      storedEntry({
        backend: 'gitea',
        repositoryKey: 'gitea@github.com/cnzgray/repo',
        tickets: many,
        loaded: many.length,
        total: many.length,
      }),
    ])
    const { service } = serviceWith([snapshot()], 'gitea', undefined, {
      store,
      changes: () =>
        Promise.resolve({
          tickets: [ticket({ number: 1, title: '改过的票', updatedAt: '2026-02-01T00:00:00Z' })],
          hierarchy: 'native',
          truncated: false,
          total: many.length,
        }),
    })

    const result = expectFull(await service.refresh({ workspaceRoot: ROOT }))

    expect(result.loaded).toBe(many.length)
    expect(result.tickets).toHaveLength(many.length)
    expect(result.tickets[0]?.title).toBe('改过的票')
    // 覆盖全仓的合并结果继续以无窗口身份落库。
    expect(store.writes.at(-1)?.windowLimit).toBeUndefined()
  })

  it('增量窗口从上次成功拉取的时刻向前重叠一小段', async () => {
    const store = memoryStore([
      storedEntry({
        backend: 'gitea',
        repositoryKey: 'gitea@github.com/cnzgray/repo',
        fetchedAt: 5_000,
      }),
    ])
    const { service, changeCalls } = serviceWith([snapshot()], 'gitea', undefined, {
      store,
      changes: () =>
        Promise.resolve({ tickets: [], hierarchy: 'native', truncated: false, total: 30 }),
    })

    await service.refresh({ workspaceRoot: ROOT })

    expect(changeCalls[0]?.since).toBe(5_000 - 60_000)
  })

  it('增量结果与全量重拉的票集合一致', async () => {
    const full = snapshot({
      tickets: [
        ticket({ number: 1, title: '旧的票', updatedAt: '2026-01-01T00:00:00Z' }),
        ticket({ number: 2, title: '新的票', updatedAt: '2026-02-01T00:00:00Z' }),
      ],
      loaded: 2,
      total: 2,
    })
    const store = memoryStore([
      storedEntry({
        backend: 'gitea',
        repositoryKey: 'gitea@github.com/cnzgray/repo',
        fetchedAt: 1_000,
        loaded: 1,
        total: 2,
        tickets: [ticket({ number: 1, title: '旧的票', updatedAt: '2026-01-01T00:00:00Z' })],
      }),
    ])
    const { service } = serviceWith([full], 'gitea', undefined, {
      store,
      changes: () =>
        Promise.resolve({
          tickets: [ticket({ number: 2, title: '新的票', updatedAt: '2026-02-01T00:00:00Z' })],
          hierarchy: 'native',
          truncated: false,
          total: 2,
        }),
    })

    const merged = expectFull(await service.refresh({ workspaceRoot: ROOT }))
    const reloaded = expectFull(await service.refresh({ workspaceRoot: ROOT, full: true }))

    expect(merged.tickets.map((item) => item.ref).sort()).toEqual(
      reloaded.tickets.map((item) => item.ref).sort(),
    )
  })

  it('远端删除的票在下一次刷新后从列表消失', async () => {
    const first = ticket({ number: 1, title: '还在的票' })
    const second = ticket({ number: 3, title: '另一张还在的票' })
    const kept = [first, second]
    const store = memoryStore([
      storedEntry({
        backend: 'gitea',
        repositoryKey: 'gitea@github.com/cnzgray/repo',
        loaded: 3,
        total: 3,
        tickets: [first, ticket({ number: 2, title: '远端已删除' }), second],
      }),
    ])
    const { service, snapshotCalls, logs } = serviceWith(
      [snapshot({ tickets: kept, loaded: 2, total: 2 })],
      'gitea',
      undefined,
      {
        store,
        // 删除不产生变更记录：增量里没有这张票，只能靠权威总数发现它已经不存在。
        changes: () =>
          Promise.resolve({ tickets: [], hierarchy: 'native', truncated: false, total: 2 }),
      },
    )

    const result = expectFull(await service.refresh({ workspaceRoot: ROOT }))

    expect(result.tickets.map((item) => item.ref).sort()).toEqual(['#1', '#3'])
    expect(result.loaded).toBe(2)
    expect(result.total).toBe(2)
    // 漂移检测当次退回全量，不发布不一致的增量结果，并记录这次退让。
    expect(snapshotCalls).toHaveLength(1)
    expect(
      logs.some(
        (entry) =>
          entry.level === 'warn' &&
          entry.fields.result === 'fallback' &&
          entry.fields.reason === 'drift',
      ),
    ).toBe(true)
  })

  it('增量被截断时退回全量重拉', async () => {
    const store = memoryStore([
      storedEntry({ backend: 'gitea', repositoryKey: 'gitea@github.com/cnzgray/repo' }),
    ])
    const { service, snapshotCalls } = serviceWith([snapshot()], 'gitea', undefined, {
      store,
      changes: () =>
        Promise.resolve({ tickets: [], hierarchy: 'native', truncated: true, total: 30 }),
    })

    const result = expectFull(await service.refresh({ workspaceRoot: ROOT }))

    expect(snapshotCalls).toHaveLength(1)
    expect(result.source).toBe('live')
  })

  it('权威总数不可用时退回全量，不发布也不写库', async () => {
    const store = memoryStore([
      storedEntry({
        backend: 'gitea',
        repositoryKey: 'gitea@github.com/cnzgray/repo',
        loaded: 4,
        total: 30,
      }),
    ])
    const full = snapshot({
      tickets: [ticket({ number: 1, title: '远端还在的票' })],
      loaded: 1,
      total: 1,
    })
    const { service, snapshotCalls } = serviceWith([full], 'gitea', undefined, {
      store,
      changes: () =>
        Promise.resolve({ tickets: [], hierarchy: 'native', truncated: false, total: Number.NaN }),
    })

    const result = expectFull(await service.refresh({ workspaceRoot: ROOT }))

    // 总数不可用时当次走全量，不沿用旧总数，也不写入增量结果。
    expect(snapshotCalls).toHaveLength(1)
    expect(result.tickets.map((item) => item.ref)).toEqual(['#1'])
    expect(result.loaded).toBe(1)
    expect(result.total).toBe(1)
    expect(store.writes).toHaveLength(1)
    expect(store.writes[0]?.total).toBe(1)
  })

  it('有窗口上限的缓存不走增量对账', async () => {
    const store = memoryStore([
      storedEntry({
        backend: 'gitea',
        repositoryKey: 'gitea@github.com/cnzgray/repo',
        windowLimit: 100,
      }),
    ])
    const { service, snapshotCalls, changeCalls } = serviceWith(
      [snapshot({ loaded: 4, total: 4 })],
      'gitea',
      undefined,
      {
        store,
        changes: () =>
          Promise.resolve({ tickets: [], hierarchy: 'native', truncated: false, total: 4 }),
      },
    )

    await service.refresh({ workspaceRoot: ROOT })

    // 窗口截断让总数对账失效：这类缓存只能全量重拉。
    expect(changeCalls).toHaveLength(0)
    expect(snapshotCalls).toHaveLength(1)
  })

  it('刷新失败时保留旧数据并带上失败原因', async () => {
    const store = memoryStore([storedEntry()])
    const { service } = serviceWith([snapshot()], 'github', undefined, {
      store,
      changes: () => Promise.reject(new TrackerError('fetch-failed', '远端连不上。')),
    })

    const result = expectFull(await service.refresh({ workspaceRoot: ROOT }))

    expect(result.stale).toBe(true)
    expect(result.refreshError?.code).toBe('fetch-failed')
    expect(result.tickets).toHaveLength(4)
  })

  it('全量刷新忽略本地快照库', async () => {
    const store = memoryStore([storedEntry()])
    const { service, snapshotCalls, changeCalls } = serviceWith([snapshot()], 'github', undefined, {
      store,
      changes: () =>
        Promise.resolve({ tickets: [], hierarchy: 'native', truncated: false, total: 30 }),
    })

    await service.refresh({ workspaceRoot: ROOT, full: true })

    expect(snapshotCalls).toHaveLength(1)
    expect(changeCalls).toHaveLength(0)
  })

  it('缓存属于别的仓库时作废并全量拉取', async () => {
    const store = memoryStore([storedEntry({ repositoryKey: 'github@github.com/other/repo' })])
    const { service, snapshotCalls } = serviceWith([snapshot(), snapshot()], 'github', undefined, {
      store,
    })

    const result = expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))

    expect(result.source).toBe('live')
    expect(snapshotCalls).toHaveLength(1)
    expect(store.removed).toEqual([ROOT])
  })

  it('拉取成功后写进本地快照库', async () => {
    const store = memoryStore()
    const { service } = serviceWith([snapshot()], 'github', undefined, { store })

    await service.handle('snapshot.get', { workspaceRoot: ROOT })

    expect(store.writes).toHaveLength(1)
    expect(store.writes[0]?.repositoryKey).toBe('github@github.com/cnzgray/repo')
  })

  it('读取本地快照库信息', async () => {
    const store = memoryStore([storedEntry({ fetchedAt: 2_000 })])
    const { service } = serviceWith([snapshot()], 'github', undefined, { store })

    const result = await service.cache({ workspaceRoot: ROOT })

    expect(result).toEqual({
      ok: true,
      result: {
        location: '~/.dsh/cache/dsh-mattpocock-workflow',
        entries: 1,
        lastWrittenAt: 2_000,
        cleared: 0,
      },
    })
  })

  it('带确认词清空本地快照库', async () => {
    const store = memoryStore([storedEntry()])
    const { service } = serviceWith([snapshot()], 'github', undefined, { store })

    const result = await service.cache({
      workspaceRoot: ROOT,
      clear: true,
      confirm: SNAPSHOT_CLEAR_CONFIRMATION,
    })

    expect(result.ok).toBe(true)
    expect(store.cleared).toBe(1)
    expect(store.entries.size).toBe(0)
  })

  it('缺确认词时拒绝清空本地快照库', async () => {
    const store = memoryStore([storedEntry()])
    const { service } = serviceWith([snapshot()], 'github', undefined, { store })

    const result = await service.cache({ workspaceRoot: ROOT, clear: true })

    expect(result.ok).toBe(false)
    expect(store.entries.size).toBe(1)
  })
})

describe('版本化刷新回包', () => {
  it('数据没变且版本一致时回 not-modified 极小响应，不写库', async () => {
    const store = memoryStore([
      storedEntry({ backend: 'gitea', repositoryKey: 'gitea@github.com/cnzgray/repo' }),
    ])
    const { service, changeCalls, snapshotCalls } = serviceWith([snapshot()], 'gitea', undefined, {
      store,
      changes: () =>
        Promise.resolve({ tickets: [], hierarchy: 'native', truncated: false, total: 30 }),
    })
    const before = store.writes.length

    const result = expectOk(await service.refresh({ workspaceRoot: ROOT, ifVersion: 1 }))

    expect(result).toMatchObject({ kind: 'not-modified', version: 1 })
    expect(store.writes.length).toBe(before)
    expect(changeCalls).toHaveLength(1)
    expect(snapshotCalls).toHaveLength(0)
  })

  it('数据变了时只回变化的行与墓碑，不带 ifVersion 时回整份', async () => {
    const store = memoryStore([
      storedEntry({ backend: 'gitea', repositoryKey: 'gitea@github.com/cnzgray/repo' }),
    ])
    const changed = ticket({ number: 2, title: '改过的票', updatedAt: '2026-02-01T00:00:00Z' })
    const { service } = serviceWith([snapshot()], 'gitea', undefined, {
      store,
      changes: () =>
        Promise.resolve({
          tickets: [changed],
          hierarchy: 'native',
          truncated: false,
          total: 30,
        }),
    })

    const delta = expectOk(await service.refresh({ workspaceRoot: ROOT, ifVersion: 1 }))

    expect(delta.kind).toBe('changes')
    if (delta.kind !== 'changes') throw new Error('预期变化行回包')
    expect(delta.version).toBe(2)
    expect(delta.tickets.map((item) => item.ref)).toEqual(['#2'])
    expect(delta.tickets[0]?.title).toBe('改过的票')
    expect(delta.removed).toEqual([])
    expect(delta.metrics).toEqual(store.entries.get(ROOT)?.metrics)
  })

  it('远端删的票以墓碑出现在变化行回包里', async () => {
    const first = ticket({ number: 1, title: '还在的票' })
    const second = ticket({ number: 3, title: '另一张还在的票' })
    const store = memoryStore([
      storedEntry({
        backend: 'gitea',
        repositoryKey: 'gitea@github.com/cnzgray/repo',
        loaded: 3,
        total: 3,
        tickets: [first, ticket({ number: 2, title: '远端已删除' }), second],
      }),
    ])
    const { service } = serviceWith(
      [snapshot({ tickets: [first, second], loaded: 2, total: 2 })],
      'gitea',
      undefined,
      {
        store,
        // 删除漂移：合并结果比权威总数多，退回全量后从变化日志收墓碑。
        changes: () =>
          Promise.resolve({ tickets: [], hierarchy: 'native', truncated: false, total: 2 }),
      },
    )

    const delta = expectOk(await service.refresh({ workspaceRoot: ROOT, ifVersion: 1 }))

    expect(delta.kind).toBe('changes')
    if (delta.kind !== 'changes') throw new Error('预期变化行回包')
    expect(delta.version).toBe(2)
    // #1、#3 内容没变不进变化行；客户端剔除墓碑引用后列表自然只剩它们。
    expect(delta.tickets).toEqual([])
    expect(delta.removed).toEqual(['#2'])
    expect(delta.total).toBe(2)
  })

  it('界面版本落后时从变化日志回净变化', async () => {
    // 覆盖全仓的小仓库：增量刷新持续可用，版本单调推进。
    const store = memoryStore([
      storedEntry({
        backend: 'gitea',
        repositoryKey: 'gitea@github.com/cnzgray/repo',
        total: TICKETS.length,
      }),
    ])
    const changed = ticket({ number: 2, title: '改过的票', updatedAt: '2026-02-01T00:00:00Z' })
    let round = 0
    const { service } = serviceWith([snapshot(), snapshot()], 'gitea', undefined, {
      store,
      changes: () => {
        round += 1
        // 第一轮把 #2 的改动写进库；第二轮远端没有新变化。
        return Promise.resolve({
          tickets: round === 1 ? [changed] : [],
          hierarchy: 'native',
          truncated: false,
          total: TICKETS.length,
        })
      },
    })
    await service.refresh({ workspaceRoot: ROOT })
    expect(store.entries.get(ROOT)?.libraryVersion).toBe(2)

    const result = expectOk(await service.refresh({ workspaceRoot: ROOT, ifVersion: 1 }))

    // 数据相对上一次拉取没变：按版本差从日志回净变化。
    expect(result.kind).toBe('changes')
    if (result.kind !== 'changes') throw new Error('预期变化行回包')
    expect(result.version).toBe(2)
    expect(result.tickets.map((item) => item.ref)).toEqual(['#2'])
  })

  it('变化日志轮转出覆盖范围后，版本落后的刷新回退整份', async () => {
    const store = memoryStore([
      storedEntry({ backend: 'gitea', repositoryKey: 'gitea@github.com/cnzgray/repo' }),
    ])
    // 推进日志越过保留上限：最早的起点读不到净变化。
    for (let index = 0; index < SNAPSHOT_CHANGELOG_LIMIT + 2; index += 1) {
      await store.write(
        storedEntry({
          backend: 'gitea',
          repositoryKey: 'gitea@github.com/cnzgray/repo',
          fetchedAt: 2_000 + index,
          tickets: [ticket({ number: index + 1, title: `票 ${String(index)}` })],
        }),
      )
    }
    const { service } = serviceWith([snapshot()], 'gitea', undefined, {
      store,
      changes: () =>
        Promise.resolve({ tickets: [], hierarchy: 'native', truncated: false, total: 30 }),
    })

    // 版本 1 落后日志覆盖：不增量回包，回退整份。
    const result = expectOk(await service.refresh({ workspaceRoot: ROOT, ifVersion: 1 }))
    expect(result.kind).toBe('full')
  })

  it('没带 ifVersion 的旧界面按整份快照回', async () => {
    const store = memoryStore([
      storedEntry({ backend: 'gitea', repositoryKey: 'gitea@github.com/cnzgray/repo' }),
    ])
    const { service } = serviceWith([snapshot()], 'gitea', undefined, {
      store,
      changes: () =>
        Promise.resolve({ tickets: [], hierarchy: 'native', truncated: false, total: 30 }),
    })

    const result = expectFull(await service.refresh({ workspaceRoot: ROOT }))

    expect(result.source).toBe('live')
    expect(result.libraryVersion).toBe(1)
  })

  it('变化行超过上限时回退整份快照', async () => {
    // 全量拉回的列表远大于库里的基准：净变化超上限，增量组装不再划算。
    const many = Array.from({ length: SNAPSHOT_DELTA_MAX_ROWS + 1 }, (_, index) =>
      ticket({ number: index + 1, title: `批量变更 ${String(index)}` }),
    )
    const store = memoryStore([storedEntry()])
    const { service } = serviceWith(
      [snapshot({ tickets: many, loaded: many.length, total: many.length })],
      'github',
      undefined,
      { store },
    )

    const result = expectOk(await service.refresh({ workspaceRoot: ROOT, ifVersion: 1 }))

    expect(result.kind).toBe('full')
  })
})
