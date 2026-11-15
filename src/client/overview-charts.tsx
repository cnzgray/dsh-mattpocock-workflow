/**
 * 概览里的图表：档位刻度条、每周流量柱状图、未更新天数分布与构成分段条。
 * 都是纯展示组件，数据由调用方整理好传入；悬停与键盘聚焦给出同样的读数。
 */
import * as React from 'react'

import type { PressureTier } from '../protocol/tracker.ts'
import { useI18n } from './i18n.tsx'
import type { Translate } from './i18n-runtime.ts'
import { shortDate, tierLevel, type AgeBucket, type FlowBucket } from './overview-chart-data.ts'
import {
  AGE_BAR_STYLE,
  AGE_COLORS,
  AGE_COUNT_STYLE,
  AGE_LABEL_STYLE,
  AGE_LIST_STYLE,
  AGE_TRACK_STYLE,
  EMPTY_BAR_STYLE,
  FLOW_AXIS_LABEL_STYLE,
  FLOW_AXIS_STYLE,
  FLOW_BAR_STYLE,
  FLOW_PEAK_LABEL_STYLE,
  FLOW_PEAK_LINE_STYLE,
  FLOW_PLOT_STYLE,
  FLOW_WEEK_STYLE,
  NEUTRAL_FILL,
  READOUT_STYLE,
  READOUT_VALUE_STYLE,
  SEGMENTED_BAR_STYLE,
  SEGMENT_STYLE,
  SERIES_KEY_STYLE,
  TIER_METER_STEP_STYLE,
  TIER_METER_STYLE,
} from './overview-chart-styles.ts'
import {
  LEGEND_DOT_STYLE,
  LEGEND_ITEM_STYLE,
  LEGEND_STYLE,
  SEGMENT_COLORS,
  SEGMENT_INK,
  TIER_COLORS,
} from './overview-styles.ts'
import { formatPercent, segmentRatio, type DistributionSegment } from './overview-text.ts'
import { COLORS } from './task-panel-styles.ts'

/** 档位刻度条：轻松亮 1 格、正常 2 格、吃紧 3 格，颜色跟随档位。 */
export function TierMeter(props: {
  readonly tier: PressureTier | null
  readonly label: string
}): React.ReactElement {
  const level = tierLevel(props.tier)
  const fill = props.tier === null ? COLORS.track : TIER_COLORS[props.tier]

  return (
    <span role="img" aria-label={props.label} title={props.label} style={TIER_METER_STYLE}>
      {[1, 2, 3].map((step) => (
        <span
          key={step}
          style={{
            ...TIER_METER_STEP_STYLE,
            background: step <= level ? fill : COLORS.track,
          }}
        />
      ))}
    </span>
  )
}

const OPENED_COLOR = COLORS.accent
const CLOSED_COLOR = NEUTRAL_FILL

/** 每周新开与关闭的成对柱状图。 */
export function FlowChart(props: { readonly buckets: readonly FlowBucket[] }): React.ReactElement {
  const { t } = useI18n()
  const { buckets } = props
  const [active, setActive] = React.useState<number | null>(null)
  const hasClosed = buckets.some((bucket) => bucket.closed !== null)
  const peak = Math.max(1, ...buckets.map((bucket) => Math.max(bucket.opened, bucket.closed ?? 0)))
  const shown = buckets[active ?? buckets.length - 1]

  return (
    <div data-testid="flow-chart" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <FlowLegend hasClosed={hasClosed} />
      <div
        style={{ ...FLOW_PLOT_STYLE, marginTop: 14 }}
        onPointerLeave={() => {
          setActive(null)
        }}
      >
        <div aria-hidden="true" style={FLOW_PEAK_LINE_STYLE}>
          <span style={FLOW_PEAK_LABEL_STYLE}>{String(peak)}</span>
        </div>
        {buckets.map((bucket, index) => (
          <div
            key={bucket.start}
            data-testid="flow-week"
            tabIndex={0}
            aria-label={flowSummary(bucket, t)}
            onPointerEnter={() => {
              setActive(index)
            }}
            onFocus={() => {
              setActive(index)
            }}
            onBlur={() => {
              setActive(null)
            }}
            style={{
              ...FLOW_WEEK_STYLE,
              background: active === index ? COLORS.track : 'transparent',
            }}
          >
            <FlowBar
              value={bucket.opened}
              peak={peak}
              color={OPENED_COLOR}
              dim={active}
              index={index}
            />
            {bucket.closed === null ? null : (
              <FlowBar
                value={bucket.closed}
                peak={peak}
                color={CLOSED_COLOR}
                dim={active}
                index={index}
              />
            )}
          </div>
        ))}
      </div>
      <div aria-hidden="true" style={FLOW_AXIS_STYLE}>
        {buckets.map((bucket, index) => (
          <span key={bucket.start} style={FLOW_AXIS_LABEL_STYLE}>
            {axisLabel(bucket, buckets.length - 1 - index, t)}
          </span>
        ))}
      </div>
      {shown === undefined ? null : <FlowReadout bucket={shown} />}
    </div>
  )
}

function FlowBar(props: {
  readonly value: number
  readonly peak: number
  readonly color: string
  readonly dim: number | null
  readonly index: number
}): React.ReactElement {
  return (
    <span
      style={{
        ...FLOW_BAR_STYLE,
        // 0 也留一根发丝高的底，让“这一周确实是 0”可见。
        height: props.value === 0 ? 1 : `${String((props.value / props.peak) * 100)}%`,
        background: props.value === 0 ? COLORS.borderStrong : props.color,
        opacity: props.dim === null || props.dim === props.index ? 1 : 0.45,
      }}
    />
  )
}

