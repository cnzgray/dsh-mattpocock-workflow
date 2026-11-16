import { describe, expect, it } from 'vitest'

import type { TicketSnapshot } from '../protocol/tracker.ts'
import { buildTicketTree, expandAncestors, type TreeRow } from './ticket-tree.ts'

function ticket(ref: string, parent?: string): TicketSnapshot {
  return {
    ref,
    number: Number.parseInt(ref.replace(/^#/, ''), 10),
    title: `票 ${ref}`,
    state: 'open',
    category: null,
    status: 'open',
    labels: [],
    author: null,
    assignees: [],
    skillAction: 'none',
    skillActionReason: 'untriaged',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    openBlockers: 0,
    ...(parent === undefined ? {} : { parent }),
  }
}

function shape(rows: readonly TreeRow[]): readonly unknown[] {
  return rows.map((row) => [
    row.ticket.ref,
    row.depth,
    row.hasChildren,
    row.expanded,
    row.childCount,
    row.parentOutside,
  ])
}

describe('父子布局的树构建', () => {
  it('单层嵌套：子票缩进挂在父票下', () => {
    const rows = buildTicketTree([ticket('#1'), ticket('#2', '#1'), ticket('#3', '#1')], new Set())

    expect(shape(rows)).toEqual([
      ['#1', 0, true, true, 2, false],
      ['#2', 1, false, true, 0, false],
      ['#3', 1, false, true, 0, false],
    ])
  })

  it('多层嵌套逐层加深，父行统计全部后代', () => {
    const rows = buildTicketTree(
      [ticket('#1'), ticket('#2', '#1'), ticket('#3', '#2'), ticket('#4', '#3')],
      new Set(),
    )

    expect(rows.map((row) => [row.ticket.ref, row.depth])).toEqual([
      ['#1', 0],
      ['#2', 1],
      ['#3', 2],
      ['#4', 3],
    ])
    expect(rows[0]?.childCount).toBe(3)
    expect(rows[1]?.childCount).toBe(2)
  })

  it('顶层与兄弟都沿用输入的排序顺序', () => {
    const rows = buildTicketTree(
      [ticket('#2', '#1'), ticket('#1'), ticket('#4'), ticket('#3', '#1')],
      new Set(),
    )

    expect(rows.map((row) => row.ticket.ref)).toEqual(['#1', '#2', '#3', '#4'])
  })

  it('父级不在可见票里时升为顶层并标记父级不在列表', () => {
    const rows = buildTicketTree([ticket('#2', '#9')], new Set())

    expect(shape(rows)).toEqual([['#2', 0, false, true, 0, true]])
  })

  it('自引用按顶层行处理，不递归', () => {
    const rows = buildTicketTree([ticket('#1', '#1')], new Set())

    expect(shape(rows)).toEqual([['#1', 0, false, true, 0, false]])
  })

  it('两票成环时两张都提升为顶层，不丢票也不重复', () => {
    const rows = buildTicketTree([ticket('#1', '#2'), ticket('#2', '#1')], new Set())

    expect(rows.map((row) => row.ticket.ref)).toEqual(['#1', '#2'])
    expect(rows.every((row) => row.depth === 0)).toBe(true)
  })

  it('环外的子票仍挂在环上父票下，不会被连带提升', () => {
    const rows = buildTicketTree(
      [ticket('#1', '#2'), ticket('#2', '#1'), ticket('#3', '#2')],
      new Set(),
    )

    expect(rows.map((row) => [row.ticket.ref, row.depth])).toEqual([
      ['#1', 0],
      ['#2', 0],
      ['#3', 1],
    ])
  })

  it('收起父票后整棵子树不产生行', () => {
    const rows = buildTicketTree(
      [ticket('#1'), ticket('#2', '#1'), ticket('#3', '#2'), ticket('#4')],
      new Set(['#1']),
    )

    expect(rows.map((row) => [row.ticket.ref, row.expanded])).toEqual([
      ['#1', false],
      ['#4', true],
    ])
  })

  it('定位票的祖先链强制展开，其他折叠不受影响', () => {
    const rows = buildTicketTree(
      [ticket('#1'), ticket('#2', '#1'), ticket('#3', '#2'), ticket('#4')],
      new Set(['#1', '#4']),
      '#3',
    )

    expect(rows.map((row) => [row.ticket.ref, row.expanded])).toEqual([
      ['#1', true],
      ['#2', true],
      ['#3', true],
      ['#4', true],
    ])
  })

  it('展开祖先只从折叠集合里移除定位票的祖先', () => {
    const tickets = [ticket('#1'), ticket('#2', '#1'), ticket('#3', '#2'), ticket('#4')]

    const collapsed = expandAncestors(tickets, new Set(['#1', '#4']), '#3')

    expect([...collapsed]).toEqual(['#4'])
  })

  it('已经全展开时返回原集合', () => {
    const tickets = [ticket('#1'), ticket('#2', '#1')]
    const collapsed = new Set<string>()

    expect(expandAncestors(tickets, collapsed, '#2')).toBe(collapsed)
  })

  it('空输入得到空树', () => {
    expect(buildTicketTree([], new Set())).toEqual([])
  })
})
