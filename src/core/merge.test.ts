import { describe, expect, it } from 'vitest'

import { mergeTickets } from './merge.ts'
import type { Ticket } from './ticket.ts'

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    ref: '#1',
    number: 1,
    title: '一张票',
    state: 'open',
    labels: [],
    author: null,
    assignees: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    openBlockers: 0,
    ...overrides,
  }
}

function refs(tickets: readonly Ticket[]): readonly string[] {
  return tickets.map((item) => item.ref)
}

describe('增量合并', () => {
  it('窗口没提到的票原样保留', () => {
    const merged = mergeTickets(
      [ticket({ ref: '#1' }), ticket({ ref: '#2' })],
      [ticket({ ref: '#2', title: '改过的票' })],
    )

    expect(refs(merged)).toEqual(['#1', '#2'])
    expect(merged[1]?.title).toBe('改过的票')
  })

  it('窗口里的新票追加进来', () => {
    const merged = mergeTickets([ticket({ ref: '#1' })], [ticket({ ref: '#9' })])

    expect(refs(merged)).toEqual(['#1', '#9'])
  })

  it('同一张票取更新时间较新的一份', () => {
    const merged = mergeTickets(
      [ticket({ ref: '#1', title: '旧标题', updatedAt: '2026-01-01T00:00:00Z' })],
      [ticket({ ref: '#1', title: '新标题', updatedAt: '2026-02-01T00:00:00Z' })],
    )

    expect(merged).toHaveLength(1)
    expect(merged[0]?.title).toBe('新标题')
  })

  it('窗口里的票更旧时保留原来那份', () => {
    const merged = mergeTickets(
      [ticket({ ref: '#1', title: '新标题', updatedAt: '2026-02-01T00:00:00Z' })],
      [ticket({ ref: '#1', title: '旧标题', updatedAt: '2026-01-01T00:00:00Z' })],
    )

    expect(merged[0]?.title).toBe('新标题')
  })

  it('关闭状态以窗口返回的为准', () => {
    const merged = mergeTickets(
      [ticket({ ref: '#1', state: 'open', updatedAt: '2026-01-01T00:00:00Z' })],
      [ticket({ ref: '#1', state: 'closed', updatedAt: '2026-02-01T00:00:00Z' })],
    )

    expect(merged[0]?.state).toBe('closed')
  })

  it('给了上限时按更新时间倒序裁到窗口大小', () => {
    const merged = mergeTickets(
      [
        ticket({ ref: '#1', updatedAt: '2026-01-01T00:00:00Z' }),
        ticket({ ref: '#2', updatedAt: '2026-03-01T00:00:00Z' }),
      ],
      [ticket({ ref: '#3', updatedAt: '2026-02-01T00:00:00Z' })],
      2,
    )

    expect(refs(merged)).toEqual(['#2', '#3'])
  })

  it('合并结果与全量重拉的票集合一致', () => {
    const full = [
      ticket({ ref: '#1', updatedAt: '2026-03-01T00:00:00Z' }),
      ticket({ ref: '#2', updatedAt: '2026-02-01T00:00:00Z' }),
      ticket({ ref: '#3', updatedAt: '2026-01-01T00:00:00Z' }),
    ]
    const base = [full[0], full[2]].filter((item): item is Ticket => item !== undefined)
    const changes = [full[1]].filter((item): item is Ticket => item !== undefined)

    const merged = mergeTickets(base, changes, 3)

    expect([...refs(merged)].sort()).toEqual([...refs(full)].sort())
  })
})
