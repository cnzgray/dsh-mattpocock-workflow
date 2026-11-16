/**
 * 「我的工单」筛选行的样式。与状态筛选分开成文件，保持两条筛选线的视觉层级独立，
 * 也避免样式文件继续膨胀。
 */
import type { CSSProperties } from 'react'

import { COLORS } from './task-panel-styles.ts'

/** 人员筛选行：视觉层级低于状态分段，位于工具栏与列表之间。 */
export const MY_FILTER_ROW_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
  padding: '0 12px 2px',
}

/** 行首人员图标：比胶囊更淡，只做维度提示。 */
export const MY_FILTER_ICON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  color: COLORS.tertiary,
}

/** 人员筛选胶囊：多选开关，不用分段槽的底与选中抬起的阴影。 */
export const MY_FILTER_CHIP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: COLORS.border,
  borderRadius: 999,
  padding: '0 8px',
  color: COLORS.secondary,
  background: 'transparent',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 12,
  lineHeight: '20px',
  whiteSpace: 'nowrap',
}

/** 选中态：强调色文字、45% 描边、10% 浅底与字重 500。 */
export const MY_FILTER_CHIP_ACTIVE_STYLE: CSSProperties = {
  color: COLORS.accent,
  borderColor: `color-mix(in srgb, ${COLORS.accent} 45%, transparent)`,
  background: `color-mix(in srgb, ${COLORS.accent} 10%, transparent)`,
  fontWeight: 500,
}

/** 胶囊里的计数：等宽数字，未选中时比文字再淡一级。 */
export const MY_FILTER_COUNT_STYLE: CSSProperties = {
  marginLeft: 4,
  fontVariantNumeric: 'tabular-nums',
  fontWeight: 600,
  color: COLORS.tertiary,
}

/** 选中时计数跟随强调色。 */
export const MY_FILTER_COUNT_ACTIVE_STYLE: CSSProperties = {
  color: COLORS.accent,
}

/** 「清除」：11px 文字按钮，不抢胶囊的注意力。 */
export const MY_FILTER_CLEAR_STYLE: CSSProperties = {
  border: 'none',
  padding: 0,
  background: 'transparent',
  color: COLORS.tertiary,
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 11,
  lineHeight: '20px',
  whiteSpace: 'nowrap',
}

/** 行尾身份：`@登录名`，过长时省略号截断。 */
export const MY_FILTER_VIEWER_STYLE: CSSProperties = {
  marginLeft: 'auto',
  minWidth: 0,
  maxWidth: '45%',
  color: COLORS.tertiary,
  fontSize: 11,
  lineHeight: '20px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}
