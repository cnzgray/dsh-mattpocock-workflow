/**
 * 快照里的当前用户：全量、增量、缓存优先与扩窗之间如何传递、覆盖与沿用。
 * 与列表、阻塞和指标测试分开，避免单个测试文件继续变长。
 */
import { describe, expect, it } from 'vitest'

import {
  ROOT,
  expectOk,
  memoryStore,
  serviceWith,
  snapshot,
  storedEntry,
  ticket,
} from './snapshot-service-test-support.ts'

describe('快照身份', () => {
  it('实时快照把当前用户与每张票的分配人透传给界面', async () => {
    const withPeople = snapshot({
      viewer: 'cnzgray',
      tickets: [
        ticket({ number: 1, assignees: ['alice'] }),
        ticket({ number: 2, assignees: ['cnzgray', 'bob'] }),
      ],
    })
    const { service } = serviceWith([withPeople])

    const result = expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))

    expect(result.viewer).toBe('cnzgray')
    expect(result.tickets.map((item) => item.assignees)).toEqual([['alice'], ['cnzgray', 'bob']])
  })

  it('全量刷新返回 null 身份时沿用同一仓库上一次已知身份', async () => {
    const store = memoryStore([storedEntry({ viewer: 'cnzgray' })])
    const { service } = serviceWith([snapshot({ viewer: null })], 'github', undefined, { store })

    const result = expectOk(await service.handle('snapshot.refresh', { workspaceRoot: ROOT }))

    expect(result.viewer).toBe('cnzgray')
    expect(store.writes.at(-1)?.viewer).toBe('cnzgray')
  })

  it('全量刷新返回新身份时覆盖旧身份', async () => {
    const store = memoryStore([storedEntry({ viewer: 'old-user' })])
    const { service } = serviceWith([snapshot({ viewer: 'new-user' })], 'github', undefined, {
      store,
    })

    const result = expectOk(await service.handle('snapshot.refresh', { workspaceRoot: ROOT }))

    expect(result.viewer).toBe('new-user')
  })

  it('缓存里的身份随快照一起交给界面', async () => {
    const store = memoryStore([storedEntry({ viewer: 'cnzgray' })])
    const { service } = serviceWith([snapshot()], 'github', undefined, { store })

    const result = expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))

    expect(result.source).toBe('cache')
    expect(result.viewer).toBe('cnzgray')
  })

  it('增量带了新身份时更新快照与缓存', async () => {
    const store = memoryStore([
      storedEntry({
        backend: 'gitea',
        repositoryKey: 'gitea@github.com/cnzgray/repo',
        hierarchy: 'none',
      }),
    ])
    const { service } = serviceWith([snapshot()], 'gitea', undefined, {
      store,
      changes: () =>
        Promise.resolve({
          tickets: [],
          hierarchy: 'none',
          truncated: false,
          total: 30,
          viewer: 'new-user',
        }),
    })

    const result = expectOk(await service.handle('snapshot.refresh', { workspaceRoot: ROOT }))

    expect(result.viewer).toBe('new-user')
    expect(store.writes.at(-1)?.viewer).toBe('new-user')
  })

  it('增量没查身份时沿用基准数据里的身份', async () => {
    const store = memoryStore([
      storedEntry({
        backend: 'gitea',
        repositoryKey: 'gitea@github.com/cnzgray/repo',
        hierarchy: 'none',
      }),
    ])
    const { service } = serviceWith([snapshot()], 'gitea', undefined, {
      store,
      changes: () =>
        Promise.resolve({ tickets: [], hierarchy: 'none', truncated: false, total: 30 }),
    })

    const result = expectOk(await service.handle('snapshot.refresh', { workspaceRoot: ROOT }))

    expect(result.viewer).toBe('cnzgray')
  })

  it('增量明确返回无身份时把身份更新为 null', async () => {
    const store = memoryStore([
      storedEntry({
        backend: 'gitea',
        repositoryKey: 'gitea@github.com/cnzgray/repo',
        hierarchy: 'none',
      }),
    ])
    // 一次响应给 snapshot.get 校验仓库身份，一次给 refresh 解析后端。
    const { service } = serviceWith([snapshot(), snapshot()], 'gitea', undefined, {
      store,
      changes: () =>
        Promise.resolve({
          tickets: [],
          hierarchy: 'none',
          truncated: false,
          total: 30,
          viewer: null,
        }),
    })

    // 先把缓存身份显示出来，确认增量显式返回 null 时不会被旧身份覆盖。
    expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))
    const result = expectOk(await service.handle('snapshot.refresh', { workspaceRoot: ROOT }))

    expect(result.viewer).toBeNull()
    expect(store.writes.at(-1)?.viewer).toBeNull()
  })
})
