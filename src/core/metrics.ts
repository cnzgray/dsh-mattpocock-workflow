/**
 * 项目指标与压力判档。纯函数：输入已判定的工单、时钟与阈值，输出指标与档位。
 *
 * 三个维度各自判档，总档位取最重的一维，不合成加权总分：加权权重要拍脑袋，
 * 且任一维度爆掉时平均分会把它藏起来，而“到底哪一维在压”正是概览要回答的问题。
 * 阈值集中在 {@link PRESSURE_THRESHOLDS}，界面文案不再重复这些数字。
 */
import type {
  AttentionItem,
  AttentionReason,
  MetricGap,
  MetricValue,
  PressureDimension,
  PressureDimensionReport,
  PressureMetric,
  PressureReport,
  PressureTier,
  SnapshotMetrics,
} from '../protocol/tracker.ts'
import type { ClassifiedTicket } from './classify.ts'
import type { TicketLabelNames } from './ticket.ts'

/** 压力判档阈值。初稿来自通用经验，调整只改这一处，判定逻辑与界面都不动。 */
export const PRESSURE_THRESHOLDS = {
  /** 开放积压低于 10 张算轻松。 */
  backlogLightUnder: 10,
  /** 开放积压达到 30 张算吃紧。 */
  backlogTightFrom: 30,
  /** 近 30 天净流入 0 或更少算轻松。 */
  netFlowLightMax: 0,
  /** 近 30 天净流入达到 6 张算吃紧。 */
  netFlowTightFrom: 6,
  /** 阻塞占比低于 15% 算轻松。 */
  blockedRatioLightUnder: 0.15,
  /** 阻塞占比高于 35% 算吃紧。 */
  blockedRatioTightOver: 0.35,
  /** 陈旧率低于 20% 算轻松。 */
  staleRatioLightUnder: 0.2,
  /** 陈旧率高于 40% 算吃紧。 */
  staleRatioTightOver: 0.4,
  /** 停滞票 3 张及以下算轻松。 */
  stalledLightMax: 3,
  /** 停滞票达到 11 张算吃紧。 */
  stalledTightFrom: 11,
  /** 陈旧与流量指标的观察窗口（天），同时用于“陈旧票”的判定。 */
  windowDays: 30,
} as const

const DAY_MS = 86_400_000
const MAX_ATTENTION = 5
const MAX_STALE_ATTENTION = 2

/** 计算指标所需的输入。 */
export interface MetricsInput {
  /** 已判定的工单，保持快照里的顺序。 */
  readonly tickets: readonly ClassifiedTicket[]
  /** 后端报告的仓库总数；大于已加载数时指标只覆盖样本。 */
  readonly total: number
  /** 计算时间（毫秒时间戳），取快照的 `fetchedAt`，让结果与界面显示的时间一致。 */
  readonly now: number
  /**
   * 后端给出的创建/更新时间是否真的是工单时间。本地 Markdown 用的是文件
   * 创建与修改时间，不算工单时间，传 false。
   */
  readonly timestamps: boolean
  /** 阻塞信息是否已定稿；false 时阻塞维度标“暂估”。 */
  readonly blockersFinalized: boolean
  readonly labels: TicketLabelNames
}

/**
 * 计算一个快照的全部指标、压力档位与关注清单。
 * @param input - 工单、总数、时钟、时间数据可用性与标签名。
 * @returns 指标载荷；不可得的指标 `value` 为 null 并带缺口原因。
 */
