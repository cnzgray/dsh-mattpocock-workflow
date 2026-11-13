import { describe, expect, it } from 'vitest'

import type {
  TicketDetail,
  TicketOptions,
  TicketPatch,
  TicketReference,
  Tracker,
  TrackerSnapshot,
} from '../core/ticket.ts'
import { TrackerError } from '../core/tracker-error.ts'
import type { BackendKind } from '../protocol/backend.ts'
import { LOG_EVENTS } from '../protocol/log-events.ts'
import type { RpcResult, TicketDetail as WireTicketDetail } from '../protocol/tracker.ts'
import type { BackendResolver, ResolvedBackend } from './backend-resolver.ts'
import type { LogSink } from './log.ts'
import { createTicketService, type TicketService } from './ticket-service.ts'

const ROOT = '/workspace'
const REF: TicketReference = { ref: '#25', number: 25 }

const DETAIL: TicketDetail = {
  ref: '#25',
  number: 25,
  title: '工单详情视图',
  state: 'open',
  author: 'dave',
  body: '正文',
  labels: ['enhancement'],
  assignees: ['alice'],
  comments: [{ author: 'bob', body: '补充验收标准', createdAt: '2026-11-13T09:00:00Z' }],
  url: 'https://github.com/cnzgray/dsh-mattpocock-workflow/issues/25',
  createdAt: '2026-11-12T09:00:00Z',
  updatedAt: '2026-11-13T09:00:00Z',
}

const OPTIONS: TicketOptions = {
  labels: [{ name: 'bug', color: '#d73a4a', description: null }],
  assignees: [{ username: 'alice', name: 'Alice' }],
}

interface FakeOptions {
  readonly kind?: BackendKind
  readonly detail?: TicketDetail | Error
  readonly update?: Error
  readonly options?: TicketOptions | Error
  readonly permission?: boolean | Error
  readonly deleteError?: Error
  readonly supportDetail?: boolean
  readonly supportUpdate?: boolean
  readonly supportOptions?: boolean
  readonly supportDelete?: boolean
}

interface FakeResolver {
  readonly resolve: BackendResolver
  readonly detailCalls: (readonly [string, TicketReference])[]
  readonly updateCalls: (readonly [string, TicketReference, TicketPatch])[]
  readonly optionsCalls: string[]
  readonly canDeleteCalls: string[]
  readonly deleteCalls: (readonly [string, TicketReference])[]
}

function fakeResolver(options: FakeOptions = {}): FakeResolver {
  const kind = options.kind ?? 'github'
  const detailCalls: (readonly [string, TicketReference])[] = []
  const updateCalls: (readonly [string, TicketReference, TicketPatch])[] = []
  const optionsCalls: string[] = []
  const canDeleteCalls: string[] = []
  const deleteCalls: (readonly [string, TicketReference])[] = []

  const tracker: Tracker = {
    fetchSnapshot: (): Promise<TrackerSnapshot> => Promise.reject(new Error('未使用')),
    ...(options.supportDetail === false
      ? {}
      : {
          fetchDetail: (workspaceRoot: string, reference: TicketReference) => {
            detailCalls.push([workspaceRoot, reference])
            const detail = options.detail ?? DETAIL
            return detail instanceof Error
              ? Promise.reject(detail)
              : Promise.resolve({ ...detail, ref: reference.ref, number: reference.number })
          },
        }),
    ...(options.supportUpdate === false
      ? {}
      : {
          updateTicket: (workspaceRoot: string, reference: TicketReference, patch: TicketPatch) => {
            updateCalls.push([workspaceRoot, reference, patch])
            return options.update instanceof Error
              ? Promise.reject(options.update)
              : Promise.resolve()
          },
        }),
    ...(options.supportOptions === false
      ? {}
      : {
          fetchOptions: (workspaceRoot: string) => {
            optionsCalls.push(workspaceRoot)
            const value = options.options ?? OPTIONS
            return value instanceof Error ? Promise.reject(value) : Promise.resolve(value)
          },
        }),
    ...(options.supportDelete === true
      ? {
          canDeleteTickets: (workspaceRoot: string) => {
            canDeleteCalls.push(workspaceRoot)
            const value = options.permission ?? true
            return value instanceof Error ? Promise.reject(value) : Promise.resolve(value)
          },
          deleteTicket: (workspaceRoot: string, reference: TicketReference) => {
            deleteCalls.push([workspaceRoot, reference])
            return options.deleteError === undefined
              ? Promise.resolve()
              : Promise.reject(options.deleteError)
          },
        }
      : {}),
  }

  const resolved: ResolvedBackend = {
    kind,
    tracker,
    choice: { kind, source: kind === 'markdown' ? 'no-remote' : 'remote' },
    address: kind === 'markdown' ? undefined : { host: 'github.com', path: 'cnzgray/repo' },
  }

  return {
    resolve: () => Promise.resolve(resolved),
    detailCalls,
    updateCalls,
    optionsCalls,
    canDeleteCalls,
    deleteCalls,
  }
}

