/**
 * 快照服务的测试夹具：假后端、假时钟、日志收集与常用断言。
 * 生产代码不导入这个文件；快照服务与指标测试共用，避免两套假实现分叉。
 */
import { expect } from 'vitest'

import type { SnapshotChanges, SnapshotStore } from '../adapters/fs/snapshot-store.ts'
import { SNAPSHOT_CHANGELOG_LIMIT } from '../adapters/fs/snapshot-store.ts'
import { SNAPSHOT_STORE_VERSION, type SnapshotStoreEntry } from '../core/snapshot-store.ts'
import { emptyMetrics } from '../protocol/snapshot-test-support.ts'
import type {
  BlockerResolution,
  Ticket,
  TicketReference,
  TicketState,
  Tracker,
  TrackerChanges,
  TrackerSnapshot,
} from '../core/ticket.ts'
import { TRACKER_LABELS } from '../protocol/labels.ts'
import type { BackendKind } from '../protocol/backend.ts'
import type { RpcResult, SnapshotRefreshResult, WorkspaceSnapshot } from '../protocol/tracker.ts'
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
    assignees: [],
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

/** 一次增量请求的记录。 */
export interface ChangeCall {
  readonly workspaceRoot: string
  readonly since: number
}

export interface FakeResolver {
  readonly resolve: BackendResolver
  readonly calls: string[]
  readonly blockerCalls: (readonly TicketReference[])[]
  /** 增量请求的记录：工作区与窗口起点。 */
  readonly changeCalls: ChangeCall[]
  /** 全量拉取的记录：每次列表请求返回的快照。 */
  readonly snapshotCalls: TrackerSnapshot[]
  /** 列表请求的窗口；调用方没给窗口时记录 undefined。 */
  readonly snapshotWindows: (number | undefined)[]
}

/** 假的阻塞补齐实现；抛错用来覆盖补齐失败。 */
export type BlockerResolver = (tickets: readonly TicketReference[]) => Promise<BlockerResolution>

