/**
 * 工单行元信息的样式：标签徽标、创建人头像与用户名、相对创建时间。
 * 从 task-panel-styles 拆出来，避免面板样式文件越过 max-lines；颜色都走 DSH 主题变量。
 */
import type { CSSProperties } from 'react'

import { COLORS } from './task-panel-styles.ts'

/** 标题下的一行小字：状态在前、分类在后，都是次要信息。 */
export const CARD_META_STYLE: CSSProperties = {
  gridColumn: '2',
  gridRow: '2',
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  columnGap: 8,
  rowGap: 2,
  minWidth: 0,
}

/** 分类之外的标签：中性小徽标，不和状态徽标抢注意力。 */
export const LABEL_BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 4,
  padding: '0 5px',
  color: COLORS.secondary,
  background: 'rgba(128, 128, 128, 0.12)',
  fontSize: 11,
  lineHeight: '17px',
  whiteSpace: 'nowrap',
}

/** 头像：16px 圆形裁切，行内不挤占标题与状态的位置。 */
export const AVATAR_STYLE: CSSProperties = {
  display: 'inline-block',
  width: 16,
  height: 16,
  borderRadius: '50%',
  objectFit: 'cover',
  flex: 'none',
  verticalAlign: 'middle',
}

/** 首字母色块的兜底样式：底色由登录名决定，文字固定白色。 */
export const AVATAR_FALLBACK_STYLE: CSSProperties = {
  color: '#fff',
  fontSize: 9,
  fontWeight: 600,
  lineHeight: '16px',
  textAlign: 'center',
  textTransform: 'uppercase',
  userSelect: 'none',
}

/** 首字母色块的固定配色：都够深，白字在深浅两套主题下都可读。 */
export const AVATAR_COLORS: readonly string[] = [
  '#0550ae',
  '#116329',
  '#6639ba',
  '#a40e6b',
  '#953800',
  '#424a53',
]

/** 创建人用户名：过长时省略，完整值放在 title 里。 */
export const AUTHOR_NAME_STYLE: CSSProperties = {
  maxWidth: '12ch',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: COLORS.secondary,
  fontSize: 11,
  lineHeight: '18px',
}

/** 行内的相对创建时间。 */
export const ROW_AGE_STYLE: CSSProperties = {
  color: COLORS.tertiary,
  fontSize: 11,
  lineHeight: '18px',
  whiteSpace: 'nowrap',
}