export function computeMetrics(input: MetricsInput): SnapshotMetrics {
  const { tickets, now } = input
  const windowMs = PRESSURE_THRESHOLDS.windowDays * DAY_MS

  const open = tickets.filter((ticket) => ticket.state === 'open')
  const closed = tickets.filter((ticket) => ticket.state === 'closed')

  const openBacklog = open.length
  const readyCapacity = open.filter((ticket) => ticket.status === 'ready').length
  const blocked = open.filter((ticket) => ticket.status === 'blocked').length
  const blockedRatio = openBacklog === 0 ? 0 : blocked / openBacklog
  const needsTriage = open.filter((ticket) => ticket.category === null).length
  const stalled = open.filter((ticket) => ticket.status === 'open').length

  const staleTickets = input.timestamps
    ? open.filter((ticket) => olderThan(ticket.createdAt, now, windowMs))
    : []
  const staleCount = input.timestamps
    ? available(staleTickets.length)
    : unavailable('no-timestamps')
  const staleRatio = input.timestamps
    ? available(openBacklog === 0 ? 0 : staleTickets.length / openBacklog)
    : unavailable('no-timestamps')

  const oldestUpdateDays = input.timestamps
    ? available(oldestUpdateDaysOf(open, now))
    : unavailable('no-timestamps')

  const openedLast30Days = input.timestamps
    ? available(countCreatedWithin(tickets, now, windowMs))
    : unavailable('no-timestamps')

  const closedLast30Days = closedWithin(closed, input.timestamps, now, windowMs)
  const netFlow = flowOf(openedLast30Days, closedLast30Days)

  const longestBlockerChain = hasBlockerEdges(tickets)
    ? available(longestChain(open))
    : unavailable('no-dependency-edges')

  const coverage = {
    loaded: tickets.length,
    total: Math.max(input.total, tickets.length),
    truncated: input.total > tickets.length,
  }

  const pressure = pressureOf({
    openBacklog,
    blockedRatio,
    netFlow,
    staleRatio,
    stalled,
    blockersFinalized: input.blockersFinalized,
  })

  return {
    openBacklog,
    readyCapacity,
    blockedRatio,
    needsTriage,
    stalled,
    staleCount,
    staleRatio,
    oldestUpdateDays,
    longestBlockerChain,
    openedLast30Days,
    closedLast30Days,
    netFlow,
    coverage,
    pressure,
    attention: attentionOf(input, windowMs),
  }
}

/** 判档所需的最小指标集合。 */
interface PressureInput {
  readonly openBacklog: number
  readonly blockedRatio: number
  readonly netFlow: MetricValue
  readonly staleRatio: MetricValue
  readonly stalled: number
  readonly blockersFinalized: boolean
}

function pressureOf(input: PressureInput): PressureReport {
  const scale = scaleDimension(input.openBacklog, input.netFlow)
  const blocking = blockingDimension(input.blockedRatio, input.blockersFinalized)
  const freshness = freshnessDimension(input.staleRatio, input.stalled)
  const dimensions = [scale, blocking, freshness]

  return { tier: worstTier(dimensions.map((dimension) => dimension.tier)), dimensions }
}

/** 一个维度里参与判档的指标。 */
interface DimensionMetric {
  readonly metric: PressureMetric
  readonly value: number
  readonly tier: PressureTier
}

function scaleDimension(openBacklog: number, netFlow: MetricValue): PressureDimensionReport {
  const metrics: DimensionMetric[] = [
    { metric: 'backlog', value: openBacklog, tier: tierByBacklog(openBacklog) },
  ]
  const gaps: MetricGap[] = []

  if (netFlow.value === null) {
    gaps.push(netFlow.gap ?? 'no-closed-time')
  } else {
    metrics.push({ metric: 'netFlow', value: netFlow.value, tier: tierByNetFlow(netFlow.value) })
  }

  return dimensionReport('scale', metrics, gaps)
}

function blockingDimension(
  blockedRatio: number,
  blockersFinalized: boolean,
): PressureDimensionReport {
  return dimensionReport(
    'blocking',
    [
      {
        metric: 'blockedRatio',
        value: blockedRatio,
        tier: tierByRatio(
          blockedRatio,
          PRESSURE_THRESHOLDS.blockedRatioLightUnder,
          PRESSURE_THRESHOLDS.blockedRatioTightOver,
        ),
      },
    ],
    [],
    !blockersFinalized,
  )
}

function freshnessDimension(staleRatio: MetricValue, stalled: number): PressureDimensionReport {
  const metrics: DimensionMetric[] = [
    { metric: 'stalled', value: stalled, tier: tierByStalled(stalled) },
  ]
  const gaps: MetricGap[] = []

  if (staleRatio.value === null) {
    gaps.push('no-timestamps')
  } else {
    metrics.push({
      metric: 'staleRatio',
      value: staleRatio.value,
      tier: tierByRatio(
        staleRatio.value,
        PRESSURE_THRESHOLDS.staleRatioLightUnder,
        PRESSURE_THRESHOLDS.staleRatioTightOver,
      ),
    })
  }

  return dimensionReport('freshness', metrics, gaps)
}

