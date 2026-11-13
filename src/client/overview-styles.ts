/**
 * 概览视图的样式。颜色全部走宿主主题变量，缺变量时用中性色兜底；
 * 档位同时用文字与颜色区分，色觉差异不影响判断。
 */
import type { CSSProperties } from 'react'

import type { PressureTier } from '../protocol/tracker.ts'
import { NEUTRAL_FILL } from './overview-chart-styles.ts'
import { COLORS } from './task-panel-styles.ts'
import type { DistributionKey } from './overview-text.ts'

/** 档位颜色：轻松用成功色，正常用中性色，吃紧用错误色。 */
export const TIER_COLORS: Readonly<Record<PressureTier, string>> = {
  light: COLORS.success,
  normal: COLORS.secondary,
  tight: COLORS.error,
}

export const OVERVIEW_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  padding: '10px 12px 16px',
}

export const IDENTITY_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}

export const IDENTITY_ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
}

export const IDENTITY_META_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
  color: COLORS.tertiary,
  fontSize: 11,
}

export const SECTION_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

export const SECTION_TITLE_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 8,
  color: COLORS.text,
  fontSize: 12,
  fontWeight: 600,
}

const TIER_BADGE_BASE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  border: '1px solid currentColor',
  borderRadius: 999,
  padding: '0 7px',
  fontSize: 11,
  lineHeight: '17px',
  whiteSpace: 'nowrap',
  flex: 'none',
}

export const TIER_BADGE_STYLES: Readonly<Record<PressureTier, CSSProperties>> = {
  light: { ...TIER_BADGE_BASE_STYLE, color: COLORS.success },
  normal: { ...TIER_BADGE_BASE_STYLE, color: COLORS.secondary },
  tight: { ...TIER_BADGE_BASE_STYLE, color: COLORS.error },
}

/** 维度卡片的栅格：面板够宽时三张并排，窄了自动叠成一列。 */
export const DIMENSION_GRID_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(176px, 1fr))',
  gap: 8,
}

export const DIMENSION_CARD_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '10px 12px 12px',
  border: `1px solid ${COLORS.border}`,
  borderRadius: 10,
  minWidth: 0,
}

export const DIMENSION_HEAD_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
}

export const DIMENSION_NAME_STYLE: CSSProperties = {
  color: COLORS.text,
  fontSize: 13,
  fontWeight: 600,
}

/** 维度档位：色点加文字，文字用正文色，颜色只落在点和刻度条上。 */
export const TIER_TEXT_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  color: COLORS.text,
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: 'nowrap',
}

export const TIER_DOT_STYLE: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  flex: 'none',
}

/** 触发原因：卡片里最先读到的一句。 */
export const DIMENSION_FACT_STYLE: CSSProperties = {
  color: COLORS.text,
  fontSize: 13,
  fontWeight: 500,
  overflowWrap: 'anywhere',
}

export const DIMENSION_BASIS_STYLE: CSSProperties = {
  color: COLORS.tertiary,
  fontSize: 11,
}

/** 支撑数字：标签左、数值右，发丝线和上面的判定隔开。 */
export const METRIC_ROWS_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'baseline',
  columnGap: 8,
  rowGap: 4,
  margin: 0,
  paddingTop: 8,
  borderTop: `1px solid ${COLORS.border}`,
}

export const METRIC_ROW_LABEL_STYLE: CSSProperties = {
  margin: 0,
  color: COLORS.secondary,
  fontSize: 12,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

export const METRIC_ROW_VALUE_STYLE: CSSProperties = {
  margin: 0,
  color: COLORS.text,
  fontSize: 13,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'right',
  whiteSpace: 'nowrap',
}

export const METRIC_ROW_NOTE_STYLE: CSSProperties = {
  gridColumn: '1 / -1',
  margin: '-2px 0 0',
  color: COLORS.tertiary,
  fontSize: 10,
  textAlign: 'right',
}

/** 维度数据不足、判不了档时的标记。 */
export const UNAVAILABLE_BADGE_STYLE: CSSProperties = {
  ...TIER_BADGE_BASE_STYLE,
  color: COLORS.tertiary,
}

export const PROVISIONAL_STYLE: CSSProperties = {
  color: COLORS.warn,
  fontSize: 11,
  whiteSpace: 'nowrap',
}

export const CARD_HEADING_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
}