interface FakeService {
  readonly service: TicketService
  readonly detailCalls: FakeResolver['detailCalls']
  readonly updateCalls: FakeResolver['updateCalls']
  readonly optionsCalls: FakeResolver['optionsCalls']
  readonly canDeleteCalls: FakeResolver['canDeleteCalls']
  readonly deleteCalls: FakeResolver['deleteCalls']
  readonly logs: readonly { level: string; event: string; fields: Record<string, unknown> }[]
}

function serviceWith(options: FakeOptions = {}): FakeService {
  const fake = fakeResolver(options)
  const logs: { level: string; event: string; fields: Record<string, unknown> }[] = []
  const log: LogSink = (level, event, fields) => {
    logs.push({ level, event, fields: { ...fields } })
  }
  let clock = 1_000

  return {
    service: createTicketService({
      resolve: fake.resolve,
      now: () => {
        clock += 20
        return clock
      },
      log,
    }),
    detailCalls: fake.detailCalls,
    updateCalls: fake.updateCalls,
    optionsCalls: fake.optionsCalls,
    canDeleteCalls: fake.canDeleteCalls,
    deleteCalls: fake.deleteCalls,
    logs,
  }
}

function unwrap(result: RpcResult<unknown>): unknown {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error.message)
  return result.result
}

describe('工单详情服务', () => {
  it('返回详情并附上后端与能力位', async () => {
    const { service } = serviceWith()

    const result = unwrap(
      await service.handle('ticket.get', { workspaceRoot: ROOT, ...REF }),
    ) as WireTicketDetail

    expect(result).toMatchObject({
      ref: '#25',
      title: '工单详情视图',
      author: 'dave',
      backend: 'github',
      capabilities: { labels: true, assignees: true, state: true, link: true },
    })
    expect(result.comments).toEqual(DETAIL.comments)
  })

  it('本地 Markdown 的写能力与链接能力全部为 false', async () => {
    const { service } = serviceWith({
      kind: 'markdown',
      detail: { ...DETAIL, number: null, url: null, ref: '.scratch/login/issues/03-session.md' },
      supportUpdate: false,
    })

    const result = unwrap(
      await service.handle('ticket.get', {
        workspaceRoot: ROOT,
        ref: '.scratch/login/issues/03-session.md',
        number: null,
      }),
    ) as WireTicketDetail

    expect(result.capabilities).toEqual({
      labels: false,
      assignees: false,
      state: false,
      link: false,
      delete: false,
    })
  })

  it('有删除能力与权限时详情里的删除能力为 true', async () => {
    const { service, canDeleteCalls } = serviceWith({ supportDelete: true })

    const result = unwrap(
      await service.handle('ticket.get', { workspaceRoot: ROOT, ...REF }),
    ) as WireTicketDetail

    expect(result.capabilities.delete).toBe(true)
    expect(canDeleteCalls).toEqual([ROOT])
  })

  it('权限查询失败时仍返回详情，删除能力为 false', async () => {
    const { service, canDeleteCalls } = serviceWith({
      supportDelete: true,
      permission: new Error('boom'),
    })

    const result = unwrap(
      await service.handle('ticket.get', { workspaceRoot: ROOT, ...REF }),
    ) as WireTicketDetail

    expect(result.title).toBe('工单详情视图')
    expect(result.capabilities.delete).toBe(false)
    expect(canDeleteCalls).toEqual([ROOT])
  })

  it('后端不实现详情能力时返回 capability-unsupported 并说明后端', async () => {
    const { service } = serviceWith({ kind: 'markdown', supportDetail: false })

    const result = await service.handle('ticket.get', { workspaceRoot: ROOT, ...REF })

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'capability-unsupported' },
    })
    if (!result.ok) expect(result.error.message).toContain('本地')
  })

  it('把适配器错误原样映射成协议错误码', async () => {
    const { service } = serviceWith({
      detail: new TrackerError('ticket-not-found', '找不到这张工单，它可能已被删除。'),
    })

    await expect(service.handle('ticket.get', { workspaceRoot: ROOT, ...REF })).resolves.toEqual({
      ok: false,
      error: { code: 'ticket-not-found', message: '找不到这张工单，它可能已被删除。' },
    })
  })

  it('未预期的错误映射为 internal', async () => {
    const { service } = serviceWith({ detail: new Error('boom') })

    await expect(
      service.handle('ticket.get', { workspaceRoot: ROOT, ...REF }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'internal' } })
  })

  it.each([
    ['缺少 workspaceRoot', { ref: '#25', number: 25 }],
    ['workspaceRoot 为空', { workspaceRoot: '', ref: '#25', number: 25 }],
    ['缺少 ref', { workspaceRoot: ROOT, number: 25 }],
    ['ref 为空', { workspaceRoot: ROOT, ref: '', number: 25 }],
    ['缺少 number', { workspaceRoot: ROOT, ref: '#25' }],
    ['number 为小数', { workspaceRoot: ROOT, ref: '#25', number: 1.5 }],
    ['number 为 0', { workspaceRoot: ROOT, ref: '#25', number: 0 }],
  ] as const)('%s 时返回 invalid-params', async (_label, params) => {
    const { service, detailCalls } = serviceWith()

    await expect(service.handle('ticket.get', params)).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-params' },
    })
    expect(detailCalls).toEqual([])
  })

  it('未知方法返回 unknown-method', async () => {
    const { service } = serviceWith()

    await expect(service.handle('ticket.unknown', {})).resolves.toMatchObject({
      ok: false,
      error: { code: 'unknown-method' },
    })
  })
})

