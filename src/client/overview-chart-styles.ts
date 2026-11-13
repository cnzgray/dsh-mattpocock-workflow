/**
 * 概览图表的样式。颜色走宿主主题变量；图形只用细线、细柱与 2px 间隙分隔，
 * 数值和标签一律用文字色，不用系列色。
 */
import type { CSSProperties } from 'react'

import type { AgeBucketKey } from './overview-chart-data.ts'
import { COLORS } from './task-panel-styles.ts'

/** 中性填充：已关闭、未定级、关闭流量这类“背景量”。 */
export const NEUTRAL_FILL = 'rgba(128, 128, 128, 0.45)'

/** 图表区的卡片外框。 */
export const CHART_CARD_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '10px 12px',
  border: `1px solid ${COLORS.border}`,
  borderRadius: 10,
  minWidth: 0,
}

export const CHART_CAPTION_STYLE: CSSProperties = {
  color: COLORS.tertiary,
  fontSize: 11,
}

/* ---------- 档位刻度条 ---------- */

/** 档位刻度条撑满卡片宽度：三格等分，对应轻松、正常、吃紧。 */
export const TIER_METER_STYLE: CSSProperties = {
  display: 'flex',
  gap: 2,
  width: '100%',
}

export const TIER_METER_STEP_STYLE: CSSProperties = {
  flex: 1,
  height: 6,
  borderRadius: 3,
}

/* ---------- 流量柱状图 ---------- */

export const FLOW_PLOT_STYLE: CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'flex-end',
  height: 96,
  borderBottom: `1px solid ${COLORS.borderStrong}`,
}

/** 峰值参考线：一条发丝线，左侧标出峰值，代替整根 y 轴。 */
export const FLOW_PEAK_LINE_STYLE: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  top: 0,
  borderTop: `1px solid ${COLORS.border}`,
  pointerEvents: 'none',
}

export const FLOW_PEAK_LABEL_STYLE: CSSProperties = {
  position: 'absolute',
  left: 0,
  top: -14,
  color: COLORS.tertiary,
  fontSize: 10,
  fontVariantNumeric: 'tabular-nums',
}

/** 一周的命中区：比柱子宽，整列都能悬停。 */
export const FLOW_WEEK_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: '100%',
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  gap: 2,
  borderRadius: 4,
  outline: 'none',
  cursor: 'default',
}

export const FLOW_BAR_STYLE: CSSProperties = {
  width: '32%',
  maxWidth: 12,
  minHeight: 0,
  borderRadius: '4px 4px 0 0',
  transition: 'opacity 120ms ease',
}

export const FLOW_AXIS_STYLE: CSSProperties = {
  display: 'flex',
  color: COLORS.tertiary,
  fontSize: 10,
  fontVariantNumeric: 'tabular-nums',
}

export const FLOW_AXIS_LABEL_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  textAlign: 'center',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
}

/** 悬停读数：数值在前、加粗，系列名在后。 */
export const READOUT_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  gap: '2px 12px',
  minHeight: 18,
  color: COLORS.secondary,
  fontSize: 11,
}

export const READOUT_VALUE_STYLE: CSSProperties = {
  color: COLORS.text,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
}

/** 图例与读数里的系列键：短色块紧挨文字，文字仍用文字色。 */
export const SERIES_KEY_STYLE: CSSProperties = {
  display: 'inline-block',
  width: 8,
  height: 8,
  borderRadius: 2,
  marginRight: 4,
  verticalAlign: 'middle',
}

/* ---------- 未更新天数分布 ---------- */

export const AGE_LIST_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0, 1fr) auto',
  alignItems: 'center',
  columnGap: 8,
  rowGap: 6,
  fontSize: 11,
}

export const AGE_LABEL_STYLE: CSSProperties = {
  color: COLORS.secondary,
  whiteSpace: 'nowrap',
}

export const AGE_TRACK_STYLE: CSSProperties = {
  height: 10,
  borderRadius: 4,
  background: COLORS.track,
  overflow: 'hidden',
}

export const AGE_BAR_STYLE: CSSProperties = {
  height: '100%',
  borderRadius: 4,
}

export const AGE_COUNT_STYLE: CSSProperties = {
  color: COLORS.text,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'right',
  minWidth: 28,
}

/** 超过 30 天未动的那一档用警示色，其余用强调色。 */
export const AGE_COLORS: Readonly<Record<AgeBucketKey, string>> = {
  week: COLORS.accent,
  fortnight: COLORS.accent,
  month: COLORS.accent,
  older: COLORS.warn,
}

/* ---------- 分段条 ---------- */

/** 高分段条：每段一块，块间 2px 间隙，段内印占比。 */
export const SEGMENTED_BAR_STYLE: CSSProperties = {
  display: 'flex',
  gap: 2,
  height: 24,
  width: '100%',
}

export const SEGMENT_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  minWidth: 0,
  paddingLeft: 6,
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
  transition: 'opacity 120ms ease',
}

export const EMPTY_BAR_STYLE: CSSProperties = {
  height: 24,
  borderRadius: 4,
  background: COLORS.track,
}
