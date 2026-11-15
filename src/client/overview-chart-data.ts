/**
 * 概览图表的数据整理：把快照里的工单按时间分桶。只做展示用的计数，
 * 不参与判档——档位与指标仍以宿主附上的 `snapshot.metrics` 为准。
 */
import type { PressureTier, TicketSnapshot } from '../protocol/tracker.ts'
import type { Translate } from './i18n-runtime.ts'

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS

/** 流量图里的一周。 */
export interface FlowBucket {
  /** 这一周的起点（含），毫秒时间戳。 */
  readonly start: number
  /** 这一周的终点（不含），毫秒时间戳。 */
  readonly end: number
  readonly opened: number
  /** 后端给不出关闭时间时为 null。 */
  readonly closed: number | null
}

/**
 * 最近若干周每周新开与关闭的票数，最后一周截止到 `now`。
 * @param tickets - 快照里的工单。
 * @param now - 截止时间，取快照的 `fetchedAt`。
 * @param options - 周数与关闭时间是否可用。
 * @returns 按时间从早到晚排列的周桶。
 */
export function weeklyFlow(
  tickets: readonly TicketSnapshot[],
  now: number,
  options: { readonly weeks: number; readonly closedAvailable: boolean },
): readonly FlowBucket[] {
  const firstStart = now - options.weeks * WEEK_MS
  const opened = new Array<number>(options.weeks).fill(0)
  const closed = new Array<number>(options.weeks).fill(0)

  const indexOf = (value: string | undefined): number | null => {
    if (value === undefined) return null
    const timestamp = Date.parse(value)
    if (Number.isNaN(timestamp) || timestamp < firstStart || timestamp > now) return null
    return Math.min(options.weeks - 1, Math.floor((timestamp - firstStart) / WEEK_MS))
  }

  for (const ticket of tickets) {
    const openedIndex = indexOf(ticket.createdAt)
    if (openedIndex !== null) opened[openedIndex] = (opened[openedIndex] ?? 0) + 1
    if (ticket.state !== 'closed') continue
    const closedIndex = indexOf(ticket.closedAt)
    if (closedIndex !== null) closed[closedIndex] = (closed[closedIndex] ?? 0) + 1
  }

  return opened.map((count, index) => ({
    start: firstStart + index * WEEK_MS,
    end: firstStart + (index + 1) * WEEK_MS,
    opened: count,
    closed: options.closedAvailable ? (closed[index] ?? 0) : null,
  }))
}

/** 未更新天数分档的稳定键。 */
export type AgeBucketKey = 'week' | 'fortnight' | 'month' | 'older'

/** 未更新天数分布里的一档。 */
export interface AgeBucket {
  readonly key: AgeBucketKey
  readonly label: string
  readonly count: number
}

/**
 * 开放票按“距上次更新多少天”分档。
 * @param tickets - 快照里的工单；只统计开放票。
 * @param now - 截止时间，取快照的 `fetchedAt`。
 * @param t - 翻译入口；省略时用内置中文。
 * @returns 四档计数，顺序从新到旧固定。
 */
export function updateAgeBuckets(
  tickets: readonly TicketSnapshot[],
  now: number,
  t: Translate,
): readonly AgeBucket[] {
  const counts: Record<AgeBucketKey, number> = { week: 0, fortnight: 0, month: 0, older: 0 }
  for (const ticket of tickets) {
    if (ticket.state !== 'open') continue
    const updated = Date.parse(ticket.updatedAt)
    if (Number.isNaN(updated)) continue
    const days = Math.max(0, Math.floor((now - updated) / DAY_MS))
    if (days <= 7) counts.week += 1
    else if (days <= 14) counts.fortnight += 1
    else if (days <= 30) counts.month += 1
    else counts.older += 1
  }
  return [
    { key: 'week', label: t('overview.age.week'), count: counts.week },
    { key: 'fortnight', label: t('overview.age.fortnight'), count: counts.fortnight },
    { key: 'month', label: t('overview.age.month'), count: counts.month },
    { key: 'older', label: t('overview.age.older'), count: counts.older },
  ]
}

const TIER_LEVELS: Readonly<Record<PressureTier, number>> = { light: 1, normal: 2, tight: 3 }

/**
 * 档位刻度条点亮几格：轻松 1 格、正常 2 格、吃紧 3 格，不可用 0 格。
 * @param tier - 维度档位；null 表示判不了档。
 * @returns 0–3。
 */
export function tierLevel(tier: PressureTier | null): number {
  return tier === null ? 0 : TIER_LEVELS[tier]
}

/**
 * 周桶的短日期标签，例如 `11/6`。
 * @param timestamp - 毫秒时间戳。
 * @returns 本地时区的“月/日”。
 */
export function shortDate(timestamp: number): string {
  const date = new Date(timestamp)
  return `${String(date.getMonth() + 1)}/${String(date.getDate())}`
}
