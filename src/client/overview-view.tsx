/**
 * 概览视图：一屏之内回答项目概况与压力。只渲染宿主附在快照上的指标，
 * 不自己算判定，也不发起写操作；关注清单点击只切到列表并定位，不写提示词。
 */
import * as React from 'react'

import type {
  ErrorCode,
  MetricGap,
  MetricValue,
  PressureDimensionReport,
  SnapshotMetrics,
  WorkspaceSnapshot,
} from '../protocol/tracker.ts'
import { BACKEND_LABELS } from './backend-label.ts'
import { ErrorBanner } from './error-banner.tsx'
import { FolderIcon, RefreshIcon } from './icons.tsx'
import {
  ATTENTION_ITEM_STYLE,
  ATTENTION_LIST_STYLE,
  ATTENTION_REASON_STYLE,
  ATTENTION_REF_STYLE,
  ATTENTION_TITLE_STYLE,
  BAR_STYLE,
  CARD_BASIS_STYLE,
  CARD_FACT_STYLE,
  CARD_HEADING_STYLE,
  CARD_NAME_STYLE,
  IDENTITY_META_STYLE,
  IDENTITY_ROW_STYLE,
  IDENTITY_STYLE,
  LEGEND_DOT_STYLE,
  LEGEND_ITEM_STYLE,
  LEGEND_STYLE,
  METRIC_CARD_STYLE,
  METRIC_GRID_STYLE,
  METRIC_LABEL_STYLE,
  METRIC_NOTE_STYLE,
  METRIC_VALUE_STYLE,
  NOTE_STYLE,
  OVERVIEW_STYLE,
  PRESSURE_CARDS_STYLE,
  PRESSURE_CARD_STYLE,
  PROVISIONAL_STYLE,
  SECTION_STYLE,
  SECTION_TITLE_STYLE,
  SEGMENT_COLORS,
  TIER_BADGE_STYLES,
  UNAVAILABLE_BADGE_STYLE,
} from './overview-styles.ts'
import {
  attentionText,
  categorySegments,
  formatPercent,
  metricText,
  pressureFacts,
  pressureGaps,
  segmentRatio,
  statusSegments,
  PRESSURE_DIMENSION_BASIS,
  PRESSURE_DIMENSION_LABELS,
  PRESSURE_TIER_LABELS,
  type DistributionSegment,
} from './overview-text.ts'
import type { PanelClient } from './rpc.ts'
import { formatAge, useNow } from './snapshot-age.ts'
import { useSnapshotRequest } from './snapshot-request.ts'
import {
  AGE_STYLE,
  BACKEND_BADGE_STYLE,
  EMPTY_STYLE,
  REFRESH_BUTTON_STYLE,
  REPO_CHIP_STYLE,
  REPO_HOST_STYLE,
  REPO_NAME_STYLE,
} from './task-panel-styles.ts'

/** 概览视图依赖。 */
export interface OverviewViewProps {
  readonly client: PanelClient
  readonly workspaceRoot: string | undefined
  readonly now?: (() => number) | undefined
  /** 关注清单点击：切到列表并定位这张票；只读，不写提示词。 */
  readonly onOpenTicket: (ref: string) => void
  /** 环境问题导致快照失败时跳到环境检查。 */
  readonly onOpenEnvCheck: (code: ErrorCode) => void
}

/** 概览视图。 */
export function OverviewView(props: OverviewViewProps): React.ReactElement {
  const clock = props.now ?? Date.now
  const { snapshot, error, phase, refresh } = useSnapshotRequest(props.client, props.workspaceRoot)
  const nowValue = useNow(clock)
  const busy = phase === 'loading' || phase === 'refreshing'

  return (
    <div
      data-testid="overview-view"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      <Identity
        snapshot={snapshot}
        now={nowValue}
        loading={phase === 'loading'}
        busy={busy}
        onRefresh={refresh}
      />
      {error === null ? null : <ErrorBanner error={error} onOpenEnvCheck={props.onOpenEnvCheck} />}
      {snapshot === null ? (
        phase === 'loading' ? (
          <div data-testid="overview-loading" style={EMPTY_STYLE}>
            正在读取工单…
          </div>
        ) : null
      ) : (
        <div style={OVERVIEW_STYLE}>
          <PressureSection snapshot={snapshot} />
          <MetricsGrid snapshot={snapshot} />
          <CompositionSection snapshot={snapshot} />
          <AttentionSection items={snapshot.metrics.attention} onOpenTicket={props.onOpenTicket} />
        </div>
      )}
    </div>
  )
}

