/**
 * 概览视图：一屏之内回答项目概况与压力。只渲染宿主附在快照上的指标，
 * 不自己算判定，也不发起写操作；关注清单点击只切到列表并定位，不写提示词。
 */
import * as React from 'react'

import type {
  ErrorCode,
  SnapshotMetrics,
  SnapshotSource,
  WorkspaceSnapshot,
} from '../protocol/tracker.ts'
import { backendLabel } from './backend-label.ts'
import { ErrorBanner } from './error-banner.tsx'
import { FolderIcon, RefreshIcon } from './icons.tsx'
import { useI18n } from './i18n.tsx'
import { updateAgeBuckets, weeklyFlow } from './overview-chart-data.ts'
import { CHART_CAPTION_STYLE, CHART_CARD_STYLE } from './overview-chart-styles.ts'
import { AgeHistogram, FlowChart, SegmentedBar } from './overview-charts.tsx'
import { PressureSection } from './overview-pressure.tsx'
import {
  ATTENTION_ITEM_STYLE,
  ATTENTION_LIST_STYLE,
  ATTENTION_REASON_STYLE,
  ATTENTION_REF_STYLE,
  ATTENTION_TITLE_STYLE,
  CARD_BASIS_STYLE,
  FLAT_METRIC_STYLE,
  FLOW_STATS_STYLE,
  IDENTITY_META_STYLE,
  IDENTITY_ROW_STYLE,
  IDENTITY_SEPARATOR_STYLE,
  IDENTITY_STYLE,
  METRIC_LABEL_STYLE,
  METRIC_NOTE_STYLE,
  METRIC_VALUE_STYLE,
  NOTE_STYLE,
  OVERVIEW_STYLE,
  SECTION_STYLE,
  SECTION_TITLE_STYLE,
} from './overview-styles.ts'
import {
  attentionText,
  gapNote,
  joinNotes,
  sampleNote,
  categorySegments,
  metricText,
  statusSegments,
} from './overview-text.ts'
import { formatRelativeTime } from './relative-time.ts'
import { useNow } from './snapshot-age.ts'
import { snapshotRefreshNotice, type SnapshotRequestState } from './snapshot-request.ts'
import {
  AGE_STYLE,
  BACKEND_BADGE_STYLE,
  COLORS,
  EMPTY_STYLE,
  REFRESH_BUTTON_STYLE,
  REPO_CHIP_STYLE,
  REPO_HOST_STYLE,
  REPO_NAME_STYLE,
} from './task-panel-styles.ts'

/** 刷新失败原因：贴在数据时间旁边，说明数据没更新，但不盖住概览。 */
const REFRESH_ERROR_STYLE: React.CSSProperties = {
  color: COLORS.error,
  fontSize: 11,
  maxWidth: 160,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

/** 概览视图依赖。 */
export interface OverviewViewProps {
  /** 面板共用的快照状态：首屏两阶段加载与刷新都在面板层，视图只渲染。 */
  readonly request: SnapshotRequestState
  readonly workspaceRoot: string | undefined
  readonly now?: (() => number) | undefined
  /** 关注清单点击：切到列表并定位这张票；只读，不写提示词。 */
  readonly onOpenTicket: (ref: string) => void
  /** 环境问题导致快照失败时跳到环境检查。 */
  readonly onOpenEnvCheck: (code: ErrorCode) => void
}

/** 概览视图。 */
export function OverviewView(props: OverviewViewProps): React.ReactElement {
  const { t } = useI18n()
  const clock = props.now ?? Date.now
  const { snapshot, error, refreshError, phase, refresh } = props.request
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
        notice={snapshotRefreshNotice(snapshot, refreshError, t)}
        onRefresh={refresh}
      />
      {error === null ? null : <ErrorBanner error={error} onOpenEnvCheck={props.onOpenEnvCheck} />}
      {snapshot === null ? (
        phase === 'loading' ? (
          <div data-testid="overview-loading" style={EMPTY_STYLE}>
            {t('snapshot.loading')}
          </div>
        ) : null
      ) : (
        <div style={OVERVIEW_STYLE}>
          <PressureSection snapshot={snapshot} />
          <FlowSection snapshot={snapshot} />
          <AgeSection snapshot={snapshot} />
          <CompositionSection snapshot={snapshot} />
          <AttentionSection items={snapshot.metrics.attention} onOpenTicket={props.onOpenTicket} />
        </div>
      )}
    </div>
  )
}

