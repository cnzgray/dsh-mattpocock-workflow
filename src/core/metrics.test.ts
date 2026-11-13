import { describe, expect, it } from 'vitest'

import { TRACKER_LABELS } from '../protocol/labels.ts'
import type { PressureDimensionReport, SnapshotMetrics } from '../protocol/tracker.ts'
import type { ClassifiedTicket } from './classify.ts'
import { PRESSURE_THRESHOLDS, computeMetrics, type MetricsInput } from './metrics.ts'

const NOW = Date.parse('2026-11-13T00:00:00Z')
const DAY_MS = 86_400_000

function daysAgo(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString()
}

function ticket(overrides: Partial<ClassifiedTicket> = {}): ClassifiedTicket {
  return {
    ref: '#1',
    number: 1,
    title: '一张票',
    state: 'open',
    labels: [],
    category: null,
    status: 'open',
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
    openBlockers: 0,
    blockedBy: [],
    ...overrides,
  }
}

function tickets(
  count: number,
  overrides: Partial<ClassifiedTicket> | ((index: number) => Partial<ClassifiedTicket>) = {},
): ClassifiedTicket[] {
  return Array.from({ length: count }, (_, index) =>
    ticket({
      ref: `#${String(index + 1)}`,
      number: index + 1,
      ...(typeof overrides === 'function' ? overrides(index) : overrides),
    }),
  )
}

function metricsOf(
  input: readonly ClassifiedTicket[],
  options: Partial<Omit<MetricsInput, 'tickets' | 'now' | 'labels'>> = {},
): SnapshotMetrics {
  return computeMetrics({
    tickets: input,
    total: options.total ?? input.length,
    now: NOW,
    timestamps: options.timestamps ?? true,
    blockersFinalized: options.blockersFinalized ?? true,
    labels: TRACKER_LABELS,
  })
}

function dimension(
  metrics: SnapshotMetrics,
  name: PressureDimensionReport['dimension'],
): PressureDimensionReport {
  const found = metrics.pressure.dimensions.find((entry) => entry.dimension === name)
  if (found === undefined) throw new Error(`缺少 ${name} 维度`)
  return found
}

