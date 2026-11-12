import { describe, expect, it } from 'vitest'

import { RPC_PATH, type RpcResult, type WorkspaceSnapshot } from '../protocol/tracker.ts'
import { createSnapshotClient, type FetchLike, type HttpResponseLike } from './rpc.ts'

const SNAPSHOT: WorkspaceSnapshot = {
  repository: 'cnzgray/dsh-mattpocock-workflow',
  fetchedAt: 1,
  loaded: 0,
  total: 0,
  tickets: [],
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
    const client = createSnapshotClient(fetchImpl)

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
    const client = createSnapshotClient(fetchImpl)

    await client.refresh('/repo')

    expect(JSON.parse(calls[0]?.body ?? '{}')).toMatchObject({ method: 'snapshot.refresh' })
  })

  it('成功响应原样返回', async () => {
    const expected: RpcResult<WorkspaceSnapshot> = { ok: true, result: SNAPSHOT }
    const client = createSnapshotClient(recordingFetch(response(expected)).fetchImpl)

    await expect(client.get('/repo')).resolves.toEqual(expected)
  })

  it('HTTP 非 2xx 返回 fetch-failed', async () => {
    const client = createSnapshotClient(recordingFetch(response({}, false, 502)).fetchImpl)

    await expect(client.get('/repo')).resolves.toMatchObject({
      ok: false,
      error: { code: 'fetch-failed', message: expect.stringContaining('HTTP 502') as string },
    })
  })

  it('响应体不是快照结果时返回 fetch-failed', async () => {
    const client = createSnapshotClient(
      recordingFetch(response({ ok: true, result: {} })).fetchImpl,
    )

    await expect(client.get('/repo')).resolves.toMatchObject({
      ok: false,
      error: { code: 'fetch-failed' },
    })
  })

  it('网络异常返回 fetch-failed 并保留原因', async () => {
    const client = createSnapshotClient(() => Promise.reject(new Error('offline')))

    await expect(client.get('/repo')).resolves.toMatchObject({
      ok: false,
      error: { code: 'fetch-failed', message: expect.stringContaining('offline') as string },
    })
  })
})