/** 数据来源徽标：本地缓存的指标不是实时的，标出来才不会误判。 */
function SourceBadge(props: { readonly source: SnapshotSource }): React.ReactElement {
  const { t } = useI18n()
  return (
    <span
      data-testid="overview-source"
      style={{
        ...BACKEND_BADGE_STYLE,
        color: props.source === 'cache' ? COLORS.warn : COLORS.secondary,
      }}
    >
      {props.source === 'cache' ? t('source.cache') : t('source.live')}
    </span>
  )
}

function Identity(props: {
  readonly snapshot: WorkspaceSnapshot | null
  readonly now: number
  readonly loading: boolean
  readonly busy: boolean
  /** 数据旁边的失败原因：有数据时显示在时间旁边，不用整屏横幅盖住概览。 */
  readonly notice: string | null
  readonly onRefresh: () => void
}): React.ReactElement {
  const { t } = useI18n()
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
            {snapshot?.repository ??
              (props.loading ? t('repo.identifying') : t('repo.unidentified'))}
          </span>
        </div>
        {snapshot === null ? null : (
          <span data-testid="overview-backend" style={BACKEND_BADGE_STYLE}>
            {backendLabel(snapshot.backend, t)}
          </span>
        )}
        {/* 数据来源：本地缓存的指标不是实时的，必须标出来。 */}
        {snapshot === null ? null : <SourceBadge source={snapshot.source} />}
        {host === null ? null : (
          <span data-testid="overview-host" title={host} style={REPO_HOST_STYLE}>
            {host}
          </span>
        )}
      </div>
      <div style={IDENTITY_META_STYLE}>
        <span data-testid="overview-age" style={{ ...AGE_STYLE, fontSize: 'inherit' }}>
          {snapshot === null
            ? t('snapshot.none')
            : formatRelativeTime(snapshot.fetchedAt, props.now, t)}
        </span>
        {props.notice === null ? null : (
          <span
            data-testid="overview-refresh-error"
            title={props.notice}
            style={REFRESH_ERROR_STYLE}
          >
            {props.notice}
          </span>
        )}
        <span aria-hidden="true" style={IDENTITY_SEPARATOR_STYLE}>
          ·
        </span>
        <span data-testid="overview-loaded">
          {snapshot === null
            ? props.loading
              ? t('snapshot.loading')
              : t('snapshot.notLoaded')
            : t('overview.loaded', { loaded: snapshot.loaded, total: snapshot.total })}
        </span>
        <OverviewRefreshButton busy={props.busy} onRefresh={props.onRefresh} />
      </div>
    </header>
  )
}

function OverviewRefreshButton(props: {
  readonly busy: boolean
  readonly onRefresh: () => void
}): React.ReactElement {
  const { t } = useI18n()
  return (
    <button
      type="button"
      data-testid="overview-refresh"
      data-hover="soft"
      disabled={props.busy}
      onClick={props.onRefresh}
      style={{
        ...REFRESH_BUTTON_STYLE,
        // 按钮自带 6px 内边距，负外边距让文字落回右侧留白线，与上方徽章右缘对齐。
        margin: '-3px -6px -3px auto',
        opacity: props.busy ? 0.6 : 1,
      }}
    >
      <RefreshIcon />
      {props.busy ? t('refresh.busy') : t('refresh.action')}
    </button>
  )
}

/** 流量图回看的周数：比 30 天窗口长，能看出趋势。 */
const FLOW_WEEKS = 8