describe('压力档位阈值', () => {
  it.each([
    [9, 'light'],
    [10, 'normal'],
    [29, 'normal'],
    [30, 'tight'],
  ] as const)('开放积压 %i 张判为 %s', (backlog, expected) => {
    const metrics = metricsOf(tickets(backlog), { timestamps: false })

    expect(metrics.openBacklog).toBe(backlog)
    expect(dimension(metrics, 'scale').tier).toBe(expected)
    // 净流入不可用时只按积压判档，并标出缺的是什么数据。
    if (expected !== 'light') {
      expect(dimension(metrics, 'scale').triggers).toEqual(['backlog'])
    }
    expect(dimension(metrics, 'scale').gaps).toEqual(['no-timestamps'])
  })

  it.each([
    [0, 'light'],
    [1, 'normal'],
    [5, 'normal'],
    [6, 'tight'],
  ] as const)('近 30 天净流入 %i 张判为 %s', (netFlow, expected) => {
    const open = tickets(Math.max(netFlow, 0), { status: 'ready' })
    const closed = ticket({
      ref: '#closed',
      number: 99,
      state: 'closed',
      status: 'closed',
      createdAt: daysAgo(2),
      updatedAt: daysAgo(2),
      closedAt: daysAgo(1),
    })
    const metrics = metricsOf([...open, closed])

    expect(metrics.netFlow.value).toBe(netFlow)
    expect(dimension(metrics, 'scale').tier).toBe(expected)
    expect(dimension(metrics, 'scale').triggers).toEqual(expected === 'light' ? [] : ['netFlow'])
  })

  it.each([
    [2, 'light'],
    [3, 'normal'],
    [7, 'normal'],
    [8, 'tight'],
  ] as const)('20 张开放票里有 %i 张阻塞时判为 %s', (blocked, expected) => {
    const entries = tickets(20).map((entry, index) =>
      index < blocked ? { ...entry, status: 'blocked' as const, openBlockers: 1 } : entry,
    )
    const metrics = metricsOf(entries)

    expect(metrics.blockedRatio).toBeCloseTo(blocked / 20, 10)
    expect(dimension(metrics, 'blocking').tier).toBe(expected)
    expect(dimension(metrics, 'blocking').triggers).toEqual(
      expected === 'light' ? [] : ['blockedRatio'],
    )
  })

  it.each([
    [3, 'light'],
    [4, 'normal'],
    [8, 'normal'],
    [9, 'tight'],
  ] as const)('20 张开放票里有 %i 张陈旧时判为 %s', (stale, expected) => {
    const entries = tickets(20, { status: 'ready' }).map((entry, index) =>
      index < stale ? { ...entry, createdAt: daysAgo(40) } : entry,
    )
    const metrics = metricsOf(entries)

    expect(metrics.staleRatio.value).toBeCloseTo(stale / 20, 10)
    expect(dimension(metrics, 'freshness').tier).toBe(expected)
    expect(dimension(metrics, 'freshness').triggers).toEqual(
      expected === 'light' ? [] : ['staleRatio'],
    )
  })

  it.each([
    [3, 'light'],
    [4, 'normal'],
    [10, 'normal'],
    [11, 'tight'],
  ] as const)('停滞票 %i 张判为 %s', (stalled, expected) => {
    const metrics = metricsOf(tickets(stalled))

    expect(metrics.stalled).toBe(stalled)
    expect(dimension(metrics, 'freshness').tier).toBe(expected)
    expect(dimension(metrics, 'freshness').triggers).toEqual(
      expected === 'light' ? [] : ['stalled'],
    )
  })

  it('总档位取三个维度里最重的一维', () => {
    const entries = tickets(20, { createdAt: daysAgo(40), status: 'ready' }).map((entry, index) =>
      index < 5 ? { ...entry, status: 'blocked' as const, openBlockers: 1 } : entry,
    )
    const metrics = metricsOf(entries)

    expect(dimension(metrics, 'scale').tier).toBe('normal')
    expect(dimension(metrics, 'blocking').tier).toBe('normal')
    expect(dimension(metrics, 'freshness').tier).toBe('tight')
    expect(metrics.pressure.tier).toBe('tight')
  })

  it('阈值集中在一处，方便后续校准', () => {
    expect(PRESSURE_THRESHOLDS).toMatchObject({
      backlogLightUnder: 10,
      backlogTightFrom: 30,
      netFlowTightFrom: 6,
      blockedRatioLightUnder: 0.15,
      blockedRatioTightOver: 0.35,
      staleRatioLightUnder: 0.2,
      staleRatioTightOver: 0.4,
      stalledTightFrom: 11,
      windowDays: 30,
    })
  })
})