function Identity(props: {
  readonly snapshot: WorkspaceSnapshot | null
  readonly now: number
  readonly loading: boolean
  readonly busy: boolean
  readonly onRefresh: () => void
}): React.ReactElement {
  const snapshot = props.snapshot
  const host = snapshot?.repositoryHost ?? null

  return (
    <header style={IDENTITY_STYLE}>
      <div style={IDENTITY_ROW_STYLE}>
        <div style={REPO_CHIP_STYLE}>
          <FolderIcon />
          <span
            data-testid="overview-repo"
            style={REPO_NAME_STYLE}
            {...(snapshot === null ? {} : { title: snapshot.repository })}
          >
            {snapshot?.repository ?? (props.loading ? '正在识别仓库…' : '未识别到仓库')}
          </span>
        </div>
        {snapshot === null ? null : (
          <span data-testid="overview-backend" style={BACKEND_BADGE_STYLE}>
            {BACKEND_LABELS[snapshot.backend]}
          </span>
        )}
        {host === null ? null : (
          <span data-testid="overview-host" title={host} style={REPO_HOST_STYLE}>
            {host}
          </span>
        )}
      </div>
      <div style={IDENTITY_META_STYLE}>
        <span data-testid="overview-age" style={AGE_STYLE}>
          {snapshot === null ? '尚无快照' : formatAge(snapshot.fetchedAt, props.now)}
        </span>
        <span data-testid="overview-loaded">
          {snapshot === null
            ? props.loading
              ? '正在读取工单…'
              : '未读取到工单'
            : `已加载 ${String(snapshot.loaded)} / 共 ${String(snapshot.total)} 张`}
        </span>
        <button
          type="button"
          data-testid="overview-refresh"
          data-hover="soft"
          disabled={props.busy}
          onClick={props.onRefresh}
          style={{ ...REFRESH_BUTTON_STYLE, marginLeft: 'auto', opacity: props.busy ? 0.6 : 1 }}
        >
          <RefreshIcon />
          {props.busy ? '刷新中…' : '刷新'}
        </button>
      </div>
    </header>
  )
}

function PressureSection(props: { readonly snapshot: WorkspaceSnapshot }): React.ReactElement {
  const { pressure } = props.snapshot.metrics

  return (
    <section data-testid="pressure-overview" style={SECTION_STYLE}>
      <div style={SECTION_TITLE_STYLE}>
        <span>压力总览</span>
        <span data-testid="pressure-tier" style={TIER_BADGE_STYLES[pressure.tier]}>
          {PRESSURE_TIER_LABELS[pressure.tier]}
        </span>
      </div>
      <div style={PRESSURE_CARDS_STYLE}>
        {pressure.dimensions.map((report) => (
          <PressureCard key={report.dimension} report={report} />
        ))}
      </div>
      {props.snapshot.metrics.coverage.truncated ? (
        <div data-testid="pressure-coverage" style={NOTE_STYLE}>
          按已加载的 {String(props.snapshot.loaded)} / 共 {String(props.snapshot.total)} 张判定。
        </div>
      ) : null}
    </section>
  )
}

