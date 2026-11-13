import { describe, expect, it } from 'vitest'

import type { Ticket, TrackerSnapshot } from '../core/ticket.ts'
import { TrackerError } from '../core/tracker-error.ts'
import type { WorkspaceSnapshot } from '../protocol/tracker.ts'
import { ROOT, expectOk, resolution, serviceWith, ticket } from './snapshot-service-test-support.ts'

describe('快照指标', () => {
  const METRICS_NOW = Date.parse('2026-11-13T00:00:00Z')

  const METRIC_TICKETS: readonly Ticket[] = [
    ticket({
      number: 1,
      title: '可接的票',
      labels: ['enhancement', 'ready-for-agent'],
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-12T00:00:00Z',
      blockedBy: [],
    }),
    ticket({
      number: 2,
      title: '陈旧的阻塞票',
      labels: ['needs-triage'],
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-02T00:00:00Z',
      openBlockers: 1,
      blockedBy: ['#1'],
    }),
    ticket({
      number: 3,
      title: '已关闭的票',
      state: 'closed',
      labels: ['bug'],
      createdAt: '2026-11-10T00:00:00Z',
      updatedAt: '2026-11-11T00:00:00Z',
      closedAt: '2026-11-11T10:00:00Z',
      blockedBy: [],
    }),
    ticket({
      number: 4,
      title: '另一张可接的票',
      labels: ['enhancement', 'ready-for-agent'],
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-11-13T00:00:00Z',
      blockedBy: [],
    }),
  ]

  function metricSnapshot(overrides: Partial<TrackerSnapshot> = {}): TrackerSnapshot {
    return {
      repository: 'cnzgray/dsh-mattpocock-workflow',
      fetchedAt: METRICS_NOW,
      loaded: METRIC_TICKETS.length,
      total: 10,
      tickets: METRIC_TICKETS,
      ...overrides,
    }
  }

  function ticketWithoutClosedAt(entry: Ticket): Ticket {
    const copy = { ...entry }
    delete copy.closedAt
    return copy
  }

  function ticketWithoutBlockedBy(entry: Ticket): Ticket {
    const copy = { ...entry }
    delete copy.blockedBy
    return copy
  }

  it('指标与票集合一致，并带样本覆盖度', async () => {
    const { service } = serviceWith([metricSnapshot()])

    const result = expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))

    expect(result.metrics).toMatchObject({
      openBacklog: 3,
      readyCapacity: 2,
      blockedRatio: 1 / 3,
      needsTriage: 1,
      stalled: 0,
      staleCount: { value: 2, gap: null },
      staleRatio: { value: 2 / 3, gap: null },
      oldestUpdateDays: { value: 72, gap: null },
      longestBlockerChain: { value: 2, gap: null },
      openedLast30Days: { value: 2, gap: null },
      closedLast30Days: { value: 1, gap: null },
      netFlow: { value: 1, gap: null },
      coverage: { truncated: true },
    })
  })

  it('三个维度分别判档，总档位取最重的一维', async () => {
    const { service } = serviceWith([metricSnapshot()])

    const result = expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))

    expect(result.metrics.pressure.tier).toBe('tight')
    expect(
      result.metrics.pressure.dimensions.map((dimension) => [
        dimension.dimension,
        dimension.tier,
        dimension.triggers,
        dimension.gaps,
        dimension.provisional,
      ]),
    ).toEqual([
      ['scale', 'normal', ['netFlow'], [], false],
      ['blocking', 'normal', ['blockedRatio'], [], false],
      ['freshness', 'tight', ['staleRatio'], [], false],
    ])
  })

  it('关闭时间缺失时关闭类指标不可用，不用更新时间近似', async () => {
    const tickets = METRIC_TICKETS.map((entry) =>
      entry.ref === '#3' ? ticketWithoutClosedAt(entry) : entry,
    )
    const { service } = serviceWith([metricSnapshot({ tickets })])

    const result = expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))

    expect(result.metrics.closedLast30Days).toEqual({
      value: null,
      gap: 'no-closed-time',
    })
    expect(result.metrics.netFlow).toEqual({ value: null, gap: 'no-closed-time' })
  })

  it('本地 Markdown 的时间来自文件，时效与流量指标标为不可用', async () => {
    const tickets = METRIC_TICKETS.map((entry) =>
      entry.ref === '#3' ? ticketWithoutClosedAt(entry) : entry,
    )
    const { service } = serviceWith([metricSnapshot({ tickets })], 'markdown')

    const result = expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))

    expect(result.metrics.staleCount).toEqual({ value: null, gap: 'no-timestamps' })
    expect(result.metrics.openedLast30Days).toEqual({ value: null, gap: 'no-timestamps' })
    expect(result.metrics.netFlow).toEqual({ value: null, gap: 'no-timestamps' })
    expect(result.metrics.pressure.dimensions.find((d) => d.dimension === 'freshness')).toEqual({
      dimension: 'freshness',
      tier: null,
      signals: [{ metric: 'stalled', value: 0 }],
      triggers: [],
      gaps: ['no-timestamps'],
      provisional: false,
    })
  })

  it('没有依赖边的后端把链深度标为不可用', async () => {
    const tickets = METRIC_TICKETS.map(ticketWithoutBlockedBy)
    const { service } = serviceWith([metricSnapshot({ tickets })])

    const result = expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))

    expect(result.metrics.longestBlockerChain).toEqual({
      value: null,
      gap: 'no-dependency-edges',
    })
  })

  it('补齐后重算指标：阻塞维度从暂估变定稿', async () => {
    const { service } = serviceWith([metricSnapshot()], 'gitlab', () =>
      Promise.resolve(resolution(new Map([['#2', 2]]))),
    )

    const phaseOne = expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))
    const blockingOf = (snapshot: WorkspaceSnapshot) =>
      snapshot.metrics.pressure.dimensions.find((dimension) => dimension.dimension === 'blocking')

    expect(blockingOf(phaseOne)).toMatchObject({ provisional: true, tier: 'normal' })

    const finalized = expectOk(
      await service.handle('snapshot.resolveBlockers', { workspaceRoot: ROOT }),
    )

    expect(blockingOf(finalized)).toMatchObject({
      provisional: false,
      tier: 'normal',
    })
    expect(finalized.metrics.blockedRatio).toBe(1 / 3)
  })

  it('补齐失败时保留首屏指标与暂估标记', async () => {
    const { service } = serviceWith([metricSnapshot()], 'gitlab', () =>
      Promise.reject(new TrackerError('fetch-failed', '网络抖动')),
    )

    const phaseOne = expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))
    const finalized = expectOk(
      await service.handle('snapshot.resolveBlockers', { workspaceRoot: ROOT }),
    )

    expect(finalized.metrics).toEqual(phaseOne.metrics)
    expect(
      finalized.metrics.pressure.dimensions.find((d) => d.dimension === 'blocking'),
    ).toMatchObject({ provisional: true })
  })

  it('关注清单按固定优先级挑选，并写明原因', async () => {
    const { service } = serviceWith([metricSnapshot()])

    const result = expectOk(await service.handle('snapshot.get', { workspaceRoot: ROOT }))

    expect(result.metrics.attention).toEqual([
      { ref: '#2', title: '陈旧的阻塞票', reason: 'stale', evidence: 72 },
    ])
  })
})