function dimensionReport(
  dimension: PressureDimension,
  metrics: readonly DimensionMetric[],
  gaps: readonly MetricGap[],
  provisional = false,
): PressureDimensionReport {
  const tier = worstTier(metrics.map((metric) => metric.tier))

  return {
    dimension,
    tier,
    signals: metrics.map((metric) => ({ metric: metric.metric, value: metric.value })),
    // 轻松档意味着所有可用指标都在轻松范围，没有需要点名的触发项。
    triggers:
      tier === 'light' ? [] : metrics.filter((metric) => metric.tier === tier).map((m) => m.metric),
    gaps,
    provisional,
  }
}

function tierByBacklog(backlog: number): PressureTier {
  if (backlog < PRESSURE_THRESHOLDS.backlogLightUnder) return 'light'
  if (backlog < PRESSURE_THRESHOLDS.backlogTightFrom) return 'normal'
  return 'tight'
}

function tierByNetFlow(netFlow: number): PressureTier {
  if (netFlow <= PRESSURE_THRESHOLDS.netFlowLightMax) return 'light'
  if (netFlow < PRESSURE_THRESHOLDS.netFlowTightFrom) return 'normal'
  return 'tight'
}

function tierByRatio(value: number, lightUnder: number, tightOver: number): PressureTier {
  if (value < lightUnder) return 'light'
  if (value > tightOver) return 'tight'
  return 'normal'
}

function tierByStalled(stalled: number): PressureTier {
  if (stalled <= PRESSURE_THRESHOLDS.stalledLightMax) return 'light'
  if (stalled < PRESSURE_THRESHOLDS.stalledTightFrom) return 'normal'
  return 'tight'
}

const TIER_RANK: Record<PressureTier, number> = { light: 0, normal: 1, tight: 2 }

function worstTier(tiers: readonly PressureTier[]): PressureTier {
  let worst: PressureTier = 'light'
  for (const tier of tiers) {
    if (TIER_RANK[tier] > TIER_RANK[worst]) worst = tier
  }
  return worst
}

function available(value: number): MetricValue {
  return { value, gap: null }
}

function unavailable(gap: MetricGap): MetricValue {
  return { value: null, gap }
}

/** 近 30 天关闭：需要工单时间和每张已关闭票的关闭时间。 */
function closedWithin(
  closed: readonly ClassifiedTicket[],
  timestamps: boolean,
  now: number,
  windowMs: number,
): MetricValue {
  if (!timestamps) return unavailable('no-timestamps')

  let count = 0
  for (const ticket of closed) {
    const closedAt = timestampOf(ticket.closedAt)
    if (closedAt === null) return unavailable('no-closed-time')
    if (now - closedAt <= windowMs) count += 1
  }
  return available(count)
}

/** 净流入只在流入与流出都可计算时给出，不用更新时间近似关闭时间。 */
function flowOf(opened: MetricValue, closed: MetricValue): MetricValue {
  if (opened.value !== null && closed.value !== null) {
    return available(opened.value - closed.value)
  }
  return unavailable(opened.gap ?? closed.gap ?? 'no-closed-time')
}

function countCreatedWithin(
  tickets: readonly ClassifiedTicket[],
  now: number,
  windowMs: number,
): number {
  let count = 0
  for (const ticket of tickets) {
    const created = timestampOf(ticket.createdAt)
    if (created !== null && now - created <= windowMs) count += 1
  }
  return count
}

function oldestUpdateDaysOf(tickets: readonly ClassifiedTicket[], now: number): number {
  let oldest = 0
  for (const ticket of tickets) {
    const updated = timestampOf(ticket.updatedAt)
    if (updated !== null) oldest = Math.max(oldest, daysBetween(now, updated))
  }
  return oldest
}

function daysBetween(now: number, timestamp: number): number {
  return Math.max(0, Math.floor((now - timestamp) / DAY_MS))
}

