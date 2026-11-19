import { describe, expect, it } from 'vitest'

import { createRefreshGuard } from './refresh-guard.ts'

describe('刷新退避闸门', () => {
  it('初次失败进入起步时长的冷却', () => {
    const guard = createRefreshGuard({ baseMs: 1_000, maxMs: 8_000 })

    expect(guard.noteFailure('w', 5_000)).toBe(6_000)
    expect(guard.blockedUntil('w', 5_999)).toBe(6_000)
    expect(guard.blockedUntil('w', 6_000)).toBeNull()
  })

  it('连续失败按指数拉长冷却并封顶', () => {
    const guard = createRefreshGuard({ baseMs: 1_000, maxMs: 8_000 })

    expect(guard.noteFailure('w', 0)).toBe(1_000)
    expect(guard.noteFailure('w', 0)).toBe(2_000)
    expect(guard.noteFailure('w', 0)).toBe(4_000)
    expect(guard.noteFailure('w', 0)).toBe(8_000)
    expect(guard.noteFailure('w', 0)).toBe(8_000)
    expect(guard.view('w').failuresSinceSuccess).toBe(5)
  })

  it('服务端给的 retryAfterMs 覆盖指数退避但仍受上限约束', () => {
    const guard = createRefreshGuard({ baseMs: 1_000, maxMs: 8_000 })

    expect(guard.noteFailure('w', 0, 500)).toBe(500)
    expect(guard.noteFailure('w', 0, 99_999)).toBe(8_000)
  })

  it('冷却到期放行一次试探，成功一次立刻归零', () => {
    const guard = createRefreshGuard({ baseMs: 1_000, maxMs: 8_000 })

    guard.noteFailure('w', 0)
    expect(guard.blockedUntil('w', 1_000)).toBeNull()
    guard.noteSuccess('w')
    expect(guard.view('w')).toEqual({ failuresSinceSuccess: 0, coolingUntil: 0 })
  })

  it('冷却期内的反复查询不改变状态，也不延长冷却', () => {
    const guard = createRefreshGuard({ baseMs: 1_000, maxMs: 8_000 })

    guard.noteFailure('w', 0)
    guard.blockedUntil('w', 500)
    guard.blockedUntil('w', 900)
    expect(guard.blockedUntil('w', 999)).toBe(1_000)
    expect(guard.view('w').failuresSinceSuccess).toBe(1)
  })

  it('各工作区的失败计数互不影响', () => {
    const guard = createRefreshGuard({ baseMs: 1_000, maxMs: 8_000 })

    guard.noteFailure('a', 0)
    expect(guard.blockedUntil('b', 0)).toBeNull()
    guard.noteSuccess('a')
    expect(guard.blockedUntil('a', 0)).toBeNull()
  })
})
