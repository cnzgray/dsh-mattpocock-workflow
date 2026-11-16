import { describe, expect, it } from 'vitest'

import type { RpcResult, WorkspaceSnapshot } from '../protocol/tracker.ts'
import { emptyMetrics } from '../protocol/snapshot-test-support.ts'
import { createRpcFetchHandler } from './rpc-http.ts'
import type { SnapshotService } from './snapshot-service.ts'

interface RecordedCall {
  readonly method: string
  readonly params: unknown
}

function fakeService(result: RpcResult<WorkspaceSnapshot>): {
  readonly service: SnapshotService
  readonly calls: RecordedCall[]
} {
  const calls: RecordedCall[] = []
  const service: SnapshotService = {
    handle(method, params) {
      calls.push({ method, params })
      return Promise.resolve(result)
    },
    cache(params) {
      calls.push({ method: 'snapshot.cache', params })
      return Promise.resolve({
        ok: true,
        result: {
          location: '~/.dsh/cache/dsh-mattpocock-workflow',
          entries: 0,
          lastWrittenAt: null,
          cleared: 0,
        },
      })
    },
  }
  return { service, calls }
}

const OK: RpcResult<WorkspaceSnapshot> = {
  ok: true,
  result: {
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
  },
}

function request(body: string, method = 'POST'): Request {
  const url = 'http://localhost/api/dsh-mattpocock-workflow'
  return method === 'POST' ? new Request(url, { method, body }) : new Request(url, { method })
}

describe('RPC HTTP 路由', () => {
  it('把请求体里的 method 与 params 交给快照服务', async () => {
    const { service, calls } = fakeService(OK)
    const handler = createRpcFetchHandler(service)

    const response = await handler(
      request(JSON.stringify({ method: 'snapshot.get', params: { workspaceRoot: '/repo' } })),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(OK)
    expect(calls).toEqual([{ method: 'snapshot.get', params: { workspaceRoot: '/repo' } }])
  })

  it('非 POST 请求返回 405', async () => {
    const { service } = fakeService(OK)
    const handler = createRpcFetchHandler(service)

    const response = await handler(request('', 'GET'))

    expect(response.status).toBe(405)
  })

  it('请求体不是 JSON 时返回 400 与 invalid-request', async () => {
    const { service, calls } = fakeService(OK)
    const handler = createRpcFetchHandler(service)

    const response = await handler(request('not json'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request' },
    })
    expect(calls).toEqual([])
  })

  it('缺少 method 或 params 时返回 400 与 invalid-request', async () => {
    const { service } = fakeService(OK)
    const handler = createRpcFetchHandler(service)

    for (const body of [
      '{}',
      JSON.stringify({ method: 'snapshot.get' }),
      JSON.stringify({ params: {} }),
    ]) {
      const response = await handler(request(body))
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: { code: 'invalid-request' },
      })
    }
  })

  it('业务失败原样返回，HTTP 状态仍是 200', async () => {
    const failure: RpcResult<WorkspaceSnapshot> = {
      ok: false,
      error: { code: 'gh-missing', message: '未找到 gh' },
    }
    const { service } = fakeService(failure)
    const handler = createRpcFetchHandler(service)

    const response = await handler(
      request(JSON.stringify({ method: 'snapshot.get', params: { workspaceRoot: '/repo' } })),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(failure)
  })
})
