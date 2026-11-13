import { describe, expect, it } from 'vitest'

import { mapWithConcurrency } from './concurrency.ts'

describe('并发映射', () => {
  it('限制同时在跑的任务数并保持输入顺序', async () => {
    let active = 0
    let peak = 0
    const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      active += 1
      peak = Math.max(peak, active)
      await Promise.resolve()
      active -= 1
      return item * 2
    })

    expect(results).toEqual([2, 4, 6, 8, 10])
    expect(peak).toBe(2)
  })

  it('一个任务失败后不再启动新任务，并抛出该错误', async () => {
    const started: number[] = []

    await expect(
      mapWithConcurrency([1, 2, 3], 1, (item) => {
        started.push(item)
        return item === 2 ? Promise.reject(new Error('boom')) : Promise.resolve(item)
      }),
    ).rejects.toThrow('boom')

    expect(started).toEqual([1, 2])
  })

  it('空输入直接返回空结果', async () => {
    expect(await mapWithConcurrency([], 4, () => Promise.resolve(0))).toEqual([])
  })
})
