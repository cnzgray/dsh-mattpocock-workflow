/**
 * 概览的压力区：每个维度一张卡片，档位、触发原因与支撑它的关键数字放在一起，
 * 读者不用在“压力”和“数字”两块之间来回对照。档位与数字都来自宿主附上的指标。
 */
import * as React from 'react'

import type {
  PressureDimension,
  PressureDimensionReport,
  PressureMetric,
  WorkspaceSnapshot,
} from '../protocol/tracker.ts'
import { TierMeter } from './overview-charts.tsx'
import {
  DIMENSION_BASIS_STYLE,
  DIMENSION_CARD_STYLE,
  DIMENSION_FACT_STYLE,
  DIMENSION_GRID_STYLE,
  DIMENSION_HEAD_STYLE,
  DIMENSION_NAME_STYLE,
  METRIC_ROW_LABEL_STYLE,
  METRIC_ROW_NOTE_STYLE,
  METRIC_ROW_VALUE_STYLE,
  METRIC_ROWS_STYLE,
  NOTE_STYLE,
  PROVISIONAL_STYLE,
  SECTION_STYLE,
  SECTION_TITLE_STYLE,
  TIER_BADGE_STYLES,
  TIER_COLORS,
  TIER_DOT_STYLE,
  TIER_TEXT_STYLE,
} from './overview-styles.ts'
import {
  factSignals,
  formatPercent,
  gapNote,
  metricText,
  pressureFacts,
  pressureGaps,
  PRESSURE_DIMENSION_BASIS,
  PRESSURE_DIMENSION_LABELS,
  PRESSURE_TIER_LABELS,
} from './overview-text.ts'
import { COLORS } from './task-panel-styles.ts'

/** 维度卡片里的一行数字。 */
interface MetricRow {
  readonly testId: string
  readonly label: string
  readonly value: string
  readonly note?: string | undefined
  /** 这一行对应的判档指标；已经写在触发说明里时不再重复列出。 */
  readonly signal?: PressureMetric
}

/** 压力总览：整体档位在标题行，三个维度卡片在下面，窄面板自动叠成一列。 */
export function PressureSection(props: {
  readonly snapshot: WorkspaceSnapshot
}): React.ReactElement {
  const { snapshot } = props
  const { pressure, coverage } = snapshot.metrics

  return (
    <section data-testid="pressure-overview" style={SECTION_STYLE}>
      <div style={SECTION_TITLE_STYLE}>
        <span>压力总览</span>
        <span
          data-testid="pressure-tier"
          title="整体档位取三个维度里最重的一档"
          style={TIER_BADGE_STYLES[pressure.tier]}
        >
          {PRESSURE_TIER_LABELS[pressure.tier]}
        </span>
      </div>
      <div data-testid="metric-grid" style={DIMENSION_GRID_STYLE}>
        {pressure.dimensions.map((report) => (
          <DimensionCard
            key={report.dimension}
            report={report}
            rows={visibleRows(report, snapshot)}
          />
        ))}
      </div>
      <div style={NOTE_STYLE}>
        整体档位取三个维度里最重的一档
        {coverage.truncated ? (
          <span data-testid="pressure-coverage">
            ；按已加载的 {String(snapshot.loaded)} / 共 {String(snapshot.total)} 张判定。
          </span>
        ) : (
          '。'
        )}
      </div>
    </section>
  )
}