export function fakeResolver(
  responses: readonly (TrackerSnapshot | Error)[],
  kind: BackendKind = 'github',
  resolveBlockers?: BlockerResolver,
  changes?: (workspaceRoot: string, since: number) => Promise<TrackerChanges>,
): FakeResolver {
  const calls: string[] = []
  const blockerCalls: (readonly TicketReference[])[] = []
  const changeCalls: ChangeCall[] = []
  const snapshotCalls: TrackerSnapshot[] = []
  const snapshotWindows: (number | undefined)[] = []
  let index = 0
  const resolve: BackendResolver = (workspaceRoot) => {
    calls.push(workspaceRoot)
    const response = responses[index]
    index += 1
    if (response === undefined) return Promise.reject(new Error('没有更多响应'))
    if (response instanceof Error) return Promise.reject(response)

    const tracker: Tracker = {
      fetchSnapshot: (_root: string, windowLimit?: number) => {
        snapshotCalls.push(response)
        snapshotWindows.push(windowLimit)
        return Promise.resolve(response)
      },
      ...(resolveBlockers === undefined
        ? {}
        : {
            resolveBlockers: (_root: string, targets: readonly TicketReference[]) => {
              blockerCalls.push(targets)
              return resolveBlockers(targets)
            },
          }),
      ...(changes === undefined
        ? {}
        : {
            fetchChanges: (root: string, since: number) => {
              changeCalls.push({ workspaceRoot: root, since })
              return changes(root, since)
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
  return { resolve, calls, blockerCalls, changeCalls, snapshotCalls, snapshotWindows }
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
    hierarchy: 'native',
    tickets: TICKETS,
    viewer: 'cnzgray',
    ...overrides,
  }
}

export function serviceWith(
  responses: readonly (TrackerSnapshot | Error)[],
  kind: BackendKind = 'github',
  resolveBlockers?: BlockerResolver,
  extras?: {
    /** 后端的增量能力；省略表示后端不支持增量。 */
    readonly changes?: (workspaceRoot: string, since: number) => Promise<TrackerChanges>
    /** 注入的本地快照库。 */
    readonly store?: SnapshotStore
    /** 覆盖假时钟；省略时每次调用向前推 25 毫秒。 */
    readonly now?: () => number
  },
): {
  readonly service: SnapshotService
  readonly calls: string[]
  readonly blockerCalls: (readonly TicketReference[])[]
  readonly changeCalls: ChangeCall[]
  readonly snapshotCalls: TrackerSnapshot[]
  readonly snapshotWindows: (number | undefined)[]
  readonly logs: readonly { level: string; event: string; fields: Record<string, unknown> }[]
} {
  const { resolve, calls, blockerCalls, changeCalls, snapshotCalls, snapshotWindows } =
    fakeResolver(responses, kind, resolveBlockers, extras?.changes)
  const logs: { level: string; event: string; fields: Record<string, unknown> }[] = []
  const log: LogSink = (level, event, fields) => {
    logs.push({ level, event, fields: { ...fields } })
  }
  let clock = 1_000
  const service = createSnapshotService({
    resolve,
    now:
      extras?.now ??
      (() => {
        clock += 25
        return clock
      }),
    labels: TRACKER_LABELS,
    log,
    ...(extras?.store === undefined ? {} : { store: extras.store }),
  })
  return { service, calls, blockerCalls, changeCalls, snapshotCalls, snapshotWindows, logs }
}

/** 内存里的本地快照库：记录写入与清空，行为（版本、变化日志）与文件实现一致。 */
export interface MemoryStore extends SnapshotStore {
  readonly entries: Map<string, SnapshotStoreEntry>
  readonly writes: SnapshotStoreEntry[]
  readonly removed: string[]
  readonly cleared: number
}

/** 内存变化日志条目。 */
interface MemoryLogEntry {
  readonly version: number
  readonly upserted: readonly string[]
  readonly removed: readonly string[]
}

/** 与文件实现同一口径的写入 diff：内容变过的票为 upsert，消失的引用为墓碑。 */
function diffTickets(
  previous: SnapshotStoreEntry | undefined,
  entry: SnapshotStoreEntry,
): { readonly upserted: readonly string[]; readonly removed: readonly string[] } {
  const previousByRef = new Map((previous?.tickets ?? []).map((t) => [t.ref, t]))
  const nextRefs = new Set(entry.tickets.map((t) => t.ref))
  const upserted = entry.tickets
    .filter((t) => JSON.stringify(previousByRef.get(t.ref)) !== JSON.stringify(t))
    .map((t) => t.ref)
  const removed = (previous?.tickets ?? []).filter((t) => !nextRefs.has(t.ref)).map((t) => t.ref)
  return { upserted, removed }
}

/** 折叠日志区间：同一引用多次事件时以最后一次为准。 */
function foldLog(
  log: readonly MemoryLogEntry[],
  afterVersion: number,
  entry: SnapshotStoreEntry,
): SnapshotChanges | undefined {
  const upserted = new Set<string>()
  const removedRefs = new Set<string>()
  for (const item of log) {
    if (item.version <= afterVersion) continue
    for (const ref of item.upserted) {
      upserted.add(ref)
      removedRefs.delete(ref)
    }
    for (const ref of item.removed) {
      removedRefs.add(ref)
      upserted.delete(ref)
    }
  }
  const byRef = new Map(entry.tickets.map((t) => [t.ref, t]))
  const tickets: (typeof entry.tickets)[number][] = []
  for (const ref of upserted) {
    const ticket = byRef.get(ref)
    if (ticket === undefined) return undefined
    tickets.push(ticket)
  }
  return { version: entry.libraryVersion, tickets, removed: [...removedRefs] }
}

/** 内存库按补丁更新一张票：改条目、记日志、推进版本。 */
function patchMemoryTicket(
  entries: Map<string, SnapshotStoreEntry>,
  logs: Map<string, MemoryLogEntry[]>,
  workspaceRoot: string,
  ref: string,
  patch: { readonly labels?: readonly string[]; readonly state?: TicketState },
): boolean {
  const entry = entries.get(workspaceRoot)
  if (entry === undefined) return false
  const index = entry.tickets.findIndex((ticket) => ticket.ref === ref)
  const current = index < 0 ? undefined : entry.tickets[index]
  if (current === undefined) return false
  const tickets = [...entry.tickets]
  tickets[index] = {
    ...current,
    ...(patch.labels === undefined ? {} : { labels: patch.labels }),
    ...(patch.state === undefined ? {} : { state: patch.state }),
  }
  const newVersion = entry.libraryVersion + 1
  entries.set(workspaceRoot, { ...entry, tickets, libraryVersion: newVersion })
  appendMemoryLog(logs, workspaceRoot, newVersion, [ref], [])
  return true
}

/** 内存库移除一张票：记墓碑与日志、推进版本。 */
function removeMemoryTicket(
  entries: Map<string, SnapshotStoreEntry>,
  logs: Map<string, MemoryLogEntry[]>,
  workspaceRoot: string,
  ref: string,
): boolean {
  const entry = entries.get(workspaceRoot)
  if (entry === undefined) return false
  const tickets = entry.tickets.filter((ticket) => ticket.ref !== ref)
  if (tickets.length === entry.tickets.length) return false
  const newVersion = entry.libraryVersion + 1
  entries.set(workspaceRoot, { ...entry, tickets, libraryVersion: newVersion })
  appendMemoryLog(logs, workspaceRoot, newVersion, [], [ref])
  return true
}

/** 内存库追加一条变化日志；与文件实现同一轮转上限。 */
function appendMemoryLog(
  logs: Map<string, MemoryLogEntry[]>,
  workspaceRoot: string,
  version: number,
  upserted: readonly string[],
  removed: readonly string[],
): void {
  const log = logs.get(workspaceRoot) ?? []
  log.push({ version, upserted, removed })
  while (log.length > SNAPSHOT_CHANGELOG_LIMIT) log.shift()
  logs.set(workspaceRoot, log)
}

/**
 * 构造一个内存快照库。
 * @param seed - 初始条目。
 * @returns 内存快照库。
 */
export function memoryStore(seed: readonly SnapshotStoreEntry[] = []): MemoryStore {
  const entries = new Map(seed.map((entry) => [entry.workspaceRoot, entry]))
  const logs = new Map<string, MemoryLogEntry[]>()
  const writes: SnapshotStoreEntry[] = []
  const removed: string[] = []
  let cleared = 0

  return {
    entries,
    writes,
    removed,
    get cleared() {
      return cleared
    },
    read(workspaceRoot) {
      return Promise.resolve(entries.get(workspaceRoot))
    },
    write(entry) {
      const previous = entries.get(entry.workspaceRoot)
      const newVersion = (previous?.libraryVersion ?? 0) + 1
      const diff = diffTickets(previous, entry)
      const stored: SnapshotStoreEntry = { ...entry, libraryVersion: newVersion }
      entries.set(entry.workspaceRoot, stored)
      writes.push(stored)
      if (diff.upserted.length > 0 || diff.removed.length > 0) {
        appendMemoryLog(logs, entry.workspaceRoot, newVersion, diff.upserted, diff.removed)
      }
      return Promise.resolve(newVersion)
    },
    remove(workspaceRoot) {
      entries.delete(workspaceRoot)
      logs.delete(workspaceRoot)
      removed.push(workspaceRoot)
      return Promise.resolve()
    },
    list() {
      return Promise.resolve([...entries.values()])
    },
    clear() {
      const count = entries.size
      entries.clear()
      logs.clear()
      cleared += count
      return Promise.resolve(count)
    },
    prune() {
      return Promise.resolve(0)
    },
    patchTicket: (workspaceRoot, ref, patch) =>
      Promise.resolve(patchMemoryTicket(entries, logs, workspaceRoot, ref, patch)),

    removeTicket: (workspaceRoot, ref) =>
      Promise.resolve(removeMemoryTicket(entries, logs, workspaceRoot, ref)),
    version(workspaceRoot) {
      return Promise.resolve(entries.get(workspaceRoot)?.libraryVersion ?? null)
    },
    changesSince(workspaceRoot, afterVersion) {
      const entry = entries.get(workspaceRoot)
      if (entry === undefined) return Promise.resolve(undefined)
      if (!Number.isInteger(afterVersion) || afterVersion < 0) return Promise.resolve(undefined)
      const current = entry.libraryVersion
      if (afterVersion > current) return Promise.resolve(undefined)
      if (afterVersion === current)
        return Promise.resolve({ version: current, tickets: [], removed: [] })
      const log = logs.get(workspaceRoot) ?? []
      const oldest = log.length === 0 ? current : (log[0]?.version ?? current)
      // 起点比日志覆盖还旧：净变化算不全，交给调用方回退整份。
      if (afterVersion < oldest - 1) return Promise.resolve(undefined)
      return Promise.resolve(foldLog(log, afterVersion, entry))
    },
    location() {
      return '~/.dsh/cache/dsh-mattpocock-workflow'
    },
  }
}

/**
 * 构造一条本地快照库条目。
 * @param overrides - 需要覆盖的字段。
 * @returns 条目。
 */
export function storedEntry(overrides: Partial<SnapshotStoreEntry> = {}): SnapshotStoreEntry {
  return {
    version: SNAPSHOT_STORE_VERSION,
    libraryVersion: 1,
    workspaceRoot: ROOT,
    backend: 'github',
    repository: 'cnzgray/dsh-mattpocock-workflow',
    repositoryKey: 'github@github.com/cnzgray/repo',
    repositoryHost: 'github.com',
    viewer: 'cnzgray',
    fetchedAt: 1_000,
    loaded: TICKETS.length,
    total: 30,
    hierarchy: 'native',
    metrics: emptyMetrics(),
    tickets: TICKETS,
    ...overrides,
  }
}

export function expectOk<T>(result: RpcResult<T>): T {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error.message)
  return result.result
}

/** 刷新的回包断言：必须是整份快照（不是 not-modified / 变化行）时取出快照。 */
export function expectFull(result: RpcResult<SnapshotRefreshResult>): WorkspaceSnapshot {
  const value = expectOk(result)
  if (value.kind !== 'full') throw new Error(`预期整份快照，得到 ${value.kind}`)
  return value.snapshot
}

export function resolution(
  open: ReadonlyMap<string, number> = new Map(),
  blockedBy: ReadonlyMap<string, readonly string[]> = new Map(),
): BlockerResolution {
  return { open, blockedBy }
}