function PressureCard(props: { readonly report: PressureDimensionReport }): React.ReactElement {
  const { report } = props
  const facts = pressureFacts(report)

  return (
    <div
      data-testid={`pressure-${report.dimension}`}
      data-tier={report.tier}
      style={PRESSURE_CARD_STYLE}
    >
      <div style={CARD_HEADING_STYLE}>
        <span style={CARD_NAME_STYLE}>{PRESSURE_DIMENSION_LABELS[report.dimension]}</span>
        {report.tier === null ? (
          <span data-testid={`pressure-tier-${report.dimension}`} style={UNAVAILABLE_BADGE_STYLE}>
            不可用
          </span>
        ) : (
          <span
            data-testid={`pressure-tier-${report.dimension}`}
            style={TIER_BADGE_STYLES[report.tier]}
          >
            {PRESSURE_TIER_LABELS[report.tier]}
          </span>
        )}
        {report.provisional ? (
          <span data-testid={`pressure-provisional-${report.dimension}`} style={PROVISIONAL_STYLE}>
            暂估
          </span>
        ) : null}
      </div>
      <span style={CARD_BASIS_STYLE}>{PRESSURE_DIMENSION_BASIS[report.dimension]}</span>
      <span data-testid={`pressure-facts-${report.dimension}`} style={CARD_FACT_STYLE}>
        {facts}
      </span>
      {pressureGaps(report).map((gap) => (
        <span key={gap} data-testid={`pressure-gap-${report.dimension}`} style={NOTE_STYLE}>
          {gap}
        </span>
      ))}
    </div>
  )
}

function MetricsGrid(props: { readonly snapshot: WorkspaceSnapshot }): React.ReactElement {
  const { metrics, loaded, total } = props.snapshot
  const truncated = metrics.coverage.truncated
  const sample = truncated ? `样本 ${String(loaded)}/${String(total)}` : undefined

  return (
    <section style={SECTION_STYLE}>
      <div style={SECTION_TITLE_STYLE}>关键数字</div>
      <div data-testid="metric-grid" style={METRIC_GRID_STYLE}>
        <MetricCard
          testId="metric-backlog"
          label="开放积压"
          value={`${String(metrics.openBacklog)} 张`}
          note={sample}
        />
        <MetricCard
          testId="metric-ready"
          label="可接容量"
          value={`${String(metrics.readyCapacity)} 张`}
          note={sample}
        />
        <MetricCard
          testId="metric-triage"
          label="待 triage"
          value={`${String(metrics.needsTriage)} 张`}
          note={sample}
        />
        <MetricCard
          testId="metric-stale"
          label="陈旧票"
          value={metricText(metrics.staleCount, (value) => `${String(value)} 张`)}
          note={joinNotes(gapNote(metrics.staleCount), sample)}
        />
        <MetricCard
          testId="metric-opened"
          label="近 30 天新开"
          value={metricText(metrics.openedLast30Days, (value) => `${String(value)} 张`)}
          note={joinNotes(gapNote(metrics.openedLast30Days), sample)}
        />
        <MetricCard
          testId="metric-closed"
          label="近 30 天关闭"
          value={metricText(metrics.closedLast30Days, (value) => `${String(value)} 张`)}
          note={joinNotes(
            gapNote(metrics.closedLast30Days),
            truncated ? '可能低估' : undefined,
            sample,
          )}
        />
        <MetricCard
          testId="metric-net-flow"
          label="净流入"
          value={metricText(metrics.netFlow, (value) => `${value > 0 ? '+' : ''}${String(value)}`)}
          note={joinNotes(gapNote(metrics.netFlow), truncated ? '可能高估' : undefined, sample)}
        />
        <MetricCard
          testId="metric-oldest-update"
          label="最久未动"
          value={metricText(metrics.oldestUpdateDays, (value) => `${String(value)} 天`)}
          note={joinNotes(gapNote(metrics.oldestUpdateDays), sample)}
        />
        <MetricCard
          testId="metric-chain"
          label="最长阻塞链"
          value={metricText(metrics.longestBlockerChain, (value) => `${String(value)} 层`)}
          note={joinNotes(gapNote(metrics.longestBlockerChain), sample)}
        />
      </div>
    </section>
  )
}

/** 把缺口、低估与样本范围合成一行小字；没有内容时不显示。 */
function joinNotes(...notes: readonly (string | undefined)[]): string | undefined {
  const present = notes.filter((note): note is string => note !== undefined)
  return present.length === 0 ? undefined : present.join(' · ')
}

function MetricCard(props: {
  readonly testId: string
  readonly label: string
  readonly value: string
  readonly note?: string | undefined
}): React.ReactElement {
  return (
    <div data-testid={props.testId} style={METRIC_CARD_STYLE}>
      <span style={METRIC_LABEL_STYLE}>{props.label}</span>
      <span style={METRIC_VALUE_STYLE}>{props.value}</span>
      {props.note === undefined ? null : (
        <span style={METRIC_NOTE_STYLE} title={props.note}>
          {props.note}
        </span>
      )}
    </div>
  )
}

