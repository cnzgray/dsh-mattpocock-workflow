import { describe, expect, it } from 'vitest'

import type { Ticket, Tracker, TrackerSnapshot } from '../core/ticket.ts'
import { TrackerError, type TrackerErrorCode } from '../core/tracker-error.ts'
import { TRACKER_LABELS } from '../protocol/labels.ts'
import { LOG_EVENTS } from '../protocol/log-events.ts'
import { ERROR_CODES, type RpcResult, type WorkspaceSnapshot } from '../protocol/tracker.ts'
import { createSnapshotService, type SnapshotLog } from './snapshot-service.ts'

const ROOT = '/workspace'

function ticket(overrides: Partial<Ticket>): Ticket {
  return {
    number: 1,
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

interface FakeTracker {
  readonly tracker: Tracker
  readonly calls: string[]
}

function fakeTracker(responses: readonly (TrackerSnapshot | Error)[]): FakeTracker {
  const calls: string[] = []
  let index = 0
  const tracker: Tracker = {
    fetchSnapshot(workspaceRoot) {
      calls.push(workspaceRoot)
      const response = responses[index]
      index += 1
      if (response === undefined) return Promise.reject(new Error('没有更多响应'))
      if (response instanceof Error) return Promise.reject(response)
      return Promise.resolve(response)
    },
  }
  return { tracker, calls }
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

function serviceWith(responses: readonly (TrackerSnapshot | Error)[]): {
  readonly service: ReturnType<typeof createSnapshotService>
  readonly calls: string[]
  readonly logs: readonly { level: string; event: string; fields: Record<string, unknown> }[]
} {
  const { tracker, calls } = fakeTracker(responses)
  const logs: { level: string; event: string; fields: Record<string, unknown> }[] = []
  const log: SnapshotLog = (level, event, fields) => {
    logs.push({ level, event, fields: { ...fields } })
  }
  let clock = 1_000
  const service = createSnapshotService({
    tracker,
    now: () => {
      clock += 25
      return clock
    },
    labels: TRACKER_LABELS,
    log,
  })
  return { service, calls, logs }
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

    expect(result.repository).toBe('cnzgray/dsh-mattpocock-workflow')
    expect(result.fetchedAt).toBe(1_000)
    expect(result.loaded).toBe(4)
    expect(result.total).toBe(30)
    expect(result.tickets.map((item) => [item.number, item.category, item.status])).toEqual([
      [1, 'enhancement', 'ready'],
      [2, 'enhancement', 'blocked'],
      [3, 'bug', 'closed'],
      [4, null, 'open'],
    ])
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
          durationMs: 25,
          repository: 'cnzgray/dsh-mattpocock-workflow',
          loaded: 4,
          total: 30,
        },
      },
      {
        level: 'warn',
        event: LOG_EVENTS.snapshot,
        fields: { result: 'error', code: 'fetch-failed', durationMs: 25 },
      },
    ])
  })

  it.each([
    'gh-missing',
    'gh-unauthenticated',
    'not-a-repo',
    'no-github-remote',
    'fetch-failed',
  ] satisfies readonly TrackerErrorCode[])('把 %s 原样映射到响应错误码', async (code) => {
    const { service } = serviceWith([new TrackerError(code, '业务失败')])

    const result = await service.handle('snapshot.get', { workspaceRoot: ROOT })

    expect(result).toEqual({
      ok: false,
      error: { code, message: '业务失败' },
    })
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