function DimensionCard(props: {
  readonly report: PressureDimensionReport
  readonly rows: readonly MetricRow[]
}): React.ReactElement {
  const { report } = props
  const name = PRESSURE_DIMENSION_LABELS[report.dimension]
  const tierLabel = report.tier === null ? '不可用' : PRESSURE_TIER_LABELS[report.tier]

  return (
    <div
      data-testid={`pressure-${report.dimension}`}
      data-tier={report.tier}
      style={DIMENSION_CARD_STYLE}
    >
      <div style={DIMENSION_HEAD_STYLE}>
        <span
          style={DIMENSION_NAME_STYLE}
          title={`看${PRESSURE_DIMENSION_BASIS[report.dimension]}`}
        >
          {name}
        </span>
        {report.provisional ? (
          <span data-testid={`pressure-provisional-${report.dimension}`} style={PROVISIONAL_STYLE}>
            暂估
          </span>
        ) : null}
        <span style={{ ...TIER_TEXT_STYLE, marginLeft: 'auto' }}>
          <span
            aria-hidden="true"
            style={{
              ...TIER_DOT_STYLE,
              background: report.tier === null ? COLORS.tertiary : TIER_COLORS[report.tier],
            }}
          />
          <span data-testid={`pressure-tier-${report.dimension}`}>{tierLabel}</span>
        </span>
      </div>
      <TierMeter tier={report.tier} label={`${name}：${tierLabel}`} />
      <div>
        <div data-testid={`pressure-facts-${report.dimension}`} style={DIMENSION_FACT_STYLE}>
          {pressureFacts(report)}
        </div>
        <div style={DIMENSION_BASIS_STYLE}>看{PRESSURE_DIMENSION_BASIS[report.dimension]}</div>
        {pressureGaps(report).map((gap) => (
          <div key={gap} data-testid={`pressure-gap-${report.dimension}`} style={NOTE_STYLE}>
            {gap}
          </div>
        ))}
      </div>
      <dl style={METRIC_ROWS_STYLE}>
        {props.rows.map((row) => (
          <div key={row.testId} data-testid={row.testId} style={{ display: 'contents' }}>
            <dt style={METRIC_ROW_LABEL_STYLE}>{row.label}</dt>
            <dd style={METRIC_ROW_VALUE_STYLE}>{row.value}</dd>
            {row.note === undefined ? null : <dd style={METRIC_ROW_NOTE_STYLE}>{row.note}</dd>}
          </div>
        ))}
      </dl>
    </div>
  )
}

/** 去掉已经写进触发说明的那几行，同一个数字不在一张卡片里出现两次。 */
function visibleRows(
  report: PressureDimensionReport,
  snapshot: WorkspaceSnapshot,
): readonly MetricRow[] {
  const stated = new Set(factSignals(report).map((signal) => signal.metric))
  return dimensionRows(report.dimension, snapshot).filter(
    (row) => row.signal === undefined || !stated.has(row.signal),
  )
}

const count = (value: number): string => `${String(value)} 张`

/**
 * 每个维度下面列哪些数字：规模看积压的去向，阻塞看占比与链长，时效看陈旧与停滞。
 * 样本截断统一在区块底部说明一次，不在每个数字后面重复。
 */
function dimensionRows(
  dimension: PressureDimension,
  snapshot: WorkspaceSnapshot,
): readonly MetricRow[] {
  const { metrics } = snapshot
  switch (dimension) {
    case 'scale':
      return [
        {
          testId: 'metric-backlog',
          label: '开放积压',
          value: count(metrics.openBacklog),
          signal: 'backlog',
        },
        { testId: 'metric-ready', label: '可接容量', value: count(metrics.readyCapacity) },
        { testId: 'metric-triage', label: '待 triage', value: count(metrics.needsTriage) },
      ]
    case 'blocking':
      return [
        {
          testId: 'metric-blocked-ratio',
          label: '阻塞占比',
          value: formatPercent(metrics.blockedRatio),
          signal: 'blockedRatio',
        },
        {
          testId: 'metric-chain',
          label: '最长阻塞链',
          value: metricText(metrics.longestBlockerChain, (value) => `${String(value)} 层`),
          note: gapNote(metrics.longestBlockerChain),
        },
      ]
    case 'freshness':
      return [
        {
          testId: 'metric-stalled',
          label: '停滞票',
          value: count(metrics.stalled),
          signal: 'stalled',
        },
        {
          testId: 'metric-stale',
          label: '陈旧票',
          value: metricText(metrics.staleCount, count),
          note: gapNote(metrics.staleCount),
        },
        {
          testId: 'metric-oldest-update',
          label: '最久未动',
          value: metricText(metrics.oldestUpdateDays, (value) => `${String(value)} 天`),
          note: gapNote(metrics.oldestUpdateDays),
        },
      ]
  }
}
