import { describe, expect, it } from 'vitest'

import type { BlockerTarget, Ticket, Tracker, TrackerSnapshot } from '../core/ticket.ts'
import { TrackerError, type TrackerErrorCode } from '../core/tracker-error.ts'
import { TRACKER_LABELS } from '../protocol/labels.ts'
import { LOG_EVENTS } from '../protocol/log-events.ts'
import type { BackendKind } from '../protocol/backend.ts'
import { ERROR_CODES, type RpcResult, type WorkspaceSnapshot } from '../protocol/tracker.ts'
import type { BackendResolver } from './backend-resolver.ts'
import type { LogSink } from './log.ts'
import { createSnapshotService, type SnapshotService } from './snapshot-service.ts'

const ROOT = '/workspace'

function ticket(overrides: Partial<Ticket>): Ticket {
  const number = overrides.number === undefined ? 1 : overrides.number
  return {
    ref: number === null ? '.scratch/feature/issues/01-ticket.md' : `#${String(number)}`,
    number,
    title: '一张票',
    state: 'open',
    labels: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    openBlockers: 0,
    ...overrides,
  }
}

const TICKETS: readonly Ticket[] = [
  ticket({ number: 1, title: '可接的票', labels: ['enhancement', 'ready-for-agent'] }),
  ticket({
    number: 2,
    title: '被阻塞的票',
    labels: ['enhancement', 'ready-for-agent'],
    openBlockers: 1,
  }),
  ticket({
    number: 3,
    title: '已关闭的票',
    state: 'closed',
    labels: ['bug', 'ready-for-agent'],
    openBlockers: 2,
  }),
  ticket({ number: 4, title: '其他开放的票', labels: ['needs-triage'] }),
]

interface FakeResolver {
  readonly resolve: BackendResolver
  readonly calls: string[]
  readonly blockerCalls: (readonly BlockerTarget[])[]
}

/** 假的阻塞补齐实现；抛错用来覆盖补齐失败。 */
type BlockerResolver = (tickets: readonly BlockerTarget[]) => Promise<ReadonlyMap<string, number>>

function fakeResolver(
  responses: readonly (TrackerSnapshot | Error)[],
  kind: BackendKind = 'github',
  resolveBlockers?: BlockerResolver,
): FakeResolver {
  const calls: string[] = []
  const blockerCalls: (readonly BlockerTarget[])[] = []
  let index = 0
  const resolve: BackendResolver = (workspaceRoot) => {
    calls.push(workspaceRoot)
    const response = responses[index]
    index += 1
    if (response === undefined) return Promise.reject(new Error('没有更多响应'))
    if (response instanceof Error) return Promise.reject(response)

    const tracker: Tracker = {
      fetchSnapshot: () => Promise.resolve(response),
      ...(resolveBlockers === undefined
        ? {}
        : {
            resolveBlockers: (_root: string, targets: readonly BlockerTarget[]) => {
              blockerCalls.push(targets)
              return resolveBlockers(targets)
            },
          }),
    }
    return Promise.resolve({
      kind,
      tracker,
      choice: { kind, source: kind === 'markdown' ? 'no-remote' : 'remote' },
      address: kind === 'markdown' ? undefined : { host: 'github.com', path: 'cnzgray/repo' },
    })
  }
  return { resolve, calls, blockerCalls }
}

function snapshot(overrides: Partial<TrackerSnapshot> = {}): TrackerSnapshot {
  return {
    repository: 'cnzgray/dsh-mattpocock-workflow',
    fetchedAt: 1_000,
    loaded: TICKETS.length,
    total: 30,
    tickets: TICKETS,
    ...overrides,
  }
}

function serviceWith(
  responses: readonly (TrackerSnapshot | Error)[],
  kind: BackendKind = 'github',
  resolveBlockers?: BlockerResolver,
): {
  readonly service: SnapshotService
  readonly calls: string[]
  readonly blockerCalls: (readonly BlockerTarget[])[]
  readonly logs: readonly { level: string; event: string; fields: Record<string, unknown> }[]
} {
  const { resolve, calls, blockerCalls } = fakeResolver(responses, kind, resolveBlockers)
  const logs: { level: string; event: string; fields: Record<string, unknown> }[] = []
  const log: LogSink = (level, event, fields) => {
    logs.push({ level, event, fields: { ...fields } })
  }
  let clock = 1_000
  const service = createSnapshotService({
    resolve,
    now: () => {
      clock += 25
      return clock
    },
    labels: TRACKER_LABELS,
    log,
  })
  return { service, calls, blockerCalls, logs }
}