function FlowSection(props: { readonly snapshot: WorkspaceSnapshot }): React.ReactElement {
  const { t } = useI18n()
  const { metrics, tickets, fetchedAt } = props.snapshot
  const truncated = metrics.coverage.truncated
  const sample = sampleNote(props.snapshot, t)
  const count = (value: number): string => t('overview.metric.tickets', { count: value })

  return (
    <section data-testid="flow" style={SECTION_STYLE}>
      <div style={SECTION_TITLE_STYLE}>{t('overview.section.flow')}</div>
      <div style={CHART_CARD_STYLE}>
        <div style={FLOW_STATS_STYLE}>
          <MetricCard
            testId="metric-opened"
            label={t('overview.metric.opened30')}
            value={metricText(metrics.openedLast30Days, count, t)}
            note={joinNotes(gapNote(metrics.openedLast30Days, t), sample)}
          />
          <MetricCard
            testId="metric-closed"
            label={t('overview.metric.closed30')}
            value={metricText(metrics.closedLast30Days, count, t)}
            note={joinNotes(
              gapNote(metrics.closedLast30Days, t),
              truncated ? t('overview.metric.likelyUnder') : undefined,
              sample,
            )}
          />
          <MetricCard
            testId="metric-net-flow"
            label={t('overview.metric.netFlow')}
            value={metricText(
              metrics.netFlow,
              (value) => `${value > 0 ? '+' : ''}${String(value)}`,
              t,
            )}
            note={joinNotes(
              gapNote(metrics.netFlow, t),
              truncated ? t('overview.metric.likelyOver') : undefined,
              sample,
            )}
          />
        </div>
        {hasTicketTimes(props.snapshot) ? (
          <FlowChart
            buckets={weeklyFlow(tickets, fetchedAt, {
              weeks: FLOW_WEEKS,
              closedAvailable: metrics.closedLast30Days.value !== null,
            })}
          />
        ) : null}
      </div>
    </section>
  )
}

/**
 * 后端是否给出了真实的工单时间。宿主在没有时间时把“近 30 天新开”标为不可用，
 * 图表据此决定画不画，不自己再判一遍后端类型。
 */
function hasTicketTimes(snapshot: WorkspaceSnapshot): boolean {
  return snapshot.metrics.openedLast30Days.value !== null
}

/** 时效分布只在有真实工单时间时出现；本地 Markdown 的文件时间不算。 */
function AgeSection(props: { readonly snapshot: WorkspaceSnapshot }): React.ReactElement | null {
  const { t } = useI18n()
  const { tickets, fetchedAt } = props.snapshot
  if (!hasTicketTimes(props.snapshot)) return null

  return (
    <section data-testid="age" style={SECTION_STYLE}>
      <div style={SECTION_TITLE_STYLE}>
        <span>{t('overview.section.age')}</span>
        <span style={CHART_CAPTION_STYLE}>{t('overview.section.age.caption')}</span>
      </div>
      <div style={CHART_CARD_STYLE}>
        <AgeHistogram buckets={updateAgeBuckets(tickets, fetchedAt, t)} />
      </div>
    </section>
  )
}

function MetricCard(props: {
  readonly testId: string
  readonly label: string
  readonly value: string
  readonly note?: string | undefined
}): React.ReactElement {
  return (
    <div data-testid={props.testId} style={FLAT_METRIC_STYLE}>
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
  const { t } = useI18n()
  return (
    <section data-testid="composition" style={SECTION_STYLE}>
      <div style={SECTION_TITLE_STYLE}>{t('overview.section.composition')}</div>
      <div style={{ ...CHART_CARD_STYLE, gap: 14 }}>
        <SegmentedBar
          testId="status-distribution"
          title={t('overview.distribution.status')}
          segments={statusSegments(props.snapshot.tickets, t)}
        />
        <SegmentedBar
          testId="category-distribution"
          title={t('overview.distribution.category')}
          segments={categorySegments(props.snapshot.tickets, t)}
        />
      </div>
    </section>
  )
}

function AttentionSection(props: {
  readonly items: SnapshotMetrics['attention']
  readonly onOpenTicket: (ref: string) => void
}): React.ReactElement {
  const { t } = useI18n()
  return (
    <section data-testid="attention" style={SECTION_STYLE}>
      <div style={SECTION_TITLE_STYLE}>
        <span>{t('overview.section.attention')}</span>
        <span style={CARD_BASIS_STYLE}>
          {t('overview.attention.count', { count: props.items.length })}
        </span>
      </div>
      {props.items.length === 0 ? (
        <div data-testid="attention-empty" style={NOTE_STYLE}>
          {t('overview.attention.empty')}
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
              <span style={ATTENTION_REASON_STYLE}>{attentionText(item, t)}</span>
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