describe('工单变更服务', () => {
  it('把补丁转给适配器并返回 applied', async () => {
    const { service, updateCalls } = serviceWith()

    const result = unwrap(
      await service.handle('ticket.update', {
        workspaceRoot: ROOT,
        ...REF,
        patch: { labels: ['bug'], state: 'closed' },
      }),
    )

    expect(result).toEqual({ applied: true })
    expect(updateCalls).toEqual([[ROOT, REF, { labels: ['bug'], state: 'closed' }]])
  })

  it('标签与分配人去空格、去重并保持顺序', async () => {
    const { service, updateCalls } = serviceWith()

    await service.handle('ticket.update', {
      workspaceRoot: ROOT,
      ...REF,
      patch: { labels: [' bug ', 'bug', 'ready-for-agent'], assignees: [' alice ', 'alice'] },
    })

    expect(updateCalls[0]?.[2]).toEqual({
      labels: ['bug', 'ready-for-agent'],
      assignees: ['alice'],
    })
  })

  it('分配给我与目标集合一起透传', async () => {
    const { service, updateCalls } = serviceWith()

    await service.handle('ticket.update', {
      workspaceRoot: ROOT,
      ...REF,
      patch: { assignees: ['alice'], assignSelf: true },
    })

    expect(updateCalls[0]?.[2]).toEqual({ assignees: ['alice'], assignSelf: true })
  })

  it('后端不实现变更能力时返回 capability-unsupported', async () => {
    const { service, updateCalls } = serviceWith({ kind: 'markdown', supportUpdate: false })

    const result = await service.handle('ticket.update', {
      workspaceRoot: ROOT,
      ...REF,
      patch: { state: 'closed' },
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'capability-unsupported' } })
    if (!result.ok) expect(result.error.message).toContain('本地')
    expect(updateCalls).toEqual([])
  })

  it('适配器失败时返回后端错误码', async () => {
    const { service } = serviceWith({
      update: new TrackerError('tea-unauthenticated', 'tea 未登录该实例或令牌已失效。'),
    })

    await expect(
      service.handle('ticket.update', {
        workspaceRoot: ROOT,
        ...REF,
        patch: { labels: ['bug'] },
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'tea-unauthenticated',
        message: 'tea 未登录该实例或令牌已失效。',
      },
    })
  })

  it.each([
    ['patch 不是对象', 'string'],
    ['空补丁', {}],
    ['未知字段', { title: '改标题' }],
    ['labels 不是数组', { labels: 'bug' }],
    ['标签为空串', { labels: [' '] }],
    ['标签不是字符串', { labels: [1] }],
    ['state 非法', { state: 'merged' }],
    ['assignSelf 不是布尔', { assignSelf: 'yes' }],
  ] as const)('%s 时返回 invalid-params', async (_label, patch) => {
    const { service, updateCalls } = serviceWith()

    await expect(
      service.handle('ticket.update', { workspaceRoot: ROOT, ...REF, patch }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid-params' } })
    expect(updateCalls).toEqual([])
  })

  it('成功与失败都记一条工单日志，不记正文或引用', async () => {
    const okService = serviceWith()
    await okService.service.handle('ticket.update', {
      workspaceRoot: ROOT,
      ...REF,
      patch: { state: 'closed' },
    })

    expect(okService.logs.at(-1)).toMatchObject({
      level: 'info',
      event: LOG_EVENTS.ticket,
      fields: { result: 'ok', action: 'update', backend: 'github' },
    })
    expect(okService.logs.at(-1)?.fields).not.toHaveProperty('ref')

    const failed = serviceWith({ update: new TrackerError('gh-missing', '未找到 gh 命令。') })
    await failed.service.handle('ticket.update', {
      workspaceRoot: ROOT,
      ...REF,
      patch: { state: 'closed' },
    })

    expect(failed.logs.at(-1)).toMatchObject({
      level: 'warn',
      event: LOG_EVENTS.ticket,
      fields: { result: 'error', action: 'update', code: 'gh-missing' },
    })
  })
})

describe('工单补全候选服务', () => {
  it('返回后端给出的标签与可分配用户', async () => {
    const { service, optionsCalls, logs } = serviceWith()

    const result = unwrap(await service.handle('ticket.options', { workspaceRoot: ROOT }))

    expect(result).toEqual(OPTIONS)
    expect(optionsCalls).toEqual([ROOT])
    expect(logs.at(-1)).toMatchObject({
      level: 'info',
      event: LOG_EVENTS.ticket,
      fields: { result: 'ok', action: 'options', backend: 'github' },
    })
  })

  it('缺少 workspaceRoot 时返回 invalid-params', async () => {
    const { service, optionsCalls } = serviceWith()

    await expect(service.handle('ticket.options', {})).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-params' },
    })
    expect(optionsCalls).toEqual([])
  })

  it('后端不实现补全候选时返回 capability-unsupported', async () => {
    const { service } = serviceWith({ kind: 'markdown', supportOptions: false })

    const result = await service.handle('ticket.options', { workspaceRoot: ROOT })

    expect(result).toMatchObject({ ok: false, error: { code: 'capability-unsupported' } })
    if (!result.ok) expect(result.error.message).toContain('本地')
  })

  it('适配器失败时返回后端错误码', async () => {
    const { service } = serviceWith({
      options: new TrackerError('glab-missing', '未找到 glab 命令。'),
    })

    await expect(service.handle('ticket.options', { workspaceRoot: ROOT })).resolves.toEqual({
      ok: false,
      error: { code: 'glab-missing', message: '未找到 glab 命令。' },
    })
  })
})