describe('指标可得性', () => {
  it('开放积压为 0 时阻塞占比与陈旧率按 0 处理', () => {
    const metrics = metricsOf([])

    expect(metrics.openBacklog).toBe(0)
    expect(metrics.blockedRatio).toBe(0)
    expect(metrics.staleRatio).toEqual({ value: 0, gap: null })
    expect(metrics.netFlow).toEqual({ value: 0, gap: null })
    expect(metrics.pressure.tier).toBe('light')
    expect(metrics.attention).toEqual([])
  })

  it('后端不给时间时，时效与流量指标标为不可用', () => {
    const metrics = metricsOf(tickets(2), { timestamps: false })

    expect(metrics.staleCount).toEqual({ value: null, gap: 'no-timestamps' })
    expect(metrics.staleRatio).toEqual({ value: null, gap: 'no-timestamps' })
    expect(metrics.oldestUpdateDays).toEqual({ value: null, gap: 'no-timestamps' })
    expect(metrics.openedLast30Days).toEqual({ value: null, gap: 'no-timestamps' })
    expect(metrics.closedLast30Days).toEqual({ value: null, gap: 'no-timestamps' })
    expect(metrics.netFlow).toEqual({ value: null, gap: 'no-timestamps' })
    expect(dimension(metrics, 'freshness').gaps).toEqual(['no-timestamps'])
    expect(dimension(metrics, 'scale').gaps).toEqual(['no-timestamps'])
  })

  it('关闭时间缺失时关闭类指标不可用', () => {
    const metrics = metricsOf([
      ticket({ state: 'closed', status: 'closed', createdAt: daysAgo(5) }),
    ])

    expect(metrics.openedLast30Days.value).toBe(1)
    expect(metrics.closedLast30Days).toEqual({ value: null, gap: 'no-closed-time' })
    expect(metrics.netFlow).toEqual({ value: null, gap: 'no-closed-time' })
    expect(dimension(metrics, 'scale').gaps).toEqual(['no-closed-time'])
  })

  it('没有阻塞依赖边时链深度不可用', () => {
    const entries = tickets(2).map((entry) => {
      const copy = { ...entry }
      delete copy.blockedBy
      return copy
    })

    expect(metricsOf(entries).longestBlockerChain).toEqual({
      value: null,
      gap: 'no-dependency-edges',
    })
  })

  it('样本被截断时覆盖度记录已加载数与总数', () => {
    const metrics = metricsOf(tickets(3), { total: 10 })

    expect(metrics.coverage).toEqual({ loaded: 3, total: 10, truncated: true })
  })
})

describe('最长阻塞链', () => {
  function chainTickets(refs: readonly string[]): ClassifiedTicket[] {
    return refs.map((ref, index) =>
      ticket({
        ref,
        number: index + 1,
        blockedBy: refs[index + 1] === undefined ? [] : [refs[index + 1] ?? ''],
      }),
    )
  }

  it('三层未关闭依赖链算三层', () => {
    const metrics = metricsOf(chainTickets(['#3', '#2', '#1']))

    expect(metrics.longestBlockerChain).toEqual({ value: 3, gap: null })
  })

  it('链在已关闭票处断开，只算未关闭的层数', () => {
    const entries = chainTickets(['#3', '#2', '#1'])
    const tail = entries[2]
    if (tail === undefined) throw new Error('缺少链尾票')
    entries[2] = { ...tail, state: 'closed', status: 'closed' }

    expect(metricsOf(entries).longestBlockerChain.value).toBe(2)
  })

  it('阻塞票不在已加载样本里时链在那里终止', () => {
    const metrics = metricsOf([ticket({ ref: '#3', blockedBy: ['#404'] })])

    expect(metrics.longestBlockerChain.value).toBe(0)
  })

  it('环不会无限递归', () => {
    const metrics = metricsOf([
      ticket({ ref: '#1', number: 1, blockedBy: ['#2'] }),
      ticket({ ref: '#2', number: 2, blockedBy: ['#1'] }),
    ])

    expect(metrics.longestBlockerChain.value).toBe(2)
  })

  it('没有阻塞关系时链深度为 0', () => {
    expect(metricsOf(tickets(3)).longestBlockerChain).toEqual({ value: 0, gap: null })
  })
})

