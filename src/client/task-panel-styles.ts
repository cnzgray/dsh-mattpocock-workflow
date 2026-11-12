/**
 * MattWorkflow 面板的样式常量。颜色全部走 DSH 主题变量，缺变量时用中性色兜底，
 * 深色/浅色主题跟随宿主。布局参考右侧栏任务面板的卡片式列表。
 */
import type { CSSProperties } from 'react'

import type { TicketStatus } from '../protocol/tracker.ts'
import type { TicketFilter, TicketSortKey } from './ticket-view.ts'

export const COLORS = {
  text: 'var(--dsw-alias-label-primary, #1f2328)',
  secondary: 'var(--dsw-alias-label-secondary, #57606a)',
  tertiary: 'var(--dsw-alias-label-tertiary, #8c959f)',
  border: 'var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.25))',
  borderStrong: 'var(--dsw-alias-border-l4, rgba(128, 128, 128, 0.4))',
  surface: 'var(--dsw-alias-bg-layer-1, transparent)',
  surfaceActive: 'var(--dsw-alias-interactive-bg-active, rgba(128, 128, 128, 0.18))',
  accent: 'var(--dsw-alias-state-business-primary, #0969da)',
  success: 'var(--dsw-alias-state-success-primary, #1a7f37)',
  warn: 'var(--dsw-alias-state-warn-primary, #9a6700)',
  error: 'var(--dsw-alias-state-error-primary, #cf222e)',
} as const

export const PANEL_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  color: COLORS.text,
  fontSize: 13,
  lineHeight: 1.55,
}

export const HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '10px 12px 8px',
}

export const REPO_CHIP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  maxWidth: '65%',
  border: `1px solid ${COLORS.borderStrong}`,
  borderRadius: 6,
  padding: '2px 8px',
  color: COLORS.text,
  fontSize: 12,
}

export const REPO_NAME_STYLE: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

export const AGE_STYLE: CSSProperties = {
  color: COLORS.tertiary,
  fontSize: 12,
  whiteSpace: 'nowrap',
}

export const ACTION_BAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '0 12px 8px',
}

export const SECTION_LABEL_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 6,
  padding: '3px 10px',
  color: COLORS.text,
  fontSize: 12,
  background: COLORS.surfaceActive,
}

export const BUTTON_STYLE: CSSProperties = {
  border: `1px solid ${COLORS.border}`,
  background: 'transparent',
  color: COLORS.text,
  borderRadius: 6,
  padding: '4px 8px',
  cursor: 'pointer',
  font: 'inherit',
  whiteSpace: 'nowrap',
}

const ACTION_BUTTON_STYLE: CSSProperties = {
  ...BUTTON_STYLE,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  fontSize: 12,
}

export const FEATURE_ACTION_STYLE: CSSProperties = {
  ...ACTION_BUTTON_STYLE,
  borderColor: COLORS.accent,
  color: COLORS.accent,
}

export const BUG_ACTION_STYLE: CSSProperties = {
  ...ACTION_BUTTON_STYLE,
  borderColor: COLORS.error,
  color: COLORS.error,
}

export const CHIP_STYLE: CSSProperties = {
  border: `1px solid ${COLORS.border}`,
  borderRadius: 999,
  background: 'transparent',
  color: COLORS.secondary,
  padding: '2px 10px',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 12,
  whiteSpace: 'nowrap',
}

export const CHIP_ACTIVE_STYLE: CSSProperties = {
  borderColor: COLORS.accent,
  color: COLORS.text,
  background: COLORS.surfaceActive,
}

export const STATS_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '2px 12px 8px',
}

export const STAT_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  fontSize: 12,
  color: COLORS.secondary,
}

export const STAT_VALUE_STYLE: CSSProperties = {
  color: COLORS.text,
  fontSize: 13,
}

export const TOOLBAR_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
  padding: '0 12px 8px',
}

export const TOOLBAR_GROUP_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 5,
  alignItems: 'center',
}

export const DIVIDER_STYLE: CSSProperties = {
  width: 1,
  height: 18,
  background: COLORS.border,
  margin: '0 4px',
}

export const LOADED_STYLE: CSSProperties = {
  padding: '0 12px 8px',
  color: COLORS.tertiary,
  fontSize: 12,
}

export const EMPTY_STYLE: CSSProperties = {
  padding: 16,
  color: COLORS.secondary,
}

export const LIST_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  padding: '0 12px 12px',
}

export const CARD_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0, 1fr) auto',
  gridTemplateRows: 'auto auto',
  columnGap: 10,
  rowGap: 6,
  alignItems: 'center',
  width: '100%',
  padding: '9px 12px',
  border: `1px solid ${COLORS.border}`,
  borderRadius: 10,
  background: COLORS.surface,
  color: COLORS.text,
  cursor: 'pointer',
  font: 'inherit',
  textAlign: 'left',
  minHeight: 58,
}

export const CARD_SELECTED_STYLE: CSSProperties = {
  borderColor: COLORS.accent,
  boxShadow: `0 0 0 1px ${COLORS.accent}`,
}

export const NUMBER_BADGE_STYLE: CSSProperties = {
  gridColumn: '1',
  gridRow: '1',
  border: `1px solid ${COLORS.border}`,
  borderRadius: 6,
  padding: '0 6px',
  color: COLORS.secondary,
  fontSize: 12,
  lineHeight: '20px',
  whiteSpace: 'nowrap',
}

export const CARD_TITLE_STYLE: CSSProperties = {
  gridColumn: '2',
  gridRow: '1',
  minWidth: 0,
  overflowWrap: 'anywhere',
}

export const CARD_CATEGORY_STYLE: CSSProperties = {
  gridColumn: '2',
  gridRow: '2',
  justifySelf: 'start',
}

export const CARD_STATUS_STYLE: CSSProperties = {
  gridColumn: '3',
  gridRow: '1',
  justifySelf: 'end',
}

const BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  border: '1px solid currentColor',
  borderRadius: 999,
  padding: '0 7px',
  fontSize: 11,
  lineHeight: '19px',
  whiteSpace: 'nowrap',
}

export const STATUS_LABELS: Record<TicketStatus, string> = {
  ready: '可接',
  blocked: '阻塞',
  closed: '已关闭',
  open: '开放',
}

export const STATUS_BADGES: Record<TicketStatus, CSSProperties> = {
  ready: { ...BADGE_STYLE, color: COLORS.success },
  blocked: { ...BADGE_STYLE, color: COLORS.warn },
  closed: { ...BADGE_STYLE, color: COLORS.tertiary },
  open: { ...BADGE_STYLE, color: COLORS.secondary },
}

export const STATUS_DOT_STYLE: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: 'currentColor',
}

export const CATEGORY_BADGES: Record<'bug' | 'enhancement', CSSProperties> = {
  bug: { ...BADGE_STYLE, color: COLORS.error },
  enhancement: { ...BADGE_STYLE, color: COLORS.accent },
}

export const ERROR_STYLE: CSSProperties = {
  margin: '0 12px 8px',
  padding: '8px 10px',
  border: `1px solid ${COLORS.error}`,
  borderRadius: 8,
  color: COLORS.error,
  fontSize: 12,
}

export const FILTERS: readonly { readonly value: TicketFilter; readonly label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: '已关闭' },
  { value: 'blocked', label: '阻塞' },
  { value: 'ready', label: '可接' },
]

export const SORT_OPTIONS: readonly { readonly value: TicketSortKey; readonly label: string }[] = [
  { value: 'updated', label: '更新' },
  { value: 'created', label: '创建' },
  { value: 'number', label: '编号' },
  { value: 'title', label: '标题' },
]
