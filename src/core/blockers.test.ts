import { describe, expect, it } from 'vitest'

import { mergeNativeBlockers } from './blockers.ts'
import type { BlockerResolution, Ticket } from './ticket.ts'

function ticket(overrides: Partial<Ticket>): Ticket {
  return {
    ref: '#1',
    number: 1,
    title: '一张票',
    state: 'open',
    labels: ['ready-for-agent'],
    author: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    openBlockers: 0,
    ...overrides,
  }
}

function native(
  open: readonly (readonly [string, number])[] = [],
  blockedBy: readonly (readonly [string, readonly string[]])[] = [],
): BlockerResolution {
  return { open: new Map(open), blockedBy: new Map(blockedBy) }
}

describe('原生阻塞信息合并', () => {
  it('原生计数大于 0 时覆盖描述回退，引用也换成原生结果', () => {
    const merged = mergeNativeBlockers(
      [ticket({ ref: '#2', number: 2, blockedBy: ['#1'] })],
      native([['#2', 3]], [['#2', ['#1', '#4']]]),
    )

    expect(merged[0]).toMatchObject({ openBlockers: 3, blockedBy: ['#1', '#4'] })
  })

  it('原生计数为 0 时保留描述回退，但非空引用仍覆盖', () => {
    const merged = mergeNativeBlockers(
      [ticket({ ref: '#3', number: 3, openBlockers: 2, blockedBy: ['#1'] })],
      native([['#3', 0]], [['#3', ['#2']]]),
    )

    expect(merged[0]).toMatchObject({ openBlockers: 2, blockedBy: ['#2'] })
  })

  it('原生结果缺少某张票时保留列表阶段的值', () => {
    const merged = mergeNativeBlockers(
      [ticket({ ref: '#4', number: 4, openBlockers: 1, blockedBy: ['#1'] })],
      native(),
    )

    expect(merged[0]).toMatchObject({ openBlockers: 1, blockedBy: ['#1'] })
  })

  it('已关闭票保持原样', () => {
    const closed = ticket({ ref: '#5', number: 5, state: 'closed', openBlockers: 4 })
    const merged = mergeNativeBlockers([closed], native([['#5', 7]], [['#5', ['#1']]]))

    expect(merged[0]).toBe(closed)
  })

  it('保持输入顺序，不修改原对象', () => {
    const first = ticket({ ref: '#1', number: 1 })
    const second = ticket({ ref: '#2', number: 2 })

    const merged = mergeNativeBlockers([first, second], native([['#1', 1]]))

    expect(merged.map((item) => item.ref)).toEqual(['#1', '#2'])
    expect(first.openBlockers).toBe(0)
    expect(merged[0]).not.toBe(first)
  })
})
