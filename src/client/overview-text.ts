/**
 * 概览视图的展示逻辑：档位文案、指标格式、构成分布与关注原因。
 * 纯函数，不重复判定规则——档位与指标都已由宿主附在快照上。
 */
import type {
  AttentionItem,
  MetricGap,
  MetricValue,
  PressureDimension,
  PressureDimensionReport,
  PressureMetric,
  PressureSignal,
  PressureTier,
  TicketSnapshot,
} from '../protocol/tracker.ts'
import type { Translate } from './i18n-runtime.ts'
import type { MessageKey } from './messages.ts'

const TIER_KEYS: Readonly<Record<PressureTier, MessageKey>> = {
  light: 'overview.tier.light',
  normal: 'overview.tier.normal',
  tight: 'overview.tier.tight',
}

const DIMENSION_KEYS: Readonly<Record<PressureDimension, MessageKey>> = {
  scale: 'overview.dimension.scale',
  blocking: 'overview.dimension.blocking',
  freshness: 'overview.dimension.freshness',
}

const DIMENSION_BASIS_KEYS: Readonly<Record<PressureDimension, MessageKey>> = {
  scale: 'overview.basis.scale',
  blocking: 'overview.basis.blocking',
  freshness: 'overview.basis.freshness',
}

const METRIC_GAP_KEYS: Readonly<Record<MetricGap, MessageKey>> = {
  'no-timestamps': 'overview.gap.noTimestamps',
  'no-closed-time': 'overview.gap.noClosedTime',
  'no-dependency-edges': 'overview.gap.noDependencyEdges',
}

const GAP_NOTE_KEYS: Readonly<Record<MetricGap, MessageKey>> = {
  'no-timestamps': 'overview.gap.note.noTimestamps',
  'no-closed-time': 'overview.gap.note.noClosedTime',
  'no-dependency-edges': 'overview.gap.note.noDependencyEdges',
}

/** 档位文案。 */
export function pressureTierLabel(tier: PressureTier, t: Translate): string {
  return t(TIER_KEYS[tier])
}

/** 维度名称。 */
export function pressureDimensionLabel(dimension: PressureDimension, t: Translate): string {
  return t(DIMENSION_KEYS[dimension])
}

/** 维度看什么。与 core 的判定规则一一对应，只写口径不写阈值数字。 */
export function pressureDimensionBasis(dimension: PressureDimension, t: Translate): string {
  return t(DIMENSION_BASIS_KEYS[dimension])
}

/** 构成条每段的稳定键；颜色与计数都按它对齐。 */
export type DistributionKey =
  'ready' | 'blocked' | 'open' | 'closed' | 'bug' | 'enhancement' | 'untriaged'

/** 构成条的一段。 */
export interface DistributionSegment {
  readonly key: DistributionKey
  readonly label: string
  readonly count: number
}

/**
 * 状态分布：可接、阻塞、其他开放、已关闭。
 * @param tickets - 快照里的工单。
 * @param t - 翻译入口；省略时用内置中文。
 * @returns 四类计数，顺序固定。
 */
export function statusSegments(
  tickets: readonly TicketSnapshot[],
  t: Translate,
): readonly DistributionSegment[] {
  let ready = 0
  let blocked = 0
  let open = 0
  let closed = 0
  for (const ticket of tickets) {
    if (ticket.status === 'ready') ready += 1
    else if (ticket.status === 'blocked') blocked += 1
    else if (ticket.status === 'closed') closed += 1
    else open += 1
  }
  return [
    { key: 'ready', label: t('overview.segment.ready'), count: ready },
    { key: 'blocked', label: t('overview.segment.blocked'), count: blocked },
    { key: 'open', label: t('overview.segment.open'), count: open },
    { key: 'closed', label: t('overview.segment.closed'), count: closed },
  ]
}

/**
 * 分类分布：bug、enhancement、未定级。
 * @param tickets - 快照里的工单。
 * @param t - 翻译入口；省略时用内置中文。
 * @returns 三类计数，顺序固定。
 */
export function categorySegments(
  tickets: readonly TicketSnapshot[],
  t: Translate,
): readonly DistributionSegment[] {
  let bug = 0
  let enhancement = 0
  let untriaged = 0
  for (const ticket of tickets) {
    if (ticket.category === 'bug') bug += 1
    else if (ticket.category === 'enhancement') enhancement += 1
    else untriaged += 1
  }
  return [
    { key: 'bug', label: 'bug', count: bug },
    { key: 'enhancement', label: 'enhancement', count: enhancement },
    { key: 'untriaged', label: t('overview.segment.untriaged'), count: untriaged },
  ]
}

/**
 * 一段占全部的比例。
 * @param segment - 一段计数。
 * @param total - 全部计数。
 * @returns 0–1 的比例；总数为 0 时为 0。
 */
