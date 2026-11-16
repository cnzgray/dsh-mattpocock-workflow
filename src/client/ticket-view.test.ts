import { describe, expect, it } from 'vitest'

import type { TicketSnapshot } from '../protocol/tracker.ts'
import {
  countMyTickets,
  countTickets,
  defaultSortDirection,
  filterMyTickets,
  filterTickets,
  sortTickets,
} from './ticket-view.ts'

function author(login: string): TicketSnapshot['author'] {
  return { login, displayName: null, avatarUrl: null }
}

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
    skillAction: 'triage',
    skillActionReason: 'untriaged',
    labels: [],
    author: null,
    assignees: [],
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

describe('人员筛选', () => {
  const ALICE = 'alice'
  const PEOPLE: readonly TicketSnapshot[] = [
    ticket({
      number: 1,
      title: '分配给我',
      status: 'ready',
      assignees: [ALICE],
      author: author('bob'),
    }),
    ticket({
      number: 2,
      title: '我创建的',
      status: 'blocked',
      assignees: ['bob'],
      author: author('ALICE'),
    }),
    ticket({
      number: 3,
      title: '两者都是',
      status: 'closed',
      state: 'closed',
      assignees: [ALICE, 'bob'],
      author: author(ALICE),
    }),
    ticket({ number: 4, title: '都与我无关', assignees: [], author: null }),
  ]

  it('只开分配给我时只看分配人里有我', () => {
    expect(
      filterMyTickets(PEOPLE, { assignedToMe: true, createdByMe: false }, ALICE).map(
        (item) => item.number,
      ),
    ).toEqual([1, 3])
  })

  it('只开我创建时只看创建人是我', () => {
    expect(
      filterMyTickets(PEOPLE, { assignedToMe: false, createdByMe: true }, ALICE).map(
        (item) => item.number,
      ),
    ).toEqual([2, 3])
  })

  it('两个都开时取并集', () => {
    expect(
      filterMyTickets(PEOPLE, { assignedToMe: true, createdByMe: true }, ALICE).map(
        (item) => item.number,
      ),
    ).toEqual([1, 2, 3])
  })

  it('两个都关时不按人员过滤', () => {
    expect(
      filterMyTickets(PEOPLE, { assignedToMe: false, createdByMe: false }, ALICE).map(
        (item) => item.number,
      ),
    ).toEqual([1, 2, 3, 4])
  })

  it('与状态筛选交叉生效，先状态后人员', () => {
    const open = filterTickets(PEOPLE, 'open')

    expect(
      filterMyTickets(open, { assignedToMe: true, createdByMe: false }, ALICE).map(
        (item) => item.number,
      ),
    ).toEqual([1])
    expect(
      filterMyTickets(open, { assignedToMe: false, createdByMe: true }, ALICE).map(
        (item) => item.number,
      ),
    ).toEqual([2])
    expect(
      filterMyTickets(open, { assignedToMe: true, createdByMe: true }, ALICE).map(
        (item) => item.number,
      ),
    ).toEqual([1, 2])
  })

  it('当前用户为 null 时忽略人员开关', () => {
    expect(
      filterMyTickets(PEOPLE, { assignedToMe: true, createdByMe: true }, null).map(
        (item) => item.number,
      ),
    ).toEqual([1, 2, 3, 4])
  })

  it('登录名比较不区分大小写', () => {
    expect(
      filterMyTickets(PEOPLE, { assignedToMe: false, createdByMe: true }, 'aLiCe').map(
        (item) => item.number,
      ),
    ).toEqual([2, 3])
  })

  it('创建人为 null 或分配人为空时不算我的票', () => {
    const counts = countMyTickets(
      [PEOPLE[1], PEOPLE[3]].filter((item) => item !== undefined),
      ALICE,
    )

    expect(counts).toEqual({ assignedToMe: 0, createdByMe: 1 })
  })

  it('计数按传入集合计算，两个角色互不影响', () => {
    expect(countMyTickets(PEOPLE, ALICE)).toEqual({ assignedToMe: 2, createdByMe: 2 })
    expect(countMyTickets([...PEOPLE], null)).toEqual({ assignedToMe: 0, createdByMe: 0 })
  })

  it('计数只覆盖当前状态筛选后的集合', () => {
    const open = filterTickets(PEOPLE, 'open')

    expect(countMyTickets(open, ALICE)).toEqual({ assignedToMe: 1, createdByMe: 1 })
  })

  it('筛选不修改输入数组', () => {
    const original = [...PEOPLE]

    filterMyTickets(PEOPLE, { assignedToMe: true, createdByMe: true }, ALICE)

    expect(PEOPLE).toEqual(original)
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

describe('状态排序', () => {
  it('按可接、阻塞、其他开放、已关闭分组，组内按编号升序', () => {
    expect(sortTickets(TICKETS, 'status', 'asc').map((item) => item.number)).toEqual([
      1, 5, 2, 4, 3,
    ])
  })

  it('降序翻转状态分组，组内方向同样翻转', () => {
    expect(sortTickets(TICKETS, 'status', 'desc').map((item) => item.number)).toEqual([
      3, 4, 2, 5, 1,
    ])
  })

  it('同组内本地 Markdown 工单排在数字工单之后，降序也不翻到前面', () => {
    const list = [
      ticket({ number: null, ref: '.scratch/b/docs/01-b.md', status: 'ready' }),
      ticket({ number: 7, status: 'ready' }),
      ticket({ number: 2, status: 'ready' }),
      ticket({ number: 9, status: 'blocked' }),
    ]

    expect(sortTickets(list, 'status', 'asc').map((item) => item.ref)).toEqual([
      '#2',
      '#7',
      '.scratch/b/docs/01-b.md',
      '#9',
    ])
    expect(sortTickets(list, 'status', 'desc').map((item) => item.ref)).toEqual([
      '#9',
      '#7',
      '#2',
      '.scratch/b/docs/01-b.md',
    ])
  })

  it('新增状态排序不改变既有排序键的结果', () => {
    expect(sortTickets(TICKETS, 'updated', 'desc').map((item) => item.number)).toEqual([
      1, 3, 2, 4, 5,
    ])
    expect(sortTickets(TICKETS, 'created', 'desc').map((item) => item.number)).toEqual([
      1, 2, 3, 4, 5,
    ])
    expect(sortTickets(TICKETS, 'title', 'asc').map((item) => item.title)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
      'Delta',
      'Echo',
    ])
  })
})

describe('切换排序键的默认方向', () => {
  it('标题与状态用升序，编号、创建与更新用降序', () => {
    expect(defaultSortDirection('title')).toBe('asc')
    expect(defaultSortDirection('status')).toBe('asc')
    expect(defaultSortDirection('number')).toBe('desc')
    expect(defaultSortDirection('created')).toBe('desc')
    expect(defaultSortDirection('updated')).toBe('desc')
  })
})
