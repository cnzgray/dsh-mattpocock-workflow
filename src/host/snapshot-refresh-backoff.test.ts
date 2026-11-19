import { describe, expect, it } from 'vitest'

import { TrackerError } from '../core/tracker-error.ts'
import type { TrackerChanges } from '../core/ticket.ts'
import {
  ROOT,
  expectFull,
  memoryStore,
  serviceWith,
  snapshot,
  storedEntry,
} from './snapshot-service-test-support.ts'

describe('刷新合流与失败退避', () => {
  it('同工作区的并发刷新合并成一次后端调用', async () => {
    const gate = Promise.withResolvers<TrackerChanges>()
    const store = memoryStore([storedEntry()])
    const { service, changeCalls } = serviceWith([snapshot()], 'github', undefined, {
      store,
      now: () => 1_000,
      changes: () => gate.promise,
    })

    const first = service.refresh({ workspaceRoot: ROOT })
    const second = service.refresh({ workspaceRoot: ROOT })
    expect(second).toBe(first)

    gate.resolve({ tickets: [], hierarchy: 'native', truncated: false, total: 30 })
    const firstResult = await first
    expect(await second).toEqual(firstResult)
    expect(changeCalls).toHaveLength(1)
  })

  it('连续失败后进入冷却：冷却期内不打后端，回包说明在退避并保留旧数据', async () => {
    let clock = 1_000
    const store = memoryStore([storedEntry()])
    const { service, changeCalls } = serviceWith([snapshot(), snapshot()], 'github', undefined, {
      store,
      now: () => clock,
      changes: () => Promise.reject(new TrackerError('fetch-failed', '网络断了')),
    })

    // 第一次就失败：保留库里的数据并标 stale。
    const first = expectFull(await service.refresh({ workspaceRoot: ROOT }))
    expect(first.stale).toBe(true)
    expect(changeCalls).toHaveLength(1)

    clock = 2_000
    const cooling = expectFull(await service.refresh({ workspaceRoot: ROOT }))
    expect(changeCalls).toHaveLength(1)
    expect(cooling.stale).toBe(true)
    expect(cooling.refreshError?.message).toContain('退避')
  })

  it('冷却到期放行一次试探，再失败按新的更长的冷却挡住', async () => {
    let clock = 1_000
    const store = memoryStore([storedEntry()])
    const { service, changeCalls } = serviceWith([snapshot(), snapshot()], 'github', undefined, {
      store,
      now: () => clock,
      changes: () => Promise.reject(new TrackerError('fetch-failed', '网络断了')),
    })

    await service.refresh({ workspaceRoot: ROOT })
    clock = 7_000
    await service.refresh({ workspaceRoot: ROOT })
    expect(changeCalls).toHaveLength(2)

    // 第二次失败冷却拉长到 10 秒：7_000 + 10_000 = 17_000，期间不再打后端。
    clock = 8_000
    const blocked = expectFull(await service.refresh({ workspaceRoot: ROOT }))
    expect(changeCalls).toHaveLength(2)
    expect(blocked.refreshError?.message).toContain('退避')
  })

  it('成功一次立刻归零：之后的失败重新从起步冷却算起', async () => {
    let clock = 1_000
    let fail = true
    const store = memoryStore([storedEntry()])
    const { service, changeCalls } = serviceWith(
      [snapshot(), snapshot(), snapshot(), snapshot()],
      'github',
      undefined,
      {
        store,
        now: () => clock,
        changes: () =>
          fail
            ? Promise.reject(new TrackerError('fetch-failed', '网络断了'))
            : Promise.resolve({ tickets: [], hierarchy: 'native', truncated: false, total: 30 }),
      },
    )

    await service.refresh({ workspaceRoot: ROOT })
    clock = 7_000
    fail = false
    const recovered = expectFull(await service.refresh({ workspaceRoot: ROOT }))
    expect(changeCalls).toHaveLength(2)
    expect(recovered.stale).toBe(false)

    // 成功后归零：这次失败只挡 5 秒，不是连续第二档的 10 秒。
    fail = true
    await service.refresh({ workspaceRoot: ROOT })
    clock += 6_000
    await service.refresh({ workspaceRoot: ROOT })
    expect(changeCalls).toHaveLength(4)
  })

  it('限流错误带服务端等待时长：按它而不是指数退避决定冷却', async () => {
    let clock = 1_000
    const store = memoryStore([storedEntry()])
    const { service, changeCalls } = serviceWith(
      [snapshot(), snapshot(), snapshot()],
      'github',
      undefined,
      {
        store,
        now: () => clock,
        changes: () =>
          Promise.reject(new TrackerError('rate-limited', '限流中', undefined, 20_000)),
      },
    )

    await service.refresh({ workspaceRoot: ROOT })

    // 指数退避只会挡 5 秒；服务端要求 20 秒，5 秒时仍在冷却。
    clock = 6_000
    await service.refresh({ workspaceRoot: ROOT })
    expect(changeCalls).toHaveLength(1)

    clock = 21_000
    await service.refresh({ workspaceRoot: ROOT })
    expect(changeCalls).toHaveLength(2)
  })

  it('手动全量刷新是人的动作：冷却中也直接打后端', async () => {
    let clock = 1_000
    const store = memoryStore([storedEntry()])
    const { service, changeCalls, snapshotCalls } = serviceWith(
      [snapshot(), snapshot()],
      'github',
      undefined,
      {
        store,
        now: () => clock,
        changes: () => Promise.reject(new TrackerError('fetch-failed', '网络断了')),
      },
    )

    await service.refresh({ workspaceRoot: ROOT })
    clock = 2_000
    const manual = expectFull(await service.refresh({ workspaceRoot: ROOT, full: true }))
    expect(changeCalls).toHaveLength(1)
    expect(snapshotCalls).toHaveLength(1)
    expect(manual.stale).toBe(false)
  })
})
