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
import { useI18n } from './i18n.tsx'
import type { Translate } from './i18n-runtime.ts'
import {
  factSignals,
  formatPercent,
  gapNote,
  metricText,
  pressureDimensionBasis,
  pressureDimensionLabel,
  pressureFacts,
  pressureGaps,
  pressureTierLabel,
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
  const { t } = useI18n()
  const { snapshot } = props
  const { pressure, coverage } = snapshot.metrics

  return (
    <section data-testid="pressure-overview" style={SECTION_STYLE}>
      <div style={SECTION_TITLE_STYLE}>
        <span>{t('overview.pressure.title')}</span>
        <span
          data-testid="pressure-tier"
          title={t('overview.pressure.tierTitle')}
          style={TIER_BADGE_STYLES[pressure.tier]}
        >
          {pressureTierLabel(pressure.tier, t)}
        </span>
      </div>
      <div data-testid="metric-grid" style={DIMENSION_GRID_STYLE}>
        {pressure.dimensions.map((report) => (
          <DimensionCard
            key={report.dimension}
            report={report}
            rows={visibleRows(report, snapshot, t)}
          />
        ))}
      </div>
      <div style={NOTE_STYLE}>
        {t('overview.pressure.note')}
        {coverage.truncated ? (
          <span data-testid="pressure-coverage">
            {t('overview.pressure.coverage', {
              loaded: snapshot.loaded,
              total: snapshot.total,
            })}
          </span>
        ) : (
          t('overview.pressure.period')
        )}
      </div>
    </section>
  )
}

function DimensionCard(props: {
  readonly report: PressureDimensionReport
  readonly rows: readonly MetricRow[]
}): React.ReactElement {
  const { t } = useI18n()
  const { report } = props
  const name = pressureDimensionLabel(report.dimension, t)
  const tierLabel =
    report.tier === null ? t('overview.pressure.unavailable') : pressureTierLabel(report.tier, t)
  const basis = pressureDimensionBasis(report.dimension, t)

  return (
    <div
      data-testid={`pressure-${report.dimension}`}
      data-tier={report.tier}
      style={DIMENSION_CARD_STYLE}
    >
      <div style={DIMENSION_HEAD_STYLE}>
        <span style={DIMENSION_NAME_STYLE} title={t('overview.pressure.basis', { basis })}>
          {name}
        </span>
        {report.provisional ? (
          <span data-testid={`pressure-provisional-${report.dimension}`} style={PROVISIONAL_STYLE}>
            {t('overview.pressure.provisional')}
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
      <TierMeter
        tier={report.tier}
        label={t('overview.pressure.tierLabel', { name, tier: tierLabel })}
      />
      <div>
        <div data-testid={`pressure-facts-${report.dimension}`} style={DIMENSION_FACT_STYLE}>
          {pressureFacts(report, t)}
        </div>
        <div style={DIMENSION_BASIS_STYLE}>{t('overview.pressure.basis', { basis })}</div>
        {pressureGaps(report, t).map((gap) => (
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
  t: Translate,
): readonly MetricRow[] {
  const stated = new Set(factSignals(report).map((signal) => signal.metric))
  return dimensionRows(report.dimension, snapshot, t).filter(
    (row) => row.signal === undefined || !stated.has(row.signal),
  )
}

/**
 * 每个维度下面列哪些数字：规模看积压的去向，阻塞看占比与链长，时效看陈旧与停滞。
 * 样本截断统一在区块底部说明一次，不在每个数字后面重复。
 */
function dimensionRows(
  dimension: PressureDimension,
  snapshot: WorkspaceSnapshot,
  t: Translate,
): readonly MetricRow[] {
  const { metrics } = snapshot
  const count = (value: number): string => t('overview.metric.tickets', { count: value })
  switch (dimension) {
    case 'scale':
      return [
        {
          testId: 'metric-backlog',
          label: t('overview.metric.backlog'),
          value: count(metrics.openBacklog),
          signal: 'backlog',
        },
        {
          testId: 'metric-ready',
          label: t('overview.metric.readyCapacity'),
          value: count(metrics.readyCapacity),
        },
        {
          testId: 'metric-triage',
          label: t('overview.metric.triage'),
          value: count(metrics.needsTriage),
        },
      ]
    case 'blocking':
      return [
        {
          testId: 'metric-blocked-ratio',
          label: t('overview.metric.blockedRatio'),
          value: formatPercent(metrics.blockedRatio),
          signal: 'blockedRatio',
        },
        {
          testId: 'metric-chain',
          label: t('overview.metric.longestChain'),
          value: metricText(
            metrics.longestBlockerChain,
            (value) => t('overview.metric.layers', { count: value }),
            t,
          ),
          note: gapNote(metrics.longestBlockerChain, t),
        },
      ]
    case 'freshness':
      return [
        {
          testId: 'metric-stalled',
          label: t('overview.metric.stalled'),
          value: count(metrics.stalled),
          signal: 'stalled',
        },
        {
          testId: 'metric-stale',
          label: t('overview.metric.stale'),
          value: metricText(metrics.staleCount, count, t),
          note: gapNote(metrics.staleCount, t),
        },
        {
          testId: 'metric-oldest-update',
          label: t('overview.metric.oldestUpdate'),
          value: metricText(
            metrics.oldestUpdateDays,
            (value) => t('overview.metric.days', { count: value }),
            t,
          ),
          note: gapNote(metrics.oldestUpdateDays, t),
        },
      ]
  }
}