function FlowLegend(props: { readonly hasClosed: boolean }): React.ReactElement {
  const { t } = useI18n()
  return (
    <div style={LEGEND_STYLE}>
      <span style={LEGEND_ITEM_STYLE}>
        <span aria-hidden="true" style={{ ...SERIES_KEY_STYLE, background: OPENED_COLOR }} />
        {t('overview.flow.opened')}
      </span>
      {props.hasClosed ? (
        <span style={LEGEND_ITEM_STYLE}>
          <span aria-hidden="true" style={{ ...SERIES_KEY_STYLE, background: CLOSED_COLOR }} />
          {t('overview.flow.closed')}
        </span>
      ) : null}
    </div>
  )
}

function FlowReadout(props: { readonly bucket: FlowBucket }): React.ReactElement {
  const { t } = useI18n()
  const { bucket } = props
  return (
    <div data-testid="flow-readout" aria-live="polite" style={READOUT_STYLE}>
      <span>{flowRange(bucket)}</span>
      <span>
        <span style={READOUT_VALUE_STYLE}>{String(bucket.opened)}</span> {t('overview.flow.opened')}
      </span>
      {bucket.closed === null ? null : (
        <span>
          <span style={READOUT_VALUE_STYLE}>{String(bucket.closed)}</span>{' '}
          {t('overview.flow.closed')}
        </span>
      )}
    </div>
  )
}

/** 横轴隔一周标一次起始日期，最近一周标“本周”，窄面板里不挤。 */
function axisLabel(bucket: FlowBucket, weeksAgo: number, t: Translate): string {
  if (weeksAgo === 0) return t('overview.flow.thisWeek')
  return weeksAgo % 2 === 0 ? shortDate(bucket.start) : ''
}

function flowRange(bucket: FlowBucket): string {
  // 终点不含，展示时退一天，读起来是闭区间。
  return `${shortDate(bucket.start)}–${shortDate(bucket.end - 1)}`
}

function flowSummary(bucket: FlowBucket, t: Translate): string {
  const range = flowRange(bucket)
  return bucket.closed === null
    ? t('overview.flow.summaryNoClosed', { range, opened: bucket.opened })
    : t('overview.flow.summaryClosed', {
        range,
        opened: bucket.opened,
        closed: bucket.closed,
      })
}

/** 开放票按未更新天数分档的横向条形图；条长按最大档归一。 */
export function AgeHistogram(props: {
  readonly buckets: readonly AgeBucket[]
}): React.ReactElement {
  const { t } = useI18n()
  const peak = Math.max(1, ...props.buckets.map((bucket) => bucket.count))

  return (
    <div data-testid="age-histogram" style={AGE_LIST_STYLE}>
      {props.buckets.map((bucket) => (
        <React.Fragment key={bucket.key}>
          <span style={AGE_LABEL_STYLE}>{bucket.label}</span>
          <span
            style={AGE_TRACK_STYLE}
            title={t('overview.age.countTitle', { label: bucket.label, count: bucket.count })}
          >
            <span
              style={{
                ...AGE_BAR_STYLE,
                display: 'block',
                width: `${String((bucket.count / peak) * 100)}%`,
                background: AGE_COLORS[bucket.key],
              }}
            />
          </span>
          <span data-testid={`age-${bucket.key}`} style={AGE_COUNT_STYLE}>
            {String(bucket.count)}
          </span>
        </React.Fragment>
      ))}
    </div>
  )
}

/** 段内放得下占比文字的最小份额。 */
const INLINE_LABEL_MIN_RATIO = 0.12

/** 高分段条：一个整体拆成几块，块内印占比，图例列出名称与数量。 */
export function SegmentedBar(props: {
  readonly testId: string
  readonly title: string
  readonly segments: readonly DistributionSegment[]
}): React.ReactElement {
  const { t } = useI18n()
  const total = props.segments.reduce((sum, segment) => sum + segment.count, 0)
  const visible = props.segments.filter((segment) => segment.count > 0)
  const summary = props.segments
    .map((segment) =>
      t('overview.distribution.legend', {
        label: segment.label,
        count: segment.count,
        ratio: formatPercent(segmentRatio(segment, total)),
      }),
    )
    .join(t('common.clauseSeparator'))

  return (
    <div data-testid={props.testId} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ color: COLORS.secondary, fontSize: 11 }}>{props.title}</span>
      {visible.length === 0 ? (
        <div style={EMPTY_BAR_STYLE} />
      ) : (
        <div
          role="img"
          aria-label={t('overview.distribution.aria', { title: props.title, summary })}
          style={SEGMENTED_BAR_STYLE}
        >
          {visible.map((segment) => {
            const ratio = segmentRatio(segment, total)
            return (
              <span
                key={segment.key}
                title={t('overview.distribution.itemTitle', {
                  label: segment.label,
                  count: segment.count,
                  ratio: formatPercent(ratio),
                })}
                style={{
                  ...SEGMENT_STYLE,
                  flex: `${String(segment.count)} 1 0`,
                  background: SEGMENT_COLORS[segment.key],
                  color: SEGMENT_INK[segment.key],
                }}
              >
                {ratio >= INLINE_LABEL_MIN_RATIO ? formatPercent(ratio) : null}
              </span>
            )
          })}
        </div>
      )}
      <div style={LEGEND_STYLE}>
        {props.segments.map((segment) => (
          <span
            key={segment.key}
            data-testid={`${props.testId}-${segment.key}`}
            style={LEGEND_ITEM_STYLE}
          >
            <span
              aria-hidden="true"
              style={{ ...LEGEND_DOT_STYLE, background: SEGMENT_COLORS[segment.key] }}
            />
            {t('overview.distribution.legend', {
              label: segment.label,
              count: segment.count,
              ratio: formatPercent(segmentRatio(segment, total)),
            })}
          </span>
        ))}
      </div>
    </div>
  )
}