describe('关注清单', () => {
  it('优先列出未定性的缺陷，已可接的缺陷不列', () => {
    const entries = [
      ticket({ ref: '#1', number: 1, category: 'bug', labels: ['bug'] }),
      ticket({
        ref: '#2',
        number: 2,
        category: 'bug',
        labels: ['bug', 'ready-for-agent'],
        status: 'ready',
      }),
    ]

    expect(metricsOf(entries).attention).toEqual([
      { ref: '#1', title: '一张票', reason: 'untriaged-bug', evidence: null },
    ])
  })

  it('陈旧票最多列两张，按最久未更新排序', () => {
    const entries = [
      ticket({ ref: '#1', number: 1, status: 'ready', updatedAt: daysAgo(50) }),
      ticket({ ref: '#2', number: 2, status: 'ready', updatedAt: daysAgo(70) }),
      ticket({ ref: '#3', number: 3, status: 'ready', updatedAt: daysAgo(40) }),
    ]

    expect(metricsOf(entries).attention).toEqual([
      { ref: '#2', title: '一张票', reason: 'stale', evidence: 70 },
      { ref: '#1', title: '一张票', reason: 'stale', evidence: 50 },
    ])
  })

  it('列出未关闭阻塞数最多的一张', () => {
    const entries = [
      ticket({ ref: '#1', number: 1, status: 'blocked', openBlockers: 2 }),
      ticket({ ref: '#2', number: 2, status: 'blocked', openBlockers: 5 }),
    ]

    expect(metricsOf(entries).attention).toContainEqual({
      ref: '#2',
      title: '一张票',
      reason: 'most-blocking',
      evidence: 5,
    })
  })

  it('列出停滞票里创建最早的一张', () => {
    const entries = [
      ticket({ ref: '#1', number: 1, createdAt: daysAgo(20) }),
      ticket({ ref: '#2', number: 2, createdAt: daysAgo(90) }),
    ]

    expect(metricsOf(entries).attention).toContainEqual({
      ref: '#2',
      title: '一张票',
      reason: 'oldest-stalled',
      evidence: 90,
    })
  })

  it('同一张票只出现一次，保留优先级更高的原因', () => {
    const entries = [
      ticket({
        ref: '#1',
        number: 1,
        status: 'blocked',
        openBlockers: 3,
        updatedAt: daysAgo(60),
      }),
    ]

    expect(metricsOf(entries).attention).toEqual([
      { ref: '#1', title: '一张票', reason: 'stale', evidence: 60 },
    ])
  })

  it('没有时间数据时跳过依赖时间的候选', () => {
    const entries = [
      ticket({ ref: '#1', number: 1, status: 'blocked', openBlockers: 4 }),
      ticket({ ref: '#2', number: 2, createdAt: daysAgo(90) }),
    ]

    expect(metricsOf(entries, { timestamps: false }).attention).toEqual([
      { ref: '#1', title: '一张票', reason: 'most-blocking', evidence: 4 },
    ])
  })

  it('最多五条', () => {
    const entries = [
      ticket({ ref: '#1', number: 1, category: 'bug', labels: ['bug'] }),
      ticket({ ref: '#2', number: 2, status: 'ready', updatedAt: daysAgo(90) }),
      ticket({ ref: '#3', number: 3, status: 'ready', updatedAt: daysAgo(80) }),
      ticket({ ref: '#4', number: 4, status: 'blocked', openBlockers: 2 }),
      ticket({ ref: '#5', number: 5, createdAt: daysAgo(70) }),
    ]

    expect(metricsOf(entries).attention.map((item) => item.ref)).toEqual([
      '#1',
      '#2',
      '#3',
      '#4',
      '#5',
    ])
  })
})

describe('压力维度结构', () => {
  it('三个维度顺序固定，阻塞未定稿时标暂估', () => {
    const metrics = metricsOf(tickets(2), { blockersFinalized: false })

    expect(metrics.pressure.dimensions.map((entry) => entry.dimension)).toEqual([
      'scale',
      'blocking',
      'freshness',
    ])
    expect(dimension(metrics, 'blocking').provisional).toBe(true)
    expect(dimension(metrics, 'scale').provisional).toBe(false)
  })

  it('轻松档不点名触发项，只给出参与判档的指标', () => {
    const metrics = metricsOf(tickets(2, { status: 'ready', createdAt: daysAgo(40) }))
    const scale = dimension(metrics, 'scale')

    expect(scale.tier).toBe('light')
    expect(scale.triggers).toEqual([])
    expect(scale.signals).toEqual([
      { metric: 'backlog', value: 2 },
      { metric: 'netFlow', value: 0 },
    ])
  })
})
