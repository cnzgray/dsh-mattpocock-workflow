/**
 * 工单详情视图的样式常量。颜色与间距沿用列表视图的 DSH 主题变量；
 * 正文与评论的 Markdown 排版在面板样式表里（`[data-markdown]`）。
 *
 * 层级：头部是导航、身份（编号、后端）、技能按钮，以及关闭/重开、复制链接、更多菜单；
 * 标题区带状态徽标与作者，再下是一行属性条（标签、分配人）；正文与评论的时间线样式
 * 在 ticket-timeline-styles 里。
 */
import type { CSSProperties } from 'react'

import { BUTTON_STYLE, COLORS } from './task-panel-styles.ts'

/** 详情里输入框和按钮共用的高度：1px 边框 + 3px 内边距 + 18px 行高。 */
const CONTROL_LINE_HEIGHT = '18px'

export const DETAIL_ROOT_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
}

export const DETAIL_HEADER_STYLE: CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  padding: '6px 8px 6px 6px',
  borderBottom: `1px solid ${COLORS.border}`,
}

/** 返回是导航而不是操作：无描边，悬停才出底色，和列表头部的刷新按钮同一种轻量样式。 */
export const DETAIL_BACK_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  border: 'none',
  borderRadius: 6,
  padding: '3px 8px 3px 4px',
  color: COLORS.secondary,
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 12,
  lineHeight: CONTROL_LINE_HEIGHT,
  whiteSpace: 'nowrap',
}

export const DETAIL_REF_STYLE: CSSProperties = {
  color: COLORS.tertiary,
  fontSize: 12,
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  minWidth: 0,
}

/** 有远端地址时编号是链接：强调色，悬停出下划线（样式表）。 */
export const DETAIL_REF_LINK_STYLE: CSSProperties = {
  ...DETAIL_REF_STYLE,
  color: COLORS.accent,
  textDecoration: 'none',
  textUnderlineOffset: 2,
}

export const DETAIL_SCROLL_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: '12px 12px 20px',
}

export const DETAIL_TITLE_STYLE: CSSProperties = {
  margin: 0,
  fontSize: 17,
  lineHeight: 1.35,
  fontWeight: 600,
  overflowWrap: 'anywhere',
  textWrap: 'pretty',
}

/** 纵向一摞：标题与元信息、操作行与提示、属性条与说明。 */
export const DETAIL_STACK_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
}

/** 属性条：标签组和分配人组同一行，上下各一条分隔线把它和标题区、正文分开。 */
export const DETAIL_STRIP_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  columnGap: 16,
  rowGap: 6,
}

export const DETAIL_GROUP_STYLE: CSSProperties = {
  display: 'inline-flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
}

export const DETAIL_GROUP_ICON_STYLE: CSSProperties = {
  display: 'inline-flex',
  flex: 'none',
  marginRight: 2,
  color: COLORS.tertiary,
}

export const DETAIL_TOKEN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 1,
  maxWidth: '100%',
  border: `1px solid ${COLORS.border}`,
  borderRadius: 999,
  padding: '0 2px 0 8px',
  fontSize: 12,
  lineHeight: '20px',
  color: COLORS.text,
  overflowWrap: 'anywhere',
}

export const DETAIL_TOKEN_EMPTY_STYLE: CSSProperties = {
  color: COLORS.tertiary,
  fontSize: 12,
  lineHeight: '22px',
}

export const DETAIL_TOKEN_REMOVE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  width: 16,
  height: 16,
  border: 'none',
  borderRadius: 999,
  padding: 0,
  color: COLORS.tertiary,
  cursor: 'pointer',
}

/** 组末尾的加号：和小块同高的圆形轻按钮。 */
export const DETAIL_ADD_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  width: 22,
  height: 22,
  border: `1px dashed ${COLORS.borderStrong}`,
  borderRadius: 999,
  padding: 0,
  color: COLORS.secondary,
  cursor: 'pointer',
}

/** 属性条里展开的行内输入框：和小块同高（22px）。 */
export const DETAIL_INLINE_INPUT_STYLE: CSSProperties = {
  width: '8em',
  minWidth: 0,
  padding: '2px 8px',
  border: `1px solid ${COLORS.borderStrong}`,
  borderRadius: 999,
  background: COLORS.surface,
  color: COLORS.text,
  font: 'inherit',
  fontSize: 12,
  lineHeight: '16px',
}

/** 行内输入框旁的小按钮：同为 22px 高。 */
export const DETAIL_SMALL_BUTTON_STYLE: CSSProperties = {
  ...BUTTON_STYLE,
  borderColor: COLORS.borderStrong,
  borderRadius: 999,
  padding: '2px 9px',
  fontSize: 12,
  lineHeight: '16px',
}

export const DETAIL_INPUT_STYLE: CSSProperties = {
  flex: 1,
  minWidth: '8em',
  padding: '3px 8px',
  border: `1px solid ${COLORS.borderStrong}`,
  borderRadius: 6,
  background: COLORS.surface,
  color: COLORS.text,
  font: 'inherit',
  fontSize: 12,
  lineHeight: CONTROL_LINE_HEIGHT,
}

/** 详情里的次级按钮：和输入框同高，字号同 12px。 */
export const DETAIL_BUTTON_STYLE: CSSProperties = {
  ...BUTTON_STYLE,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  borderColor: COLORS.borderStrong,
  padding: '3px 10px',
  fontSize: 12,
  lineHeight: CONTROL_LINE_HEIGHT,
}

/** 提示文字：复制结果、注入失败、后端缺的能力。 */
export const DETAIL_HINT_STYLE: CSSProperties = {
  color: COLORS.tertiary,
  fontSize: 12,
}

export const DETAIL_ERROR_STYLE: CSSProperties = {
  padding: '8px 10px',
  border: `1px solid ${COLORS.error}`,
  borderRadius: 8,
  color: COLORS.error,
  fontSize: 12,
}

/** 头部右侧的文字按钮（重新打开）：无描边，和返回按钮同一种轻量样式。 */
export const HEADER_TEXT_BUTTON_STYLE: CSSProperties = {
  ...DETAIL_BACK_STYLE,
  padding: '3px 8px',
}

/** 头部的关闭工单：错误色文字，悬停出浅红底（样式表的 secondary）。 */
export const HEADER_CLOSE_STYLE: CSSProperties = {
  ...HEADER_TEXT_BUTTON_STYLE,
  color: COLORS.error,
}

/** 头部的图标按钮（复制链接、更多）：24px 见方。 */
export const HEADER_ICON_BUTTON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  width: 24,
  height: 24,
  border: 'none',
  borderRadius: 6,
  padding: 0,
  color: COLORS.secondary,
  cursor: 'pointer',
}

/** 只给读屏用的文字：视觉上隐藏，但仍在无障碍树里。 */
export const VISUALLY_HIDDEN_STYLE: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
}