export function segmentRatio(segment: DistributionSegment, total: number): number {
  return total === 0 ? 0 : segment.count / total
}

/**
 * 把一个指标格式化成卡片里的文字。
 * @param value - 指标取值。
 * @param format - 有值时的格式化方式。
 * @param t - 翻译入口；省略时用内置中文。
 * @returns 数值文案或“不可用”。
 */
export function metricText(
  value: MetricValue,
  format: (value: number) => string,
  t: Translate,
): string {
  return value.value === null ? t('overview.metric.unavailable') : format(value.value)
}

/**
 * 比率转百分比。
 * @param ratio - 0–1 的比例。
 * @returns 整数百分比文案。
 */
export function formatPercent(ratio: number): string {
  return `${String(Math.round(ratio * 100))}%`
}

/**
 * 一个压力维度的触发说明：只列与最终档位同档的指标；轻松档列出全部指标。
 * @param report - 维度判档结果。
 * @param t - 翻译入口；省略时用内置中文。
 * @returns 一句说明。
 */
export function pressureFacts(report: PressureDimensionReport, t: Translate): string {
  const signals = factSignals(report)
  if (signals.length === 0) return t('overview.fact.none')
  return signals
    .map((signal) => pressureSignalText(signal.metric, signal.value, t))
    .join(t('common.clauseSeparator'))
}

/**
 * 触发说明里会列出的指标：有触发项时只列触发项，轻松档列出全部。
 * @param report - 维度判档结果。
 * @returns 要写进说明的指标与取值。
 */
export function factSignals(report: PressureDimensionReport): readonly PressureSignal[] {
  return report.triggers.length === 0
    ? report.signals
    : report.signals.filter((signal) => report.triggers.includes(signal.metric))
}

/** 压力维度缺数据时的说明。 */
export function pressureGaps(report: PressureDimensionReport, t: Translate): readonly string[] {
  return report.gaps.map((gap) => t(METRIC_GAP_KEYS[gap]))
}

/**
 * 关注清单条目的原因文案。
 * @param item - 关注清单条目。
 * @param t - 翻译入口；省略时用内置中文。
 * @returns 一句原因。
 */
export function attentionText(item: AttentionItem, t: Translate): string {
  switch (item.reason) {
    case 'untriaged-bug':
      return t('overview.attention.untriagedBug')
    case 'stale':
      return t('overview.attention.stale', { count: item.evidence ?? 0 })
    case 'most-blocking':
      return t('overview.attention.mostBlocking', { count: item.evidence ?? 0 })
    case 'oldest-stalled':
      return t('overview.attention.oldestStalled', { count: item.evidence ?? 0 })
  }
}

function pressureSignalText(metric: PressureMetric, value: number, t: Translate): string {
  switch (metric) {
    case 'backlog':
      return t('overview.fact.backlog', { count: value })
    case 'netFlow':
      return t('overview.fact.netFlow', {
        signed: `${value > 0 ? '+' : ''}${String(value)}`,
      })
    case 'blockedRatio':
      return t('overview.fact.blockedRatio', { ratio: formatPercent(value) })
    case 'staleRatio':
      return t('overview.fact.staleRatio', { ratio: formatPercent(value) })
    case 'stalled':
      return t('overview.fact.stalled', { count: value })
  }
}

/**
 * 指标缺口的短说明。
 * @param value - 指标取值。
 * @param t - 翻译入口；省略时用内置中文。
 * @returns 有缺口时的短说明，否则 undefined。
 */
export function gapNote(value: MetricValue, t: Translate): string | undefined {
  return value.gap === null ? undefined : t(GAP_NOTE_KEYS[value.gap])
}

/**
 * 把缺口、低估与样本范围合成一行小字。
 * @param notes - 可能缺席的几段说明。
 * @returns 用“ · ”连接的说明；没有内容时为 undefined。
 */
export function joinNotes(...notes: readonly (string | undefined)[]): string | undefined {
  const present = notes.filter((note): note is string => note !== undefined)
  return present.length === 0 ? undefined : present.join(' · ')
}

/**
 * 样本被截断时的范围说明，例如“样本 4/10”。
 * @param snapshot - 快照的已加载数、总数与截断标记。
 * @param t - 翻译入口；省略时用内置中文。
 * @returns 截断时的说明，否则 undefined。
 */
export function sampleNote(
  snapshot: {
    readonly loaded: number
    readonly total: number
    readonly metrics: { readonly coverage: { readonly truncated: boolean } }
  },
  t: Translate,
): string | undefined {
  return snapshot.metrics.coverage.truncated
    ? t('overview.sample', { loaded: snapshot.loaded, total: snapshot.total })
    : undefined
}