function timestampOf(value: string | undefined): number | null {
  if (value === undefined) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function olderThan(value: string, now: number, windowMs: number): boolean {
  const timestamp = timestampOf(value)
  return timestamp !== null && now - timestamp > windowMs
}

/**
 * 阻塞依赖边是否可用。后端支持依赖边时每张票都会带 `blockedBy`（哪怕是空数组）；
 * GitHub 列表查询给不出边，字段整体省略。
 */
function hasBlockerEdges(tickets: readonly ClassifiedTicket[]): boolean {
  return tickets.every((ticket) => ticket.blockedBy !== undefined)
}

/**
 * 最长未关闭阻塞链：只沿已加载的开放票走，链上每张票算一层。
 * 没有链时返回 0；环只保护不重复计数，不会无限递归。
 */
function longestChain(open: readonly ClassifiedTicket[]): number {
  const byRef = new Map(open.map((ticket) => [ticket.ref, ticket]))
  const memo = new Map<string, number>()

  const depthOf = (ref: string, visiting: Set<string>): number => {
    const cached = memo.get(ref)
    if (cached !== undefined) return cached
    if (visiting.has(ref)) return 0

    const ticket = byRef.get(ref)
    if (ticket === undefined) return 0

    visiting.add(ref)
    let deepest = 0
    for (const blockerRef of ticket.blockedBy ?? []) {
      if (!byRef.has(blockerRef)) continue
      deepest = Math.max(deepest, depthOf(blockerRef, visiting))
    }
    visiting.delete(ref)

    const depth = deepest + 1
    memo.set(ref, depth)
    return depth
  }

  let longest = 0
  for (const ticket of open) {
    const depth = depthOf(ticket.ref, new Set())
    if (depth > 1) longest = Math.max(longest, depth)
  }
  return longest
}

function attentionOf(input: MetricsInput, windowMs: number): readonly AttentionItem[] {
  const { tickets, now } = input
  const open = tickets.filter((ticket) => ticket.state === 'open')
  const items: AttentionItem[] = []
  const seen = new Set<string>()

  const push = (
    ticket: ClassifiedTicket,
    reason: AttentionReason,
    evidence: number | null,
  ): void => {
    if (items.length >= MAX_ATTENTION || seen.has(ticket.ref)) return
    seen.add(ticket.ref)
    items.push({ ref: ticket.ref, title: ticket.title, reason, evidence })
  }

  // 1. 开放、缺陷分类、但还没被定性为可接：最该先做 triage 决定。
  const untriagedBug = open
    .filter(
      (ticket) => ticket.category === 'bug' && !ticket.labels.includes(input.labels.readyForAgent),
    )
    .sort(compareCreatedAsc)[0]
  if (untriagedBug !== undefined) push(untriagedBug, 'untriaged-bug', null)

  // 2. 开放且超过 30 天没更新：最陈旧，最多列两张。
  if (input.timestamps) {
    const stale = open
      .filter((ticket) => olderThan(ticket.updatedAt, now, windowMs))
      .sort(byUpdatedAsc)
      .slice(0, MAX_STALE_ATTENTION)
    for (const ticket of stale) {
      push(ticket, 'stale', daysBetween(now, timestampOf(ticket.updatedAt) ?? now))
    }
  }

  // 3. 未关闭阻塞数最多：挡得最多的一张。
  const mostBlocking = open
    .filter((ticket) => ticket.openBlockers > 0)
    .sort((left, right) => right.openBlockers - left.openBlockers || compareCreatedAsc(left, right))
    .at(0)
  if (mostBlocking !== undefined) push(mostBlocking, 'most-blocking', mostBlocking.openBlockers)

  // 4. 停滞票里创建最早的：躺着最久又没人管。没有时间数据时无法比较先后。
  if (input.timestamps) {
    const oldestStalled = open
      .filter((ticket) => ticket.status === 'open')
      .sort(compareCreatedAsc)
      .at(0)
    if (oldestStalled !== undefined) {
      push(
        oldestStalled,
        'oldest-stalled',
        daysBetween(now, timestampOf(oldestStalled.createdAt) ?? now),
      )
    }
  }

  return items
}

function byUpdatedAsc(left: ClassifiedTicket, right: ClassifiedTicket): number {
  return (timestampOf(left.updatedAt) ?? 0) - (timestampOf(right.updatedAt) ?? 0)
}

function compareCreatedAsc(left: ClassifiedTicket, right: ClassifiedTicket): number {
  return (timestampOf(left.createdAt) ?? 0) - (timestampOf(right.createdAt) ?? 0)
}
