import { describe, expect, it } from 'vitest'

import { categorize, classify, classifyTickets } from './classify.ts'
import type { Ticket, TicketLabelNames } from './ticket.ts'

const NAMES: TicketLabelNames = {
  readyForAgent: 'ready-for-agent',
  bug: 'bug',
  enhancement: 'enhancement',
}

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    number: 1,
    title: '一张票',
    state: 'open',
    labels: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    openBlockers: 0,
    ...overrides,
  }
}

describe('工单判定', () => {
  it('已关闭的票优先判为已关闭，即使带可接标签', () => {
    expect(classify(ticket({ state: 'closed', labels: ['ready-for-agent'] }), NAMES)).toBe('closed')
  })

  it('开放且没有未关闭阻塞、带可接标签的票判为可接', () => {
    expect(classify(ticket({ labels: ['enhancement', 'ready-for-agent'] }), NAMES)).toBe('ready')
  })

  it('开放但有未关闭阻塞的票判为阻塞，不论带什么状态标签', () => {
    expect(classify(ticket({ labels: ['ready-for-agent'], openBlockers: 1 }), NAMES)).toBe(
      'blocked',
    )
  })

  it('开放、无阻塞、没有可接标签的票判为其他开放', () => {
    expect(classify(ticket({ labels: ['bug'] }), NAMES)).toBe('open')
  })

  it('阻塞数只统计未关闭的票，0 表示可以开工', () => {
    expect(classify(ticket({ openBlockers: 0 }), NAMES)).toBe('open')
    expect(classify(ticket({ openBlockers: 2 }), NAMES)).toBe('blocked')
  })
})

describe('工单分类', () => {
  it('取 bug 标签', () => {
    expect(categorize(['bug', 'needs-triage'], NAMES)).toBe('bug')
  })

  it('取 enhancement 标签', () => {
    expect(categorize(['enhancement'], NAMES)).toBe('enhancement')
  })

  it('同时带两个分类标签时以 bug 优先', () => {
    expect(categorize(['enhancement', 'bug'], NAMES)).toBe('bug')
  })

  it('没有分类标签时返回 null', () => {
    expect(categorize(['needs-triage'], NAMES)).toBeNull()
  })
})

describe('批量判定', () => {
  it('保持输入顺序并给每张票附上分类与状态', () => {
    const result = classifyTickets(
      [
        ticket({ number: 2, labels: ['bug', 'ready-for-agent'] }),
        ticket({ number: 1, state: 'closed', labels: ['enhancement'] }),
      ],
      NAMES,
    )

    expect(result.map((item) => [item.number, item.category, item.status])).toEqual([
      [2, 'bug', 'ready'],
      [1, 'enhancement', 'closed'],
    ])
  })
})
