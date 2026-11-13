import { describe, expect, it } from 'vitest'

import type { BlockerResolution } from '../core/ticket.ts'
import { TrackerError, type TrackerErrorCode } from '../core/tracker-error.ts'
import { TRACKER_LABELS } from '../protocol/labels.ts'
import { LOG_EVENTS } from '../protocol/log-events.ts'
import { ERROR_CODES, SNAPSHOT_CLEAR_CONFIRMATION } from '../protocol/tracker.ts'
import { createSnapshotService } from './snapshot-service.ts'
import {
  AUTHOR,
  ROOT,
  expectOk,
  memoryStore,
  resolution,
  serviceWith,
  snapshot,
  storedEntry,
  ticket,
} from './snapshot-service-test-support.ts'

describe('快照服务', () => {
  it('返回仓库标识、计数与每张票的判定结果', async () => {
    const { service } = serviceWith([snapshot()])

    const result = expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))

    expect(result.backend).toBe('github')
    expect(result.repository).toBe('cnzgray/dsh-mattpocock-workflow')
    expect(result.fetchedAt).toBe(1_000)
    expect(result.loaded).toBe(4)
    expect(result.total).toBe(30)
    expect(
      result.tickets.map((item) => [
        item.ref,
        item.number,
        item.category,
        item.status,
        item.skillAction,
        item.skillActionReason,
      ]),
    ).toEqual([
      ['#1', 1, 'enhancement', 'ready', 'implement', 'ready-for-agent'],
      ['#2', 2, 'enhancement', 'blocked', 'none', 'blocked'],
      ['#3', 3, 'bug', 'closed', 'none', 'closed'],
      ['#4', 4, null, 'open', 'triage', 'needs-triage'],
    ])
    // 全部标签与创建人逐字段透传，宿主不再判定。
    expect(result.tickets[0]?.labels).toEqual(['enhancement', 'ready-for-agent'])
    expect(result.tickets[0]?.author).toEqual(AUTHOR)
  })

  it('本地 Markdown 快照保留 backend、ref 与空编号', async () => {
    const { service } = serviceWith(
      [
        snapshot({
          repository: 'my-workspace',
          tickets: [
            ticket({
              ref: '.scratch/login/issues/01-token.md',
              number: null,
              title: '令牌刷新',
              labels: ['ready-for-agent'],
            }),
          ],
        }),
      ],
      'markdown',
    )

    const result = expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))

    expect(result.backend).toBe('markdown')
    expect(result.repository).toBe('my-workspace')
    expect(result.tickets[0]).toMatchObject({
      ref: '.scratch/login/issues/01-token.md',
      number: null,
      status: 'ready',
    })
  })

  it('snapshot.get 命中缓存后不再拉取', async () => {
    const { service, calls } = serviceWith([snapshot()])

    await service.handle('snapshot.get', { workspaceRoot: ROOT })
    await service.handle('snapshot.get', { workspaceRoot: ROOT })

    expect(calls).toEqual([ROOT])
  })

  it('snapshot.refresh 忽略缓存并更新快照', async () => {
    const { service, calls } = serviceWith([
      snapshot({ fetchedAt: 1_000, total: 30 }),
      snapshot({ fetchedAt: 2_000, total: 31 }),
    ])

    await service.handle('snapshot.get', { workspaceRoot: ROOT })
    const refreshed = expectOk(await service.handle('snapshot.refresh', { workspaceRoot: ROOT }))

    expect(calls).toHaveLength(2)
    expect(refreshed.fetchedAt).toBe(2_000)
    expect(refreshed.total).toBe(31)
  })

  it('刷新失败时保留上一次快照，并标出失败原因', async () => {
    const { service, calls } = serviceWith([
      snapshot({ fetchedAt: 1_000 }),
      new TrackerError('fetch-failed', '网络抖动'),
    ])

    const first = expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))
    const failed = expectOk(await service.handle('snapshot.refresh', { workspaceRoot: ROOT }))
    const again = expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))

    expect(again.tickets).toEqual(first.tickets)
    expect(again.stale).toBe(true)
    expect(again.refreshError).toEqual({ code: 'fetch-failed', message: '网络抖动' })
    expect(failed.stale).toBe(true)
    expect(failed.refreshError).toEqual({ code: 'fetch-failed', message: '网络抖动' })
    expect(calls).toHaveLength(2)
  })

  it('每次实际拉取都记一条日志，包含耗时和结果', async () => {
    const { service, logs } = serviceWith([snapshot(), new TrackerError('fetch-failed', '失败')])

    await service.handle('snapshot.get', { workspaceRoot: ROOT })
    await service.handle('snapshot.refresh', { workspaceRoot: ROOT })

    expect(logs).toEqual([
      {
        level: 'info',
        event: LOG_EVENTS.snapshot,
        fields: {
          result: 'ok',
          backend: 'github',
          stage: 'list',
          durationMs: 25,
          repository: 'cnzgray/dsh-mattpocock-workflow',
          loaded: 4,
          total: 30,
          mode: 'full',
        },
      },
      {
        level: 'warn',
        event: LOG_EVENTS.snapshot,
        fields: {
          result: 'error',
          backend: 'github',
          stage: 'list',
          code: 'fetch-failed',
          durationMs: 25,
        },
      },
    ])
  })

  it.each([
    'gh-missing',
    'gh-unauthenticated',
    'glab-missing',
    'glab-unauthenticated',
    'markdown-read-failed',
    'fetch-failed',
  ] satisfies readonly TrackerErrorCode[])('把 %s 原样映射到响应错误码', async (code) => {
    const { service } = serviceWith([new TrackerError(code, '业务失败')])

    const result = await service.handle('snapshot.get', { workspaceRoot: ROOT })

    expect(result).toEqual({
      ok: false,
      error: { code, message: '业务失败' },
    })
  })

  it('解析成功后拉取失败时，日志仍带上后端类型', async () => {
    const logs: { level: string; event: string; fields: Record<string, unknown> }[] = []
    let clock = 1_000
    const service = createSnapshotService({
      resolve: () =>
        Promise.resolve({
          kind: 'gitlab',
          host: 'gitlab.com',
          tracker: {
            fetchSnapshot: () => Promise.reject(new TrackerError('fetch-failed', '超时')),
          },
          choice: { kind: 'gitlab', source: 'remote' },
          address: undefined,
        }),
      now: () => {
        clock += 25
        return clock
      },
      labels: TRACKER_LABELS,
      log: (level, event, fields) => {
        logs.push({ level, event, fields: { ...fields } })
      },
    })

    await service.handle('snapshot.get', { workspaceRoot: ROOT })

    expect(logs).toEqual([
      {
        level: 'warn',
        event: LOG_EVENTS.snapshot,
        fields: {
          result: 'error',
          backend: 'gitlab',
          stage: 'list',
          code: 'fetch-failed',
          durationMs: 25,
        },
      },
    ])
  })

  it('未知异常映射成 internal，不把内部细节带出去', async () => {
    const { service } = serviceWith([new Error('boom')])

    const result = await service.handle('snapshot.get', { workspaceRoot: ROOT })

    expect(result).toEqual({
      ok: false,
      error: { code: ERROR_CODES.internal, message: '读取工单时发生未预期的错误。' },
    })
  })

  it('未知方法返回 unknown-method', async () => {
    const { service, calls } = serviceWith([])

    const result = await service.handle('snapshot.delete', { workspaceRoot: ROOT })

    expect(result).toEqual({
      ok: false,
      error: { code: ERROR_CODES.unknownMethod, message: '未知方法：snapshot.delete' },
    })
    expect(calls).toEqual([])
  })

  it.each([undefined, null, {}, { workspaceRoot: '' }, { workspaceRoot: 42 }])(
    '缺少合法 workspaceRoot 时返回 invalid-params',
    async (params) => {
      const { service, calls } = serviceWith([])

      const result = await service.handle('snapshot.get', params)

      expect(result).toEqual({
        ok: false,
        error: { code: ERROR_CODES.invalidParams, message: '缺少非空的 workspaceRoot 参数。' },
      })
      expect(calls).toEqual([])
    },
  )
})

