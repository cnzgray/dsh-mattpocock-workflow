import { describe, expect, it } from 'vitest'

import type { EnvCheckReport } from '../protocol/env-check.ts'
import { emptyMetrics } from '../protocol/snapshot-test-support.ts'
import {
  RPC_PATH,
  type RpcResult,
  type TicketDetail,
  type WorkspaceSnapshot,
} from '../protocol/tracker.ts'
import { builtinZhTranslate } from './i18n-runtime.ts'
import { createPanelClient, type FetchLike, type HttpResponseLike } from './rpc.ts'

const ENV_REPORT: EnvCheckReport = {
  checkedAt: 1,
  backend: 'github',
  repository: 'owner/repo',
  items: [],
  capabilities: [],
}

const SNAPSHOT: WorkspaceSnapshot = {
  backend: 'github',
  repository: 'cnzgray/dsh-mattpocock-workflow',
  repositoryHost: 'github.com',
  viewer: 'cnzgray',
  fetchedAt: 1,
  loaded: 0,
  total: 0,
  windowLimit: 100,
  tickets: [],
  metrics: emptyMetrics(),
  blockersFinalized: true,
  source: 'live',
  stale: false,
  refreshError: null,
}

const TICKET = {
  ref: '#1',
  number: 1,
  title: '一张票',
  state: 'open',
  category: 'enhancement',
  status: 'ready',
  skillAction: 'implement',
  skillActionReason: 'ready-for-agent',
  labels: [],
  author: null,
  assignees: ['alice'],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  openBlockers: 0,
} as const

const DETAIL: TicketDetail = {
  ref: '#25',
  number: 25,
  title: '工单详情视图',
  state: 'open',
  author: 'carol',
  body: '正文',
  labels: ['enhancement'],
  assignees: ['alice'],
  comments: [{ author: 'bob', body: '补充验收标准', createdAt: '2026-11-13T09:00:00Z' }],
  url: 'https://github.com/cnzgray/dsh-mattpocock-workflow/issues/25',
  createdAt: '2026-11-12T09:00:00Z',
  updatedAt: '2026-11-13T09:00:00Z',
  backend: 'github',
  capabilities: { labels: true, assignees: true, state: true, link: true, delete: false },
}

function response(body: unknown, ok = true, status = 200): HttpResponseLike {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  }
}

function recordingFetch(result: HttpResponseLike): {
  readonly fetchImpl: FetchLike
  readonly calls: { url: string; method: string; body: string }[]
} {
  const calls: { url: string; method: string; body: string }[] = []
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, method: init.method, body: init.body })
    return Promise.resolve(result)
  }
  return { fetchImpl, calls }
}

