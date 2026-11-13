/**
 * 环境检查视图的样式。颜色同样走 DSH 主题变量，跟随深色/浅色主题。
 */
import type { CSSProperties } from 'react'

import type { EnvCheckStatus } from '../protocol/env-check.ts'
import { BACKEND_BADGE_STYLE, COLORS } from './task-panel-styles.ts'

export const ENV_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '10px 12px 8px',
}

export const ENV_SUMMARY_STYLE: CSSProperties = {
  color: COLORS.text,
  fontSize: 13,
  fontWeight: 600,
  whiteSpace: 'nowrap',
}

export const ENV_BACKEND_STYLE: CSSProperties = {
  ...BACKEND_BADGE_STYLE,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
}

export const ENV_BODY_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  padding: '0 12px 12px',
}

export const ENV_CARD_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0, 1fr)',
  columnGap: 10,
  rowGap: 4,
  alignItems: 'start',
  padding: '9px 12px',
  border: `1px solid ${COLORS.border}`,
  borderRadius: 10,
  background: COLORS.surface,
  color: COLORS.text,
}

export const ENV_TITLE_STYLE: CSSProperties = {
  fontWeight: 500,
  overflowWrap: 'anywhere',
}

export const ENV_DETAIL_STYLE: CSSProperties = {
  color: COLORS.secondary,
  fontSize: 12,
  overflowWrap: 'anywhere',
}

export const ENV_SKIP_STYLE: CSSProperties = {
  color: COLORS.tertiary,
  fontSize: 12,
  overflowWrap: 'anywhere',
}

export const ENV_SUGGESTION_STYLE: CSSProperties = {
  color: COLORS.warn,
  fontSize: 12,
  overflowWrap: 'anywhere',
}

/** 三种状态的颜色：通过用成功色，失败用错误色，跳过用弱化色。 */
export const ENV_STATUS_COLORS: Record<EnvCheckStatus, string> = {
  pass: COLORS.success,
  fail: COLORS.error,
  skipped: COLORS.tertiary,
}

export const ENV_STATUS_LABELS: Record<EnvCheckStatus, string> = {
  pass: '通过',
  fail: '失败',
  skipped: '跳过',
}

export const CAPABILITIES_STYLE: CSSProperties = {
  border: `1px solid ${COLORS.border}`,
  borderRadius: 8,
  padding: '6px 10px',
  color: COLORS.secondary,
  fontSize: 12,
}

export const CAPABILITY_ROW_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto auto',
  gap: 8,
  padding: '2px 0',
  alignItems: 'center',
}

export const VIEW_SWITCH_STYLE: CSSProperties = {
  display: 'flex',
  gap: 6,
  padding: '10px 12px 8px',
}
