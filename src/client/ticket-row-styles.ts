/**
 * 工单行的样式：内容区与打开按钮、编号，以及元信息里的标签徽标、创建人头像与用户名、相对创建时间，
 * 还有工具栏上的行内显示配置入口与浮层。
 * 从 task-panel-styles 拆出来，避免面板样式文件越过 max-lines；颜色都走 DSH 主题变量。
 */
import type { CSSProperties } from 'react'

import { CHIP_STYLE, COLORS } from './task-panel-styles.ts'

/** 标题下的一行小字：状态在前、分类在后，都是次要信息。 */
export const CARD_META_STYLE: CSSProperties = {
  // 浮在打开按钮上面：头像、用户名与时间的悬停说明要能出来。
  position: 'relative',
  zIndex: 1,
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  columnGap: 8,
  rowGap: 2,
  minWidth: 0,
}

/** 父子布局每层的缩进：固定且小，窄侧栏里不把标题挤没。 */
export const TREE_INDENT = 12

/** 折叠控件：真正的按钮，排在编号前；不抢技能按钮与标题的视觉。 */
export const TREE_TOGGLE_STYLE: CSSProperties = {
  // 浮在铺满内容区的打开按钮上面，否则点箭头会命中详情入口。
  position: 'relative',
  zIndex: 1,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  width: 16,
  height: 20,
  marginRight: 2,
  padding: 0,
  border: 'none',
  borderRadius: 4,
  color: COLORS.secondary,
  background: 'transparent',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 11,
  lineHeight: '20px',
  verticalAlign: 'middle',
}

/** 收起的父行仍要显示里面有多少张可见子票。 */
export const TREE_CHILD_COUNT_STYLE: CSSProperties = {
  color: COLORS.tertiary,
  fontSize: 11,
  lineHeight: '18px',
  whiteSpace: 'nowrap',
}

/** 父级不在列表的引用徽标：省略过长引用，完整值放在 title 里。 */
export const PARENT_BADGE_STYLE: CSSProperties = {
  display: 'inline-block',
  maxWidth: '18ch',
  verticalAlign: 'middle',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  border: `1px solid ${COLORS.border}`,
  borderRadius: 999,
  padding: '0 7px',
  color: COLORS.secondary,
  fontSize: 11,
  lineHeight: '18px',
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

/** 分配人区：小人图标与登录名排成一组，随元信息行换行。 */
export const ASSIGNEE_GROUP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
}

/** 分配人区的前导图标：字段标识，不带文字语义。 */
export const ASSIGNEE_ICON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  flex: 'none',
  color: COLORS.tertiary,
  lineHeight: '18px',
}

/** 分配人登录名：和详情一样是裸远端用户名，窄侧栏下不截断。 */
export const ASSIGNEE_NAME_STYLE: CSSProperties = {
  color: COLORS.secondary,
  fontSize: 11,
  lineHeight: '18px',
  whiteSpace: 'nowrap',
}

/** 分配人超过显示上限时的 `+N`，完整名单在悬停说明里。 */
export const ASSIGNEE_MORE_STYLE: CSSProperties = {
  color: COLORS.tertiary,
  fontSize: 11,
  lineHeight: '18px',
  whiteSpace: 'nowrap',
  cursor: 'default',
}

/** 卡片内容：编号与标题一段，元信息一行；打开详情的按钮铺在下面。 */
export const CARD_CONTENT_STYLE: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  rowGap: 2,
  minWidth: 0,
}

/**
 * 打开详情的按钮：透明、铺满内容区，只负责键盘可达与读屏。
 * 编号是另一个按钮，不能嵌进来，所以标题文字不放在按钮里，按钮垫在文字下面。
 */
export const CARD_OPEN_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  padding: 0,
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  cursor: 'pointer',
}

/** 浮在打开按钮上面的内容：编号与元信息要能点、能悬停看说明。 */
export const CARD_RAISED_STYLE: CSSProperties = {
  position: 'relative',
  zIndex: 1,
}

/**
 * 编号：和标题同字号、同一段文字，退到二级灰，标题换行时从卡片左缘续上。
 * 等宽数字让 `#39`、`#46` 这类编号宽度一致。
 */
export const NUMBER_BADGE_STYLE: CSSProperties = {
  ...CARD_RAISED_STYLE,
  marginRight: 6,
  color: COLORS.secondary,
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
}

/** 本地 Markdown 路径：没有链接、不可点；路径较长，允许在任意处换行。 */
export const LOCAL_REF_STYLE: CSSProperties = {
  ...NUMBER_BADGE_STYLE,
  color: COLORS.tertiary,
  fontWeight: 400,
  whiteSpace: 'normal',
}

/** 可复制的编号：去掉按钮外观，像文字一样排在标题前；悬停出下划线提示可点。 */
export const NUMBER_BUTTON_STYLE: CSSProperties = {
  ...NUMBER_BADGE_STYLE,
  display: 'inline',
  padding: 0,
  border: 'none',
  borderRadius: 3,
  background: 'transparent',
  font: 'inherit',
  lineHeight: 'inherit',
  cursor: 'pointer',
}

/** 编号里井号的位置：复制成功时换成对勾，宽度不变，标题不跳。 */
export const NUMBER_MARK_STYLE: CSSProperties = {
  display: 'inline-flex',
  justifyContent: 'center',
  width: '0.6em',
  verticalAlign: '-1px',
}

/** 行内显示配置的容器：图标按钮与浮层共用定位上下文。 */
export const DISPLAY_MENU_WRAP_STYLE: CSSProperties = {
  position: 'relative',
  display: 'inline-flex',
}

/** 图标按钮：与排序下拉同高，打开时加深底色表示浮层已展开。 */
export const DISPLAY_MENU_TRIGGER_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: `1px solid ${COLORS.border}`,
  borderRadius: 6,
  padding: '1px 6px',
  color: COLORS.secondary,
  background: COLORS.surfaceRaised,
  cursor: 'pointer',
  font: 'inherit',
  lineHeight: '20px',
}

/** 浮层：贴着按钮向右下展开，盖住列表。 */
export const DISPLAY_MENU_PANEL_STYLE: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  right: 0,
  zIndex: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 132,
  padding: 4,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 8,
  background: COLORS.surfaceRaised,
  boxShadow: '0 6px 18px rgba(0, 0, 0, 0.16), 0 0 0 0.5px rgba(0, 0, 0, 0.08)',
}

/** 浮层里的一项：整行可点，开启时右侧打勾。 */
export const DISPLAY_MENU_ITEM_STYLE: CSSProperties = {
  ...CHIP_STYLE,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  width: '100%',
  borderRadius: 5,
  // 浏览器默认按钮底色会在浮层里显成灰块；开启项才用抬起来的底色。
  background: 'transparent',
  textAlign: 'left',
}
