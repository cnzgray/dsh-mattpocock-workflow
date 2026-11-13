import { describe, expect, it } from 'vitest'

import type { TicketSnapshot } from '../protocol/tracker.ts'
import { tierLevel, updateAgeBuckets, weeklyFlow } from './overview-chart-data.ts'

const NOW = Date.parse('2026-11-13T00:00:00Z')

function ticket(overrides: Partial<TicketSnapshot>): TicketSnapshot {
  return {
    ref: '#1',
    number: 1,
    title: '票',
    state: 'open',
    category: null,
    status: 'open',
    labels: [],
    author: null,
    skillAction: 'none',
    skillActionReason: 'untriaged',
    createdAt: '2026-11-12T00:00:00Z',
    updatedAt: '2026-11-12T00:00:00Z',
    openBlockers: 0,
    ...overrides,
  }
}

describe('weeklyFlow', () => {
  it('把新开与关闭分到对应的周里，最后一周截止到现在', () => {
    const buckets = weeklyFlow(
      [
        ticket({ createdAt: '2026-11-12T00:00:00Z' }),
        ticket({ createdAt: '2026-11-01T00:00:00Z' }),
        ticket({
          state: 'closed',
          status: 'closed',
          createdAt: '2026-11-11T00:00:00Z',
          closedAt: '2026-11-12T00:00:00Z',
        }),
      ],
      NOW,
      { weeks: 4, closedAvailable: true },
    )

    expect(buckets).toHaveLength(4)
    expect(buckets.map((bucket) => bucket.opened)).toEqual([0, 0, 1, 2])
    expect(buckets.map((bucket) => bucket.closed)).toEqual([0, 0, 0, 1])
    expect(buckets[3]?.end).toBe(NOW)
  })

  it('窗口之外的票不计入', () => {
    const buckets = weeklyFlow([ticket({ createdAt: '2026-01-01T00:00:00Z' })], NOW, {
      weeks: 2,
      closedAvailable: true,
    })

    expect(buckets.every((bucket) => bucket.opened === 0)).toBe(true)
  })

  it('关闭时间不可用时关闭数为 null', () => {
    const buckets = weeklyFlow([ticket({})], NOW, { weeks: 2, closedAvailable: false })

    expect(buckets.map((bucket) => bucket.closed)).toEqual([null, null])
  })
})

describe('updateAgeBuckets', () => {
  it('只统计开放票，按距上次更新的天数分档', () => {
    const buckets = updateAgeBuckets(
      [
        ticket({ updatedAt: '2026-11-12T00:00:00Z' }),
        ticket({ updatedAt: '2026-11-03T00:00:00Z' }),
        ticket({ updatedAt: '2026-10-20T00:00:00Z' }),
        ticket({ updatedAt: '2026-09-01T00:00:00Z' }),
        ticket({ updatedAt: '2026-09-01T00:00:00Z', state: 'closed', status: 'closed' }),
      ],
      NOW,
    )

    expect(buckets.map((bucket) => [bucket.key, bucket.count])).toEqual([
      ['week', 1],
      ['fortnight', 1],
      ['month', 1],
      ['older', 1],
    ])
  })
})

describe('tierLevel', () => {
  it('档位越重点亮越多格，不可用时一格不亮', () => {
    expect([tierLevel(null), tierLevel('light'), tierLevel('normal'), tierLevel('tight')]).toEqual([
      0, 1, 2, 3,
    ])
  })
})