describe('工单删除服务', () => {
  it('确认词正确且有权限时删除并返回 deleted', async () => {
    const { service, deleteCalls, logs } = serviceWith({ supportDelete: true })

    const result = unwrap(
      await service.handle('ticket.delete', {
        workspaceRoot: ROOT,
        ...REF,
        confirm: 'delete',
      }),
    )

    expect(result).toEqual({ deleted: true })
    expect(deleteCalls).toEqual([[ROOT, REF]])
    expect(logs.at(-1)).toMatchObject({
      level: 'info',
      event: LOG_EVENTS.ticket,
      fields: { result: 'ok', action: 'delete', backend: 'github' },
    })
  })

  it.each([
    ['缺少确认词', { workspaceRoot: ROOT, ...REF }],
    ['确认词错误', { workspaceRoot: ROOT, ...REF, confirm: 'remove' }],
  ] as const)('%s 时返回 invalid-params，不调用删除', async (_label, params) => {
    const { service, deleteCalls } = serviceWith({ supportDelete: true })

    await expect(service.handle('ticket.delete', params)).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-params' },
    })
    expect(deleteCalls).toEqual([])
  })

  it('没有权限时返回明确失败，不调用删除', async () => {
    const { service, deleteCalls } = serviceWith({
      supportDelete: true,
      permission: false,
    })

    const result = await service.handle('ticket.delete', {
      workspaceRoot: ROOT,
      ...REF,
      confirm: 'delete',
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'fetch-failed' } })
    if (!result.ok) expect(result.error.message).toContain('权限')
    expect(deleteCalls).toEqual([])
  })

  it('权限查询失败时也不调用删除', async () => {
    const { service, deleteCalls } = serviceWith({
      supportDelete: true,
      permission: new Error('boom'),
    })

    const result = await service.handle('ticket.delete', {
      workspaceRoot: ROOT,
      ...REF,
      confirm: 'delete',
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'fetch-failed' } })
    expect(deleteCalls).toEqual([])
  })

  it('后端不实现删除能力时返回 capability-unsupported', async () => {
    const { service, deleteCalls } = serviceWith({ kind: 'markdown' })

    const result = await service.handle('ticket.delete', {
      workspaceRoot: ROOT,
      ...REF,
      confirm: 'delete',
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'capability-unsupported' } })
    if (!result.ok) expect(result.error.message).toContain('本地')
    expect(deleteCalls).toEqual([])
  })

  it('删除失败时返回后端错误码', async () => {
    const { service } = serviceWith({
      supportDelete: true,
      deleteError: new TrackerError('ticket-not-found', '找不到这张工单，它可能已被删除。'),
    })

    await expect(
      service.handle('ticket.delete', {
        workspaceRoot: ROOT,
        ...REF,
        confirm: 'delete',
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'ticket-not-found', message: '找不到这张工单，它可能已被删除。' },
    })
  })
})
