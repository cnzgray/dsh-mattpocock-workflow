import { describe, expect, it } from 'vitest'

import type { Ticket } from './ticket.ts'
import { mergeNativeBlockers } from './blockers.ts'

function ticket(overrides: Partial<Ticket>): Ticket {
  return {
    ref: '#1',
    number: 1,
    title: '一张票',
    state: 'open',
    labels: ['ready-for-agent'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    openBlockers: 0,
    ...overrides,
  }
}

describe('原生阻塞数合并', () => {
  it('原生计数大于 0 时覆盖描述回退', () => {
    const merged = mergeNativeBlockers([ticket({ ref: '#2', number: 2 })], new Map([['#2', 3]]))

    expect(merged[0]?.openBlockers).toBe(3)
  })

  it('原生计数为 0 时保留描述回退', () => {
    const merged = mergeNativeBlockers(
      [ticket({ ref: '#3', number: 3, openBlockers: 2 })],
      new Map([['#3', 0]]),
    )

    expect(merged[0]?.openBlockers).toBe(2)
  })

  it('原生结果缺少某张票时保留列表阶段的值', () => {
    const merged = mergeNativeBlockers(
      [ticket({ ref: '#4', number: 4, openBlockers: 1 })],
      new Map(),
    )

    expect(merged[0]?.openBlockers).toBe(1)
  })

  it('已关闭票保持原样', () => {
    const closed = ticket({ ref: '#5', number: 5, state: 'closed', openBlockers: 4 })
    const merged = mergeNativeBlockers([closed], new Map([['#5', 7]]))

    expect(merged[0]).toBe(closed)
  })

  it('保持输入顺序，不修改原对象', () => {
    const first = ticket({ ref: '#1', number: 1 })
    const second = ticket({ ref: '#2', number: 2 })

    const merged = mergeNativeBlockers([first, second], new Map([['#1', 1]]))

    expect(merged.map((item) => item.ref)).toEqual(['#1', '#2'])
    expect(first.openBlockers).toBe(0)
    expect(merged[0]).not.toBe(first)
  })
})
