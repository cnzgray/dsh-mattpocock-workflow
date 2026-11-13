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

export const ENV_CARD_HIGHLIGHT_STYLE: CSSProperties = {
  borderColor: COLORS.accent,
  boxShadow: `0 0 0 1px ${COLORS.accent}`,
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

/** 跳到根因项的小按钮：文字按钮样式，不抢主操作的视觉。 */
export const ENV_HIGHLIGHT_STYLE: CSSProperties = {
  border: `1px solid ${COLORS.border}`,
  background: 'transparent',
  color: COLORS.secondary,
  borderRadius: 6,
  padding: '0 6px',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 12,
  whiteSpace: 'nowrap',
}

/** 解决区：与依据留出间距，沿用卡片内的弱化文字。 */
export const ENV_REMEDY_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 6,
  marginTop: 6,
  paddingTop: 6,
  borderTop: `1px dashed ${COLORS.border}`,
}

/** 可复制的命令块：等宽字体、可横向滚动、保留手动选择。 */
export const ENV_COMMAND_STYLE: CSSProperties = {
  margin: 0,
  padding: '6px 8px',
  border: `1px solid ${COLORS.border}`,
  borderRadius: 6,
  background: COLORS.surfaceActive,
  color: COLORS.text,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12,
  overflowX: 'auto',
  maxWidth: '100%',
  userSelect: 'text',
}

export const ENV_REMEDY_LINK_STYLE: CSSProperties = {
  color: COLORS.accent,
  fontSize: 12,
  overflowWrap: 'anywhere',
}

/** 命令块与复制按钮：纵向排列，左对齐。 */
export const ENV_REMEDY_COMMAND_WRAP_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  alignItems: 'flex-start',
}

/** 会话动作与复制按钮：窄空间下自动换行。 */
export const ENV_REMEDY_ACTIONS_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
}

/** 复制与填入失败的状态文字。 */
export const ENV_REMEDY_NOTICE_STYLE: CSSProperties = {
  color: COLORS.warn,
  fontSize: 12,
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

/** 缺失能力的影响与补法：占满整行，缩进对齐显示名。 */
export const CAPABILITY_IMPACT_STYLE: CSSProperties = {
  gridColumn: '1 / -1',
  color: COLORS.tertiary,
  fontSize: 12,
  overflowWrap: 'anywhere',
  paddingBottom: 2,
}

export const VIEW_SWITCH_STYLE: CSSProperties = {
  display: 'flex',
  gap: 6,
  padding: '10px 12px 8px',
}