export const CARD_NAME_STYLE: CSSProperties = {
  fontWeight: 600,
  fontSize: 12,
}

export const CARD_BASIS_STYLE: CSSProperties = {
  color: COLORS.tertiary,
  fontSize: 11,
}

export const CARD_FACT_STYLE: CSSProperties = {
  color: COLORS.text,
  fontSize: 12,
  overflowWrap: 'anywhere',
}

/** 流量卡片顶部的三个数字：同一张卡片里并排，不再各套边框。 */
export const FLOW_STATS_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 8,
}

export const FLAT_METRIC_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  minWidth: 0,
}

export const METRIC_LABEL_STYLE: CSSProperties = {
  color: COLORS.secondary,
  fontSize: 11,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

export const METRIC_VALUE_STYLE: CSSProperties = {
  color: COLORS.text,
  fontSize: 18,
  fontWeight: 600,
  lineHeight: 1.3,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

export const METRIC_NOTE_STYLE: CSSProperties = {
  color: COLORS.tertiary,
  fontSize: 10,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

export const NOTE_STYLE: CSSProperties = {
  color: COLORS.tertiary,
  fontSize: 11,
  overflowWrap: 'anywhere',
}

export const LEGEND_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '2px 10px',
  color: COLORS.secondary,
  fontSize: 11,
}

export const LEGEND_ITEM_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  whiteSpace: 'nowrap',
}

export const LEGEND_DOT_STYLE: CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: '50%',
  flex: 'none',
}

/**
 * 构成条每段的颜色键与状态/分类对齐。可接、阻塞沿用状态色；其他开放用强调色，
 * 与“已关闭”的中性灰拉开，两段相邻时也分得清。
 */
export const SEGMENT_COLORS: Readonly<Record<DistributionKey, string>> = {
  ready: COLORS.success,
  blocked: COLORS.warn,
  open: COLORS.accent,
  closed: NEUTRAL_FILL,
  bug: COLORS.error,
  enhancement: COLORS.accent,
  untriaged: NEUTRAL_FILL,
}

/** 段内文字颜色：彩色块上用白字，半透明灰块上用正文色。 */
export const SEGMENT_INK: Readonly<Record<DistributionKey, string>> = {
  ready: '#ffffff',
  blocked: '#ffffff',
  open: '#ffffff',
  closed: COLORS.text,
  bug: '#ffffff',
  enhancement: '#ffffff',
  untriaged: COLORS.text,
}

export const ATTENTION_LIST_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
}

export const ATTENTION_ITEM_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0, 1fr)',
  gridTemplateRows: 'auto auto',
  columnGap: 8,
  alignItems: 'center',
  width: '100%',
  padding: '7px 9px',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: COLORS.border,
  borderRadius: 8,
  color: COLORS.text,
  cursor: 'pointer',
  font: 'inherit',
  textAlign: 'left',
}

export const ATTENTION_REF_STYLE: CSSProperties = {
  gridColumn: '1',
  gridRow: '1 / span 2',
  alignSelf: 'start',
  color: COLORS.tertiary,
  fontSize: 11,
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
}

export const ATTENTION_TITLE_STYLE: CSSProperties = {
  gridColumn: '2',
  gridRow: '1',
  minWidth: 0,
  fontWeight: 500,
  fontSize: 12,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

export const ATTENTION_REASON_STYLE: CSSProperties = {
  gridColumn: '2',
  gridRow: '2',
  color: COLORS.warn,
  fontSize: 11,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}