function CompositionSection(props: { readonly snapshot: WorkspaceSnapshot }): React.ReactElement {
  return (
    <section data-testid="composition" style={SECTION_STYLE}>
      <div style={SECTION_TITLE_STYLE}>构成</div>
      <DistributionBar
        testId="status-distribution"
        title="状态分布"
        segments={statusSegments(props.snapshot.tickets)}
      />
      <DistributionBar
        testId="category-distribution"
        title="分类分布"
        segments={categorySegments(props.snapshot.tickets)}
      />
    </section>
  )
}

function DistributionBar(props: {
  readonly testId: string
  readonly title: string
  readonly segments: readonly DistributionSegment[]
}): React.ReactElement {
  const total = props.segments.reduce((sum, segment) => sum + segment.count, 0)
  let offset = 0
  const rects = props.segments
    .filter((segment) => segment.count > 0)
    .map((segment) => {
      const width = segmentRatio(segment, total) * 100
      const rect = (
        <rect
          key={segment.key}
          x={offset}
          y={0}
          width={width}
          height={8}
          fill={SEGMENT_COLORS[segment.key]}
        />
      )
      offset += width
      return rect
    })

  return (
    <div data-testid={props.testId} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={CARD_BASIS_STYLE}>{props.title}</span>
      <div style={BAR_STYLE}>
        <svg
          viewBox="0 0 100 8"
          preserveAspectRatio="none"
          width="100%"
          height="8"
          aria-hidden="true"
          style={{ display: 'block' }}
        >
          {rects}
        </svg>
      </div>
      <div style={LEGEND_STYLE}>
        {props.segments.map((segment) => (
          <span
            key={segment.key}
            data-testid={`${props.testId}-${segment.key}`}
            style={LEGEND_ITEM_STYLE}
          >
            <span
              aria-hidden="true"
              style={{
                ...LEGEND_DOT_STYLE,
                background: SEGMENT_COLORS[segment.key],
              }}
            />
            {segment.label} {String(segment.count)}（{formatPercent(segmentRatio(segment, total))}）
          </span>
        ))}
      </div>
    </div>
  )
}

function AttentionSection(props: {
  readonly items: SnapshotMetrics['attention']
  readonly onOpenTicket: (ref: string) => void
}): React.ReactElement {
  return (
    <section data-testid="attention" style={SECTION_STYLE}>
      <div style={SECTION_TITLE_STYLE}>
        <span>关注清单</span>
        <span style={CARD_BASIS_STYLE}>{String(props.items.length)} 张</span>
      </div>
      {props.items.length === 0 ? (
        <div data-testid="attention-empty" style={NOTE_STYLE}>
          没有需要特别关注的票。
        </div>
      ) : (
        <div style={ATTENTION_LIST_STYLE}>
          {props.items.map((item) => (
            <button
              key={item.ref}
              type="button"
              data-testid="attention-item"
              data-ref={item.ref}
              data-reason={item.reason}
              data-hover="card"
              onClick={() => {
                props.onOpenTicket(item.ref)
              }}
              style={ATTENTION_ITEM_STYLE}
            >
              <span style={ATTENTION_REF_STYLE} title={item.ref}>
                {displayRef(item)}
              </span>
              <span style={ATTENTION_TITLE_STYLE} title={item.title}>
                {item.title}
              </span>
              <span style={ATTENTION_REASON_STYLE}>{attentionText(item)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

/** 关注清单里的引用：本地 Markdown 路径太长时只保留文件名。 */
function displayRef(item: { readonly ref: string }): string {
  if (!item.ref.includes('/')) return item.ref
  const name = item.ref.slice(item.ref.lastIndexOf('/') + 1)
  return name.length > 0 ? name : item.ref
}

/** 缺口在关键数字卡片里的短说明。 */
const GAP_NOTES: Readonly<Record<MetricGap, string>> = {
  'no-timestamps': '缺时间数据',
  'no-closed-time': '缺关闭时间',
  'no-dependency-edges': '缺依赖边',
}

function gapNote(value: MetricValue): string | undefined {
  return value.gap === null ? undefined : GAP_NOTES[value.gap]
}
