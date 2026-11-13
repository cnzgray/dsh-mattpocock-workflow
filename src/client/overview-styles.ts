/**
 * 概览视图的样式。颜色全部走宿主主题变量，缺变量时用中性色兜底；
 * 档位同时用文字与颜色区分，色觉差异不影响判断。
 */
import type { CSSProperties } from 'react'

import type { PressureTier } from '../protocol/tracker.ts'
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
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  color: COLORS.secondary,
  fontSize: 12,
  fontWeight: 600,
}

/** 三张档位卡纵向排布：侧栏窄，并排会把每个数字挤到换行。 */
export const PRESSURE_CARDS_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
}

export const PRESSURE_CARD_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '8px 10px',
  border: `1px solid ${COLORS.border}`,
  borderRadius: 10,
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

/** 关键数字两列，窄面板下仍然放得下。 */
export const METRIC_GRID_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 6,
}

export const METRIC_CARD_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  padding: '6px 8px',
  border: `1px solid ${COLORS.border}`,
  borderRadius: 8,
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
  fontSize: 15,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
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

/** 构成条的轨道；进度条本身是内联 SVG。 */
export const BAR_STYLE: CSSProperties = {
  display: 'flex',
  width: '100%',
  height: 8,
  borderRadius: 999,
  overflow: 'hidden',
  background: 'rgba(128, 128, 128, 0.18)',
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

/** 构成条每段的颜色键与状态/分类对齐。 */
export const SEGMENT_COLORS: Readonly<Record<DistributionKey, string>> = {
  ready: COLORS.success,
  blocked: COLORS.warn,
  open: COLORS.secondary,
  closed: COLORS.tertiary,
  bug: COLORS.error,
  enhancement: COLORS.accent,
  untriaged: COLORS.tertiary,
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