function expectOk(result: RpcResult<WorkspaceSnapshot>): WorkspaceSnapshot {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error.message)
  return result.result
}

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

  it('刷新失败时保留上一次快照，后续读取仍命中缓存', async () => {
    const { service, calls } = serviceWith([
      snapshot({ fetchedAt: 1_000 }),
      new TrackerError('fetch-failed', '网络抖动'),
    ])

    const first = expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))
    const failed = await service.handle('snapshot.refresh', { workspaceRoot: ROOT })
    const again = expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))

    expect(first).toEqual(again)
    expect(failed).toEqual({
      ok: false,
      error: { code: 'fetch-failed', message: '网络抖动' },
    })
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
        },
      },
      {
        level: 'warn',
        event: LOG_EVENTS.snapshot,
        fields: { result: 'error', stage: 'list', code: 'fetch-failed', durationMs: 25 },
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
      Promise.resolve(new Map()),
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
        new Map([
          ['#1', 1],
          ['#2', 0],
          ['#4', 3],
        ]),
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
    expect(
      finalized.tickets.map((item) => [
        item.ref,
        item.openBlockers,
        item.status,
        item.skillAction,
        item.skillActionReason,
      ]),
    ).toEqual([
      ['#1', 1, 'blocked', 'none', 'blocked'],
      ['#2', 1, 'blocked', 'none', 'blocked'],
      ['#3', 2, 'closed', 'none', 'closed'],
      ['#4', 3, 'blocked', 'none', 'blocked'],
    ])
  })

  it('没有缓存时先拉列表再补齐，定稿后直接返回缓存', async () => {
    const { service, calls, blockerCalls } = serviceWith([snapshot()], 'gitlab', () =>
      Promise.resolve(new Map([['#1', 1]])),
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
    const pending = Promise.withResolvers<ReadonlyMap<string, number>>()
    const { service, blockerCalls } = serviceWith([snapshot()], 'gitlab', () => pending.promise)
    await service.handle('snapshot.get', { workspaceRoot: ROOT })

    const first = service.handle('snapshot.resolveBlockers', { workspaceRoot: ROOT })
    const second = service.handle('snapshot.resolveBlockers', { workspaceRoot: ROOT })
    pending.resolve(new Map([['#1', 1]]))
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
          : Promise.resolve(new Map([['#1', 1]]))
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
    const pending = Promise.withResolvers<ReadonlyMap<string, number>>()
    const { service } = serviceWith(
      [snapshot({ fetchedAt: 1_000, total: 30 }), snapshot({ fetchedAt: 2_000, total: 31 })],
      'gitlab',
      () => pending.promise,
    )

    await service.handle('snapshot.get', { workspaceRoot: ROOT })
    const resolving = service.handle('snapshot.resolveBlockers', { workspaceRoot: ROOT })
    const refreshed = expectOk(await service.handle('snapshot.refresh', { workspaceRoot: ROOT }))
    pending.resolve(new Map([['#1', 1]]))
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
    const pending = Promise.withResolvers<ReadonlyMap<string, number>>()
    const { service, calls, blockerCalls } = serviceWith(
      [snapshot()],
      'gitlab',
      () => pending.promise,
    )

    const first = service.handle('snapshot.resolveBlockers', { workspaceRoot: ROOT })
    const second = service.handle('snapshot.resolveBlockers', { workspaceRoot: ROOT })
    pending.resolve(new Map([['#1', 1]]))
    const [a, b] = await Promise.all([first, second])

    expect(calls).toEqual([ROOT])
    expect(blockerCalls).toHaveLength(1)
    expect(a).toEqual(b)
  })

  it('补齐日志记录独立于列表的耗时', async () => {
    const { service, logs } = serviceWith([snapshot()], 'gitlab', () => Promise.resolve(new Map()))

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