describe('快照 RPC 客户端', () => {
  it('向插件私有路由发送 snapshot.get', async () => {
    const { fetchImpl, calls } = recordingFetch(response({ ok: true, result: SNAPSHOT }))
    const client = createPanelClient(builtinZhTranslate, fetchImpl)

    await client.get('/repo')

    expect(calls).toEqual([
      {
        url: RPC_PATH,
        method: 'POST',
        body: JSON.stringify({
          method: 'snapshot.get',
          params: { workspaceRoot: '/repo' },
        }),
      },
    ])
  })

  it('向插件私有路由发送 snapshot.refresh', async () => {
    const { fetchImpl, calls } = recordingFetch(response({ ok: true, result: SNAPSHOT }))
    const client = createPanelClient(builtinZhTranslate, fetchImpl)

    await client.refresh('/repo')

    expect(JSON.parse(calls[0]?.body ?? '{}')).toMatchObject({ method: 'snapshot.refresh' })
  })

  it('向插件私有路由发送 snapshot.resolveBlockers', async () => {
    const { fetchImpl, calls } = recordingFetch(response({ ok: true, result: SNAPSHOT }))
    const client = createPanelClient(builtinZhTranslate, fetchImpl)

    await client.resolveBlockers('/repo')

    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      method: 'snapshot.resolveBlockers',
      params: { workspaceRoot: '/repo' },
    })
  })

  it('增量刷新不带 full 参数', async () => {
    const { fetchImpl, calls } = recordingFetch(response({ ok: true, result: SNAPSHOT }))
    const client = createPanelClient(builtinZhTranslate, fetchImpl)

    await client.refresh('/repo')

    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      method: 'snapshot.refresh',
      params: { workspaceRoot: '/repo' },
    })
  })

  it('全量刷新时在请求参数里带上 full', async () => {
    const { fetchImpl, calls } = recordingFetch(response({ ok: true, result: SNAPSHOT }))
    const client = createPanelClient(builtinZhTranslate, fetchImpl)

    await client.refresh('/repo', { full: true })

    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      method: 'snapshot.refresh',
      params: { workspaceRoot: '/repo', full: true },
    })
  })

  it.each([
    ['source', { source: undefined }],
    ['stale', { stale: undefined }],
    ['refreshError', { refreshError: undefined }],
  ] as const)('快照缺少 %s 时返回 fetch-failed', async (_field, patch) => {
    const legacy = { ...SNAPSHOT, ...patch }
    const client = createPanelClient(
      builtinZhTranslate,
      recordingFetch(response({ ok: true, result: legacy })).fetchImpl,
    )

    await expect(client.get('/repo')).resolves.toMatchObject({
      ok: false,
      error: { code: 'fetch-failed' },
    })
  })

  it('快照缺少 viewer 或类型不对时返回 fetch-failed', async () => {
    for (const viewer of [undefined, 7, {}]) {
      const broken = { ...SNAPSHOT, viewer }
      const client = createPanelClient(
        builtinZhTranslate,
        recordingFetch(response({ ok: true, result: broken })).fetchImpl,
      )

      await expect(client.get('/repo')).resolves.toMatchObject({
        ok: false,
        error: { code: 'fetch-failed' },
      })
    }
  })

  it('快照的刷新失败原因格式不对时返回 fetch-failed', async () => {
    const broken = { ...SNAPSHOT, refreshError: { code: 'fetch-failed' } }
    const client = createPanelClient(
      builtinZhTranslate,
      recordingFetch(response({ ok: true, result: broken })).fetchImpl,
    )

    await expect(client.get('/repo')).resolves.toMatchObject({
      ok: false,
      error: { code: 'fetch-failed' },
    })
  })

  it('成功响应原样返回', async () => {
    const expected: RpcResult<WorkspaceSnapshot> = { ok: true, result: SNAPSHOT }
    const client = createPanelClient(
      builtinZhTranslate,
      recordingFetch(response(expected)).fetchImpl,
    )

    await expect(client.get('/repo')).resolves.toEqual(expected)
  })

  it('HTTP 非 2xx 返回 fetch-failed', async () => {
    const client = createPanelClient(
      builtinZhTranslate,
      recordingFetch(response({}, false, 502)).fetchImpl,
    )

    await expect(client.get('/repo')).resolves.toMatchObject({
      ok: false,
      error: { code: 'fetch-failed', message: expect.stringContaining('HTTP 502') as string },
    })
  })

  it('响应体不是快照结果时返回 fetch-failed', async () => {
    const client = createPanelClient(
      builtinZhTranslate,
      recordingFetch(response({ ok: true, result: {} })).fetchImpl,
    )

    await expect(client.get('/repo')).resolves.toMatchObject({
      ok: false,
      error: { code: 'fetch-failed' },
    })
  })

  it('快照缺少实例主机字段时返回 fetch-failed', async () => {
    const legacy = {
      backend: SNAPSHOT.backend,
      repository: SNAPSHOT.repository,
      fetchedAt: SNAPSHOT.fetchedAt,
      loaded: SNAPSHOT.loaded,
      total: SNAPSHOT.total,
      tickets: SNAPSHOT.tickets,
      blockersFinalized: SNAPSHOT.blockersFinalized,
    }
    const client = createPanelClient(
      builtinZhTranslate,
      recordingFetch(response({ ok: true, result: legacy })).fetchImpl,
    )

    await expect(client.get('/repo')).resolves.toMatchObject({
      ok: false,
      error: { code: 'fetch-failed' },
    })
  })

  it('快照缺少 blockersFinalized 时返回 fetch-failed', async () => {
    const legacy = {
      backend: SNAPSHOT.backend,
      repository: SNAPSHOT.repository,
      repositoryHost: SNAPSHOT.repositoryHost,
      fetchedAt: SNAPSHOT.fetchedAt,
      loaded: SNAPSHOT.loaded,
      total: SNAPSHOT.total,
      tickets: SNAPSHOT.tickets,
    }
    const client = createPanelClient(
      builtinZhTranslate,
      recordingFetch(response({ ok: true, result: legacy })).fetchImpl,
    )

    await expect(client.get('/repo')).resolves.toMatchObject({
      ok: false,
      error: { code: 'fetch-failed' },
    })
  })

  it('快照缺少 backend 时返回 fetch-failed', async () => {
    const legacy = {
      repository: SNAPSHOT.repository,
      fetchedAt: SNAPSHOT.fetchedAt,
      loaded: SNAPSHOT.loaded,
      total: SNAPSHOT.total,
      tickets: SNAPSHOT.tickets,
    }
    const client = createPanelClient(
      builtinZhTranslate,
      recordingFetch(response({ ok: true, result: legacy })).fetchImpl,
    )

    await expect(client.get('/repo')).resolves.toMatchObject({
      ok: false,
      error: { code: 'fetch-failed' },
    })
  })

  it.each(['skillAction', 'skillActionReason'] as const)(
    '工单缺少 %s 时返回 fetch-failed',
    async (field) => {
      const ticket = Object.fromEntries(Object.entries(TICKET).filter(([key]) => key !== field))
      const legacy = { ...SNAPSHOT, tickets: [ticket] }
      const client = createPanelClient(
        builtinZhTranslate,
        recordingFetch(response({ ok: true, result: legacy })).fetchImpl,
      )

      await expect(client.get('/repo')).resolves.toMatchObject({
        ok: false,
        error: { code: 'fetch-failed' },
      })
    },
  )

  it('工单缺少 assignees 或不是字符串数组时返回 fetch-failed', async () => {
    for (const assignees of [undefined, 'alice', ['alice', 7]]) {
      const legacy = { ...SNAPSHOT, tickets: [{ ...TICKET, assignees }] }
      const client = createPanelClient(
        builtinZhTranslate,
        recordingFetch(response({ ok: true, result: legacy })).fetchImpl,
      )

      await expect(client.get('/repo')).resolves.toMatchObject({
        ok: false,
        error: { code: 'fetch-failed' },
      })
    }
  })

  it('工单的技能动作不在词表里时返回 fetch-failed', async () => {
    const legacy = { ...SNAPSHOT, tickets: [{ ...TICKET, skillAction: 'unknown' }] }
    const client = createPanelClient(
      builtinZhTranslate,
      recordingFetch(response({ ok: true, result: legacy })).fetchImpl,
    )

    await expect(client.get('/repo')).resolves.toMatchObject({
      ok: false,
      error: { code: 'fetch-failed' },
    })
  })

  it('网络异常返回 fetch-failed 并保留原因', async () => {
    const client = createPanelClient(builtinZhTranslate, () => Promise.reject(new Error('offline')))

    await expect(client.get('/repo')).resolves.toMatchObject({
      ok: false,
      error: { code: 'fetch-failed', message: expect.stringContaining('offline') as string },
    })
  })
  it('向插件私有路由发送 env.check', async () => {
    const { fetchImpl, calls } = recordingFetch(response({ ok: true, result: ENV_REPORT }))
    const client = createPanelClient(builtinZhTranslate, fetchImpl)

    await client.envCheck('/repo')

    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      method: 'env.check',
      params: { workspaceRoot: '/repo' },
    })
  })

  it('环境检查响应缺少 items 时返回 fetch-failed', async () => {
    const client = createPanelClient(
      builtinZhTranslate,
      recordingFetch(response({ ok: true, result: { checkedAt: 1, backend: 'github' } })).fetchImpl,
    )

    await expect(client.envCheck('/repo')).resolves.toMatchObject({
      ok: false,
      error: { code: 'fetch-failed' },
    })
  })
})