describe('阻塞补齐', () => {
  it('有补齐能力的后端首屏未定稿，且不发补齐请求', async () => {
    const { service, blockerCalls } = serviceWith([snapshot()], 'gitlab', () =>
      Promise.resolve(resolution()),
    )

    const result = expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))

    expect(result.blockersFinalized).toBe(false)
    expect(blockerCalls).toEqual([])
  })

  it('没有补齐能力的后端首屏即定稿', async () => {
    const { service, blockerCalls } = serviceWith([snapshot()])

    const result = expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))

    expect(result.blockersFinalized).toBe(true)
    expect(blockerCalls).toEqual([])
  })

  it('补齐只请求开放票，原生计数优先，并重新判定', async () => {
    const { service, blockerCalls } = serviceWith([snapshot()], 'gitlab', () =>
      Promise.resolve(
        resolution(
          new Map([
            ['#1', 1],
            ['#2', 0],
            ['#4', 3],
          ]),
        ),
      ),
    )

    await service.handle('snapshot.get', { workspaceRoot: ROOT })
    const finalized = expectOk(
      await service.handle('snapshot.resolveBlockers', { workspaceRoot: ROOT }),
    )

    expect(blockerCalls).toEqual([
      [
        { ref: '#1', number: 1 },
        { ref: '#2', number: 2 },
        { ref: '#4', number: 4 },
      ],
    ])
    expect(finalized.blockersFinalized).toBe(true)
    expect(finalized.tickets.map((item) => [item.ref, item.openBlockers, item.status])).toEqual([
      ['#1', 1, 'blocked'],
      ['#2', 1, 'blocked'],
      ['#3', 2, 'closed'],
      ['#4', 3, 'blocked'],
    ])
  })

  it('没有缓存时先拉列表再补齐，定稿后直接返回缓存', async () => {
    const { service, calls, blockerCalls } = serviceWith([snapshot()], 'gitlab', () =>
      Promise.resolve(resolution(new Map([['#1', 1]]))),
    )

    const first = expectOk(
      await service.handle('snapshot.resolveBlockers', { workspaceRoot: ROOT }),
    )
    const again = expectOk(
      await service.handle('snapshot.resolveBlockers', { workspaceRoot: ROOT }),
    )

    expect(first.blockersFinalized).toBe(true)
    expect(again).toEqual(first)
    expect(calls).toEqual([ROOT])
    expect(blockerCalls).toHaveLength(1)
  })

  it('并发补齐共享同一次后端请求', async () => {
    const pending = Promise.withResolvers<BlockerResolution>()
    const { service, blockerCalls } = serviceWith([snapshot()], 'gitlab', () => pending.promise)
    await service.handle('snapshot.get', { workspaceRoot: ROOT })

    const first = service.handle('snapshot.resolveBlockers', { workspaceRoot: ROOT })
    const second = service.handle('snapshot.resolveBlockers', { workspaceRoot: ROOT })
    pending.resolve(resolution(new Map([['#1', 1]])))
    const [a, b] = await Promise.all([first, second])

    expect(blockerCalls).toHaveLength(1)
    expect(a).toEqual(b)
    expect(a.ok && a.result.blockersFinalized).toBe(true)
  })

  it('补齐失败保留阶段一快照，只记警告日志', async () => {
    const { service, logs } = serviceWith([snapshot()], 'gitlab', () =>
      Promise.reject(new TrackerError('fetch-failed', '网络抖动')),
    )

    const phaseOne = expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))
    const finalized = expectOk(
      await service.handle('snapshot.resolveBlockers', { workspaceRoot: ROOT }),
    )

    expect(finalized.blockersFinalized).toBe(true)
    expect(finalized.tickets).toEqual(phaseOne.tickets)
    expect(logs.at(-1)).toEqual({
      level: 'warn',
      event: LOG_EVENTS.snapshot,
      fields: {
        result: 'error',
        backend: 'gitlab',
        stage: 'blockers',
        code: 'fetch-failed',
        durationMs: 25,
      },
    })
  })

  it('补齐失败后刷新会重新尝试', async () => {
    let attempt = 0
    const { service } = serviceWith(
      [snapshot({ fetchedAt: 1_000 }), snapshot({ fetchedAt: 2_000 })],
      'gitlab',
      () => {
        attempt += 1
        return attempt === 1
          ? Promise.reject(new TrackerError('fetch-failed', '网络抖动'))
          : Promise.resolve(resolution(new Map([['#1', 1]])))
      },
    )

    await service.handle('snapshot.get', { workspaceRoot: ROOT })
    const failed = expectOk(
      await service.handle('snapshot.resolveBlockers', { workspaceRoot: ROOT }),
    )
    const refreshed = expectOk(await service.handle('snapshot.refresh', { workspaceRoot: ROOT }))
    const retried = expectOk(
      await service.handle('snapshot.resolveBlockers', { workspaceRoot: ROOT }),
    )

    expect(failed.blockersFinalized).toBe(true)
    expect(refreshed.blockersFinalized).toBe(false)
    expect(retried.tickets[0]).toMatchObject({ ref: '#1', openBlockers: 1, status: 'blocked' })
  })

  it('刷新后旧的补齐结果仍返回给旧调用方，但不覆盖新快照', async () => {
    const pending = Promise.withResolvers<BlockerResolution>()
    const { service } = serviceWith(
      [snapshot({ fetchedAt: 1_000, total: 30 }), snapshot({ fetchedAt: 2_000, total: 31 })],
      'gitlab',
      () => pending.promise,
    )

    await service.handle('snapshot.get', { workspaceRoot: ROOT })
    const resolving = service.handle('snapshot.resolveBlockers', { workspaceRoot: ROOT })
    const refreshed = expectOk(await service.handle('snapshot.refresh', { workspaceRoot: ROOT }))
    pending.resolve(resolution(new Map([['#1', 1]])))
    const resolved = expectOk(await resolving)

    expect(resolved).toMatchObject({ fetchedAt: 1_000, total: 30, blockersFinalized: true })
    expect(resolved.tickets[0]).toMatchObject({ ref: '#1', openBlockers: 1, status: 'blocked' })
    const cached = expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))
    expect(cached).toEqual(refreshed)
    expect(cached).toMatchObject({ fetchedAt: 2_000, blockersFinalized: false })
  })

  it('冷启动时并发的 snapshot.get 共享同一次列表拉取', async () => {
    const { service, calls } = serviceWith([snapshot()])

    const [first, second] = await Promise.all([
      service.handle('snapshot.get', { workspaceRoot: ROOT }),
      service.handle('snapshot.get', { workspaceRoot: ROOT }),
    ])

    expect(first).toEqual(second)
    expect(calls).toEqual([ROOT])
  })

  it('冷启动时并发的补齐请求只拉一次列表、只发一轮补齐', async () => {
    const pending = Promise.withResolvers<BlockerResolution>()
    const { service, calls, blockerCalls } = serviceWith(
      [snapshot()],
      'gitlab',
      () => pending.promise,
    )

    const first = service.handle('snapshot.resolveBlockers', { workspaceRoot: ROOT })
    const second = service.handle('snapshot.resolveBlockers', { workspaceRoot: ROOT })
    pending.resolve(resolution(new Map([['#1', 1]])))
    const [a, b] = await Promise.all([first, second])

    expect(calls).toEqual([ROOT])
    expect(blockerCalls).toHaveLength(1)
    expect(a).toEqual(b)
  })

  it('补齐日志记录独立于列表的耗时', async () => {
    const { service, logs } = serviceWith([snapshot()], 'gitlab', () =>
      Promise.resolve(resolution()),
    )

    await service.handle('snapshot.get', { workspaceRoot: ROOT })
    await service.handle('snapshot.resolveBlockers', { workspaceRoot: ROOT })

    expect(logs.map((entry) => entry.fields.stage)).toEqual(['list', 'blockers'])
    expect(logs[1]).toEqual({
      level: 'info',
      event: LOG_EVENTS.snapshot,
      fields: { result: 'ok', backend: 'gitlab', stage: 'blockers', durationMs: 25 },
    })
  })
})

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

  it('刷新时走增量，把变更合并进缓存', async () => {
    const store = memoryStore([storedEntry()])
    const { service, changeCalls, snapshotCalls } = serviceWith([snapshot()], 'github', undefined, {
      store,
      changes: () =>
        Promise.resolve({
          tickets: [ticket({ number: 2, title: '改过的票', updatedAt: '2026-02-01T00:00:00Z' })],
          truncated: false,
        }),
    })

    const result = expectOk(await service.handle('snapshot.refresh', { workspaceRoot: ROOT }))

    expect(changeCalls).toHaveLength(1)
    expect(snapshotCalls).toHaveLength(0)
    expect(result.source).toBe('live')
    expect(result.stale).toBe(false)
    expect(result.tickets.find((item) => item.ref === '#2')?.title).toBe('改过的票')
  })

  it('增量窗口从上次成功拉取的时刻向前重叠一小段', async () => {
    const store = memoryStore([storedEntry({ fetchedAt: 5_000 })])
    const { service, changeCalls } = serviceWith([snapshot()], 'github', undefined, {
      store,
      changes: () => Promise.resolve({ tickets: [], truncated: false }),
    })

    await service.handle('snapshot.refresh', { workspaceRoot: ROOT })

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
        fetchedAt: 1_000,
        loaded: 1,
        total: 2,
        tickets: [ticket({ number: 1, title: '旧的票', updatedAt: '2026-01-01T00:00:00Z' })],
      }),
    ])
    const { service } = serviceWith([full], 'github', undefined, {
      store,
      changes: () =>
        Promise.resolve({
          tickets: [ticket({ number: 2, title: '新的票', updatedAt: '2026-02-01T00:00:00Z' })],
          truncated: false,
        }),
    })

    const merged = expectOk(await service.handle('snapshot.refresh', { workspaceRoot: ROOT }))
    const reloaded = expectOk(
      await service.handle('snapshot.refresh', { workspaceRoot: ROOT, full: true }),
    )

    expect(merged.tickets.map((item) => item.ref).sort()).toEqual(
      reloaded.tickets.map((item) => item.ref).sort(),
    )
  })

  it('增量被截断时退回全量重拉', async () => {
    const store = memoryStore([storedEntry()])
    const { service, snapshotCalls } = serviceWith([snapshot()], 'github', undefined, {
      store,
      changes: () => Promise.resolve({ tickets: [], truncated: true }),
    })

    const result = expectOk(await service.handle('snapshot.refresh', { workspaceRoot: ROOT }))

    expect(snapshotCalls).toHaveLength(1)
    expect(result.source).toBe('live')
  })

  it('刷新失败时保留旧数据并带上失败原因', async () => {
    const store = memoryStore([storedEntry()])
    const { service } = serviceWith([snapshot()], 'github', undefined, {
      store,
      changes: () => Promise.reject(new TrackerError('fetch-failed', '远端连不上。')),
    })

    const result = expectOk(await service.handle('snapshot.refresh', { workspaceRoot: ROOT }))

    expect(result.stale).toBe(true)
    expect(result.refreshError?.code).toBe('fetch-failed')
    expect(result.tickets).toHaveLength(4)
  })

  it('全量刷新忽略本地快照库', async () => {
    const store = memoryStore([storedEntry()])
    const { service, snapshotCalls, changeCalls } = serviceWith([snapshot()], 'github', undefined, {
      store,
      changes: () => Promise.resolve({ tickets: [], truncated: false }),
    })

    await service.handle('snapshot.refresh', { workspaceRoot: ROOT, full: true })

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
