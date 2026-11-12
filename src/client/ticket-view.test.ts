import { describe, expect, it } from 'vitest'

import type { TicketSnapshot } from '../protocol/tracker.ts'
import { countTickets, filterTickets, sortTickets } from './ticket-view.ts'

function ticket(
  overrides: Partial<TicketSnapshot> & Pick<TicketSnapshot, 'number'>,
): TicketSnapshot {
  const number = overrides.number
  return {
    ref: number === null ? '.scratch/feature/issues/01-ticket.md' : `#${String(number)}`,
    title: `票 ${String(number)}`,
    state: 'open',
    category: null,
    status: 'open',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    openBlockers: 0,
    ...overrides,
  }
}

const TICKETS: readonly TicketSnapshot[] = [
  ticket({
    number: 1,
    title: 'Bravo',
    status: 'ready',
    category: 'enhancement',
    updatedAt: '2026-01-05T00:00:00Z',
  }),
  ticket({
    number: 2,
    title: 'Alpha',
    status: 'blocked',
    category: 'bug',
    openBlockers: 1,
    updatedAt: '2026-01-03T00:00:00Z',
  }),
  ticket({
    number: 3,
    title: 'Charlie',
    state: 'closed',
    status: 'closed',
    category: 'bug',
    updatedAt: '2026-01-04T00:00:00Z',
  }),
  ticket({ number: 4, title: 'Delta', status: 'open', updatedAt: '2026-01-02T00:00:00Z' }),
  ticket({
    number: 5,
    title: 'Echo',
    status: 'ready',
    category: 'enhancement',
    updatedAt: '2026-01-01T00:00:00Z',
  }),
]

describe('工单统计', () => {
  it('只统计可接、阻塞与已关闭', () => {
    expect(countTickets(TICKETS)).toEqual({ ready: 2, blocked: 1, closed: 1 })
  })

  it('空列表返回全零', () => {
    expect(countTickets([])).toEqual({ ready: 0, blocked: 0, closed: 0 })
  })
})

describe('工单过滤', () => {
  it('全部保持原顺序', () => {
    expect(filterTickets(TICKETS, 'all').map((item) => item.number)).toEqual([1, 2, 3, 4, 5])
  })

  it('Open 包含可接、阻塞与其他开放', () => {
    expect(filterTickets(TICKETS, 'open').map((item) => item.number)).toEqual([1, 2, 4, 5])
  })

  it('已关闭只保留 closed', () => {
    expect(filterTickets(TICKETS, 'closed').map((item) => item.number)).toEqual([3])
  })

  it('阻塞只保留 blocked', () => {
    expect(filterTickets(TICKETS, 'blocked').map((item) => item.number)).toEqual([2])
  })

  it('可接只保留 ready', () => {
    expect(filterTickets(TICKETS, 'ready').map((item) => item.number)).toEqual([1, 5])
  })
})

describe('工单排序', () => {
  it('按更新时间升序', () => {
    expect(sortTickets(TICKETS, 'updated', 'asc').map((item) => item.number)).toEqual([
      5, 4, 2, 3, 1,
    ])
  })

  it('按更新时间降序', () => {
    expect(sortTickets(TICKETS, 'updated', 'desc').map((item) => item.number)).toEqual([
      1, 3, 2, 4, 5,
    ])
  })

  it('按编号排序', () => {
    expect(sortTickets(TICKETS, 'number', 'asc').map((item) => item.number)).toEqual([
      1, 2, 3, 4, 5,
    ])
  })

  it('按编号排序时数字编号在前，本地路径按 ref 字典序排在后', () => {
    const list = [
      ticket({ number: null, ref: '.scratch/b/issues/01-b.md', title: 'B' }),
      ticket({ number: 3, title: 'C' }),
      ticket({ number: 1, title: 'A' }),
      ticket({ number: null, ref: '.scratch/a/issues/02-a.md', title: 'D' }),
    ]

    expect(sortTickets(list, 'number', 'asc').map((item) => item.ref)).toEqual([
      '#1',
      '#3',
      '.scratch/a/issues/02-a.md',
      '.scratch/b/issues/01-b.md',
    ])
    expect(sortTickets(list, 'number', 'desc').map((item) => item.ref)).toEqual([
      '#3',
      '#1',
      '.scratch/b/issues/01-b.md',
      '.scratch/a/issues/02-a.md',
    ])
  })

  it('按标题排序', () => {
    expect(sortTickets(TICKETS, 'title', 'asc').map((item) => item.title)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
      'Delta',
      'Echo',
    ])
  })

  it('按创建时间排序', () => {
    const list = [
      ticket({ number: 1, createdAt: '2026-02-01T00:00:00Z' }),
      ticket({ number: 2, createdAt: '2026-01-01T00:00:00Z' }),
    ]

    expect(sortTickets(list, 'created', 'asc').map((item) => item.number)).toEqual([2, 1])
  })

  it('排序不修改输入数组', () => {
    const original = [...TICKETS]
    sortTickets(TICKETS, 'title', 'asc')

    expect(TICKETS).toEqual(original)
  })
})