describe('工单详情 RPC 客户端', () => {
  it('向插件私有路由发送 ticket.get', async () => {
    const { fetchImpl, calls } = recordingFetch(response({ ok: true, result: DETAIL }))
    const client = createPanelClient(builtinZhTranslate, fetchImpl)

    await client.getDetail('/repo', '#25', 25)

    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      method: 'ticket.get',
      params: { workspaceRoot: '/repo', ref: '#25', number: 25 },
    })
  })

  it('向插件私有路由发送 ticket.update 并带上补丁', async () => {
    const { fetchImpl, calls } = recordingFetch(response({ ok: true, result: { applied: true } }))
    const client = createPanelClient(builtinZhTranslate, fetchImpl)

    await client.updateTicket('/repo', '#25', 25, { labels: ['bug', 'ready-for-agent'] })

    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      method: 'ticket.update',
      params: {
        workspaceRoot: '/repo',
        ref: '#25',
        number: 25,
        patch: { labels: ['bug', 'ready-for-agent'] },
      },
    })
  })

  it('详情缺少能力位时返回 fetch-failed', async () => {
    const incomplete = { ...DETAIL, capabilities: undefined }
    const client = createPanelClient(
      builtinZhTranslate,
      recordingFetch(response({ ok: true, result: incomplete })).fetchImpl,
    )

    await expect(client.getDetail('/repo', '#25', 25)).resolves.toMatchObject({
      ok: false,
      error: { code: 'fetch-failed' },
    })
  })

  it('变更回执缺少 applied 时返回 fetch-failed', async () => {
    const client = createPanelClient(
      builtinZhTranslate,
      recordingFetch(response({ ok: true, result: {} })).fetchImpl,
    )

    await expect(
      client.updateTicket('/repo', '#25', 25, { state: 'closed' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'fetch-failed' } })
  })
})

