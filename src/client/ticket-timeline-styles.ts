/**
 * 详情视图里 GitHub issue 风格部件的样式：标题区的实心状态徽标、时间线卡片、
 * 补全候选列表、更多菜单与删除确认面板。颜色都走 DSH 主题变量。
 */
import type { CSSProperties } from 'react'

import { BUTTON_STYLE, COLORS } from './task-panel-styles.ts'
import { DETAIL_BUTTON_STYLE, HEADER_ICON_BUTTON_STYLE } from './ticket-detail-styles.ts'

/** 卡片头部的浅底：和代码块同一档灰。 */
const CARD_HEADER_BG = 'rgba(128, 128, 128, 0.07)'

// ---- 标题区 ----

/** 标题下的实心状态徽标：开放用成功色，关闭用中性灰，和列表的描边徽标区分层级。 */
export const STATE_PILL_STYLES: Record<'open' | 'closed', CSSProperties> = {
  open: statePill(COLORS.success),
  closed: statePill(COLORS.tertiary),
}

function statePill(color: string): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    flex: 'none',
    borderRadius: 999,
    padding: '0 10px 0 8px',
    background: color,
    color: '#fff',
    fontSize: 12,
    fontWeight: 500,
    lineHeight: '22px',
    whiteSpace: 'nowrap',
  }
}

/** 状态徽标与“谁、何时创建、几条评论”同一行。 */
export const TITLE_META_ROW_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  columnGap: 5,
  rowGap: 2,
  color: COLORS.tertiary,
  fontSize: 12,
  fontVariantNumeric: 'tabular-nums',
}

export const TITLE_META_NAME_STYLE: CSSProperties = {
  color: COLORS.secondary,
  fontWeight: 600,
}

// ---- 时间线 ----

export const TIMELINE_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
}

export const TIMELINE_CARD_STYLE: CSSProperties = {
  border: `1px solid ${COLORS.border}`,
  borderRadius: 8,
  overflow: 'hidden',
}

export const TIMELINE_CARD_HEADER_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  padding: '6px 10px',
  background: CARD_HEADER_BG,
  borderBottom: `1px solid ${COLORS.border}`,
}

/** 工单作者自己的评论：头部带强调色浅底，和 GitHub 标记作者评论的方式一致。 */
export const TIMELINE_CARD_AUTHOR_HEADER_STYLE: CSSProperties = {
  background: `color-mix(in srgb, ${COLORS.accent} 8%, transparent)`,
  borderBottomColor: `color-mix(in srgb, ${COLORS.accent} 25%, transparent)`,
}

export const TIMELINE_CARD_BODY_STYLE: CSSProperties = {
  padding: '10px 12px 12px',
}

export const TIMELINE_TIME_STYLE: CSSProperties = {
  minWidth: 0,
  flex: 1,
  color: COLORS.tertiary,
  fontSize: 12,
  fontVariantNumeric: 'tabular-nums',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

export const TIMELINE_NAME_STYLE: CSSProperties = {
  color: COLORS.text,
  fontWeight: 600,
}

export const TIMELINE_AUTHOR_BADGE_STYLE: CSSProperties = {
  flex: 'none',
  border: `1px solid ${COLORS.borderStrong}`,
  borderRadius: 999,
  padding: '0 7px',
  color: COLORS.secondary,
  fontSize: 11,
  lineHeight: '18px',
}

/** 卡片之间的竖线：对齐头像中心（10px 内边距 + 10px 半个头像 - 1px）。 */
export const TIMELINE_CONNECTOR_STYLE: CSSProperties = {
  width: 2,
  height: 14,
  marginLeft: 19,
  background: COLORS.border,
}

export const TIMELINE_EMPTY_STYLE: CSSProperties = {
  color: COLORS.tertiary,
  fontSize: 12,
}

// ---- 补全候选 ----

/** 候选列表在输入框下方占一整行。 */
export const COMBO_LIST_STYLE: CSSProperties = {
  flexBasis: '100%',
  margin: '2px 0 0',
  padding: 4,
  listStyle: 'none',
  border: `1px solid ${COLORS.border}`,
  borderRadius: 8,
  background: COLORS.surfaceRaised,
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
}

export const COMBO_OPTION_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  padding: '4px 8px',
  borderRadius: 6,
  fontSize: 12,
  lineHeight: '18px',
  cursor: 'pointer',
}

export const COMBO_OPTION_ACTIVE_STYLE: CSSProperties = {
  background: COLORS.surfaceActive,
}

export const COMBO_OPTION_DETAIL_STYLE: CSSProperties = {
  minWidth: 0,
  flex: 1,
  color: COLORS.tertiary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

export const COMBO_SWATCH_STYLE: CSSProperties = {
  flex: 'none',
  width: 12,
  height: 12,
  borderRadius: '50%',
  // 没有颜色的标签用透明色块，靠这圈细边看出是个色块。
  boxShadow: 'inset 0 0 0 1px rgba(128, 128, 128, 0.35)',
}

export const COMBO_EMPTY_STYLE: CSSProperties = {
  padding: '4px 8px',
  color: COLORS.tertiary,
  fontSize: 12,
}

// ---- 危险操作 ----

/** 永久删除：实心错误色，只出现在确认面板里。 */
export const DANGER_BUTTON_STYLE: CSSProperties = {
  ...DETAIL_BUTTON_STYLE,
  borderColor: COLORS.error,
  background: COLORS.error,
  color: '#fff',
  fontWeight: 500,
}

export const MENU_WRAPPER_STYLE: CSSProperties = {
  position: 'relative',
  flex: 'none',
}

export const MENU_TRIGGER_STYLE: CSSProperties = HEADER_ICON_BUTTON_STYLE

export const MENU_STYLE: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  right: 0,
  zIndex: 10,
  minWidth: 140,
  padding: 4,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 8,
  background: COLORS.surfaceRaised,
  boxShadow: '0 6px 16px rgba(0, 0, 0, 0.12)',
}

export const MENU_ITEM_DANGER_STYLE: CSSProperties = {
  ...BUTTON_STYLE,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  width: '100%',
  border: 'none',
  padding: '5px 8px',
  color: COLORS.error,
  fontSize: 12,
  textAlign: 'left',
}

export const DELETE_PANEL_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '10px 12px 12px',
  border: `1px solid color-mix(in srgb, ${COLORS.error} 50%, transparent)`,
  borderRadius: 8,
  background: `color-mix(in srgb, ${COLORS.error} 5%, transparent)`,
}

export const DELETE_PANEL_TITLE_STYLE: CSSProperties = {
  margin: 0,
  color: COLORS.error,
  fontSize: 13,
  fontWeight: 600,
}

export const DELETE_PANEL_TEXT_STYLE: CSSProperties = {
  margin: 0,
  color: COLORS.text,
  fontSize: 12,
  overflowWrap: 'anywhere',
}

export const DELETE_PANEL_ACTIONS_STYLE: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 6,
}
