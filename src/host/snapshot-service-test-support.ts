/**
 * 快照服务的测试夹具：假后端、假时钟、日志收集与常用断言。
 * 生产代码不导入这个文件；快照服务与指标测试共用，避免两套假实现分叉。
 */
import { expect } from 'vitest'

import type {
  BlockerResolution,
  Ticket,
  TicketReference,
  Tracker,
  TrackerSnapshot,
} from '../core/ticket.ts'
import { TRACKER_LABELS } from '../protocol/labels.ts'
import type { BackendKind } from '../protocol/backend.ts'
import type { RpcResult, WorkspaceSnapshot } from '../protocol/tracker.ts'
import type { BackendResolver } from './backend-resolver.ts'
import type { LogSink } from './log.ts'
import { createSnapshotService, type SnapshotService } from './snapshot-service.ts'

export const ROOT = '/workspace'

/** 远端后端的创建人夹具。 */
export const AUTHOR = {
  login: 'cnzgray',
  displayName: 'Cnzgray',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1234?v=4',
} as const

/**
 * 构造一张判定前的票。
 * @param overrides - 需要覆盖的字段。
 * @returns 一张票。
 */
export function ticket(overrides: Partial<Ticket>): Ticket {
  const number = overrides.number === undefined ? 1 : overrides.number
  return {
    ref: number === null ? '.scratch/feature/issues/01-ticket.md' : `#${String(number)}`,
    number,
    title: '一张票',
    state: 'open',
    labels: [],
    author: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    openBlockers: 0,
    ...overrides,
  }
}

/** 覆盖四种判定结果的工单：可接、阻塞、已关闭与其他开放。 */
export const TICKETS: readonly Ticket[] = [
  ticket({
    number: 1,
    title: '可接的票',
    labels: ['enhancement', 'ready-for-agent'],
    author: AUTHOR,
  }),
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

export interface FakeResolver {
  readonly resolve: BackendResolver
  readonly calls: string[]
  readonly blockerCalls: (readonly TicketReference[])[]
}

/** 假的阻塞补齐实现；抛错用来覆盖补齐失败。 */
export type BlockerResolver = (tickets: readonly TicketReference[]) => Promise<BlockerResolution>

export function fakeResolver(
  responses: readonly (TrackerSnapshot | Error)[],
  kind: BackendKind = 'github',
  resolveBlockers?: BlockerResolver,
): FakeResolver {
  const calls: string[] = []
  const blockerCalls: (readonly TicketReference[])[] = []
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
            resolveBlockers: (_root: string, targets: readonly TicketReference[]) => {
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

/**
 * 构造一份后端返回的快照。
 * @param overrides - 需要覆盖的字段。
 * @returns 快照。
 */
export function snapshot(overrides: Partial<TrackerSnapshot> = {}): TrackerSnapshot {
  return {
    repository: 'cnzgray/dsh-mattpocock-workflow',
    fetchedAt: 1_000,
    loaded: TICKETS.length,
    total: 30,
    tickets: TICKETS,
    ...overrides,
  }
}

export function serviceWith(
  responses: readonly (TrackerSnapshot | Error)[],
  kind: BackendKind = 'github',
  resolveBlockers?: BlockerResolver,
): {
  readonly service: SnapshotService
  readonly calls: string[]
  readonly blockerCalls: (readonly TicketReference[])[]
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

export function expectOk(result: RpcResult<WorkspaceSnapshot>): WorkspaceSnapshot {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error.message)
  return result.result
}

export function resolution(
  open: ReadonlyMap<string, number> = new Map(),
  blockedBy: ReadonlyMap<string, readonly string[]> = new Map(),
): BlockerResolution {
  return { open, blockedBy }
}