describe('本地快照库 RPC 客户端', () => {
  const CACHE_INFO = {
    location: '~/.dsh/cache/dsh-mattpocock-workflow/',
    entries: 3,
    lastWrittenAt: 1_700_000_000_000,
    cleared: 0,
  }

  it('读取本地快照库时只带工作区', async () => {
    const { fetchImpl, calls } = recordingFetch(response({ ok: true, result: CACHE_INFO }))

    const result = await createPanelClient(builtinZhTranslate, fetchImpl).cache('/repo')

    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      method: 'snapshot.cache',
      params: { workspaceRoot: '/repo' },
    })
    expect(result).toEqual({ ok: true, result: CACHE_INFO })
  })

  it('清空本地快照库时带上确认词', async () => {
    const { fetchImpl, calls } = recordingFetch(
      response({ ok: true, result: { ...CACHE_INFO, entries: 0, cleared: 3 } }),
    )

    await createPanelClient(builtinZhTranslate, fetchImpl).cache('/repo', { clear: true })

    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      method: 'snapshot.cache',
      params: { workspaceRoot: '/repo', clear: true, confirm: 'clear-cache' },
    })
  })

  it.each([
    ['location', { location: undefined }],
    ['entries', { entries: undefined }],
    ['lastWrittenAt', { lastWrittenAt: undefined }],
    ['cleared', { cleared: undefined }],
  ] as const)('快照库信息缺少 %s 时返回 fetch-failed', async (_field, patch) => {
    const client = createPanelClient(
      builtinZhTranslate,
      recordingFetch(response({ ok: true, result: { ...CACHE_INFO, ...patch } })).fetchImpl,
    )

    await expect(client.cache('/repo')).resolves.toMatchObject({
      ok: false,
      error: { code: 'fetch-failed' },
    })
  })
})

describe('补全候选与删除 RPC 客户端', () => {
  it('ticket.options 只带工作区，并接受标签颜色与用户显示名', async () => {
    const options = {
      labels: [{ name: 'bug', color: '#d73a4a', description: null }],
      assignees: [{ username: 'alice', name: 'Alice' }],
    }
    const { fetchImpl, calls } = recordingFetch(response({ ok: true, result: options }))

    const result = await createPanelClient(builtinZhTranslate, fetchImpl).getOptions('/repo')

    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      method: 'ticket.options',
      params: { workspaceRoot: '/repo' },
    })
    expect(result).toEqual({ ok: true, result: options })
  })

  it('候选形状不对时返回 fetch-failed', async () => {
    const malformed = { labels: [{ name: 1 }], assignees: [] }
    const client = createPanelClient(
      builtinZhTranslate,
      recordingFetch(response({ ok: true, result: malformed })).fetchImpl,
    )

    await expect(client.getOptions('/repo')).resolves.toMatchObject({
      ok: false,
      error: { code: 'fetch-failed' },
    })
  })

  it('ticket.delete 总是带上确认词 delete', async () => {
    const { fetchImpl, calls } = recordingFetch(response({ ok: true, result: { deleted: true } }))

    const result = await createPanelClient(builtinZhTranslate, fetchImpl).deleteTicket(
      '/repo',
      '#25',
      25,
    )

    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      method: 'ticket.delete',
      params: { workspaceRoot: '/repo', ref: '#25', number: 25, confirm: 'delete' },
    })
    expect(result).toEqual({ ok: true, result: { deleted: true } })
  })

  it('删除回执缺少 deleted 时返回 fetch-failed', async () => {
    const client = createPanelClient(
      builtinZhTranslate,
      recordingFetch(response({ ok: true, result: {} })).fetchImpl,
    )

    await expect(client.deleteTicket('/repo', '#25', 25)).resolves.toMatchObject({
      ok: false,
      error: { code: 'fetch-failed' },
    })
  })
})
