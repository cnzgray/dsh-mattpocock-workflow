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
  PressureTier,
  TicketSnapshot,
} from '../protocol/tracker.ts'

/** 档位文案。 */
export const PRESSURE_TIER_LABELS: Readonly<Record<PressureTier, string>> = {
  light: '轻松',
  normal: '正常',
  tight: '吃紧',
}

/** 维度名称。 */
export const PRESSURE_DIMENSION_LABELS: Readonly<Record<PressureDimension, string>> = {
  scale: '规模',
  blocking: '阻塞',
  freshness: '时效',
}

/** 维度看什么。与 core 的判定规则一一对应，只写口径不写阈值数字。 */
export const PRESSURE_DIMENSION_BASIS: Readonly<Record<PressureDimension, string>> = {
  scale: '开放积压与近 30 天净流入',
  blocking: '阻塞票占开放票的比例',
  freshness: '陈旧率与停滞票',
}

/** 指标缺失时的解释。 */
export const METRIC_GAP_TEXT: Readonly<Record<MetricGap, string>> = {
  'no-timestamps': '后端不提供工单时间，时效与流量指标不可用。',
  'no-closed-time': '后端不提供关闭时间，关闭速度与净流入不可用。',
  'no-dependency-edges': '后端不提供阻塞依赖边，最长阻塞链不可用。',
}

/** 构成条的一段。 */
export interface DistributionSegment {
  readonly key: string
  readonly label: string
  readonly count: number
}

/**
 * 状态分布：可接、阻塞、其他开放、已关闭。
 * @param tickets - 快照里的工单。
 * @returns 四类计数，顺序固定。
 */
export function statusSegments(tickets: readonly TicketSnapshot[]): readonly DistributionSegment[] {
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
    { key: 'ready', label: '可接', count: ready },
    { key: 'blocked', label: '阻塞', count: blocked },
    { key: 'open', label: '其他开放', count: open },
    { key: 'closed', label: '已关闭', count: closed },
  ]
}

/**
 * 分类分布：bug、enhancement、未定级。
 * @param tickets - 快照里的工单。
 * @returns 三类计数，顺序固定。
 */
export function categorySegments(
  tickets: readonly TicketSnapshot[],
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
    { key: 'untriaged', label: '未定级', count: untriaged },
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
 * @returns 数值文案或“不可用”。
 */
export function metricText(value: MetricValue, format: (value: number) => string): string {
  return value.value === null ? '不可用' : format(value.value)
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
 * @returns 一句中文说明。
 */
export function pressureFacts(report: PressureDimensionReport): string {
  const signals =
    report.triggers.length === 0
      ? report.signals
      : report.signals.filter((signal) => report.triggers.includes(signal.metric))
  if (signals.length === 0) return '暂无可判定的指标。'
  return signals.map((signal) => pressureSignalText(signal.metric, signal.value)).join('，')
}

/** 压力维度缺数据时的说明。 */
export function pressureGaps(report: PressureDimensionReport): readonly string[] {
  return report.gaps.map((gap) => METRIC_GAP_TEXT[gap])
}

/**
 * 关注清单条目的原因文案。
 * @param item - 关注清单条目。
 * @returns 一句原因。
 */
export function attentionText(item: AttentionItem): string {
  switch (item.reason) {
    case 'untriaged-bug':
      return '缺陷还没定性'
    case 'stale':
      return `陈旧 ${String(item.evidence ?? 0)} 天未更新`
    case 'most-blocking':
      return `被 ${String(item.evidence ?? 0)} 张未关闭票挡住`
    case 'oldest-stalled':
      return `停滞 ${String(item.evidence ?? 0)} 天没人管`
  }
}

function pressureSignalText(metric: PressureMetric, value: number): string {
  switch (metric) {
    case 'backlog':
      return `开放积压 ${String(value)} 张`
    case 'netFlow':
      return `近 30 天净流入 ${value > 0 ? '+' : ''}${String(value)} 张`
    case 'blockedRatio':
      return `阻塞占比 ${formatPercent(value)}`
    case 'staleRatio':
      return `陈旧率 ${formatPercent(value)}`
    case 'stalled':
      return `停滞票 ${String(value)} 张`
  }
}
