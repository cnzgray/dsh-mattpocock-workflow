import { describe, expect, it } from 'vitest'

import type { TimerLike } from './dsh-types.ts'
import { createProbeDeadline } from './probe-deadline.ts'

function fakeTimer(): TimerLike {
  return {
    timeout(callback, delay) {
      const id = setTimeout(callback, delay)
      return () => {
        clearTimeout(id)
      }
    },
  }
}

describe('探测超时', () => {
  it('任务按时完成时返回结果', async () => {
    const deadline = createProbeDeadline(fakeTimer(), 50)

    await expect(deadline(Promise.resolve('值'))).resolves.toEqual({ ok: true, value: '值' })
  })

  it('任务超时后返回超时结果，不再等待原任务', async () => {
    const deadline = createProbeDeadline(fakeTimer(), 5)

    await expect(deadline(new Promise<never>(() => undefined))).resolves.toEqual({ ok: false })
  })

  it('任务自身失败时把错误抛给调用方', async () => {
    const deadline = createProbeDeadline(fakeTimer(), 50)

    await expect(deadline(Promise.reject(new Error('探测坏了')))).rejects.toThrow('探测坏了')
  })
})
