/**
 * MattWorkflow 面板的样式常量。颜色全部走 DSH 主题变量，缺变量时用中性色兜底，
 * 深色/浅色主题跟随宿主。布局参考右侧栏任务面板的卡片式列表。
 */
import type { CSSProperties } from 'react'

import type { TicketActionReason } from '../protocol/labels.ts'
import type { TicketStatus } from '../protocol/tracker.ts'
import type { TicketFilter, TicketSortKey } from './ticket-view.ts'

/** 等宽字体：命令名、标签名与可复制的命令块共用。 */
export const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, monospace'

export const COLORS = {
  text: 'var(--dsw-alias-label-primary, #1f2328)',
  secondary: 'var(--dsw-alias-label-secondary, #57606a)',
  // 兜底灰在白底上要到 4.5:1，编号和“已加载”这类小字才可读。
  tertiary: 'var(--dsw-alias-label-tertiary, #6e7781)',
  border: 'var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.25))',
  borderStrong: 'var(--dsw-alias-border-l4, rgba(128, 128, 128, 0.4))',
  surface: 'var(--dsw-alias-bg-layer-1, transparent)',
  surfaceActive: 'var(--dsw-alias-interactive-bg-active, rgba(128, 128, 128, 0.18))',
  /** 分段控件里被选中那一段的底色：跟随宿主面板底色，宿主缺变量时用系统 Canvas 色兜底。 */
  surfaceRaised: 'var(--dsw-alias-bg-layer-1, Canvas)',
  /** 分段控件的槽底色。 */
  track: 'rgba(128, 128, 128, 0.12)',
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
  padding: '10px 12px 2px',
}

export const REPO_CHIP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  color: COLORS.text,
  fontSize: 13,
  fontWeight: 600,
}

export const REPO_NAME_STYLE: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

/** 实例主机：只在 Gitea 后端显示，用来区分多个自建实例。 */
export const REPO_HOST_STYLE: CSSProperties = {
  color: COLORS.tertiary,
  fontSize: 11,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
  maxWidth: '35%',
}

export const BACKEND_BADGE_STYLE: CSSProperties = {
  border: `1px solid ${COLORS.border}`,
  borderRadius: 999,
  padding: '0 7px',
  color: COLORS.secondary,
  fontSize: 11,
  lineHeight: '19px',
  whiteSpace: 'nowrap',
  flex: 'none',
}

export const AGE_STYLE: CSSProperties = {
  color: COLORS.tertiary,
  fontSize: 12,
  whiteSpace: 'nowrap',
}

/** 仓库行右侧的刷新：轻量按钮，悬停才出底色。 */
export const REFRESH_BUTTON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  border: 'none',
  borderRadius: 6,
  padding: '3px 6px',
  color: COLORS.secondary,
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 12,
  whiteSpace: 'nowrap',
}

/** 统计与新建按钮同一行：左边是数字，右边是动作，窄面板时换行。 */
export const ACTION_BAR_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  columnGap: 12,
  rowGap: 6,
  padding: '6px 12px 8px',
}

export const BUTTON_STYLE: CSSProperties = {
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: COLORS.border,
  color: COLORS.text,
  borderRadius: 6,
  padding: '4px 8px',
  cursor: 'pointer',
  font: 'inherit',
  whiteSpace: 'nowrap',
}

/** 图标按钮：不抢主操作的视觉，只做入口。 */
export const ICON_BUTTON_STYLE: CSSProperties = {
  ...BUTTON_STYLE,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '3px 5px',
  color: COLORS.secondary,
}

const ACTION_BUTTON_STYLE: CSSProperties = {
  ...BUTTON_STYLE,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 10px 4px 8px',
  fontSize: 12,
  fontWeight: 500,
  lineHeight: '18px',
}

/** 新建需求是本面板的主操作：实心强调色。 */
export const FEATURE_ACTION_STYLE: CSSProperties = {
  ...ACTION_BUTTON_STYLE,
  borderColor: COLORS.accent,
  background: COLORS.accent,
  color: '#fff',
}

/** 报 bug 是次操作：中性描边，只让图标和文字带错误色。 */
export const BUG_ACTION_STYLE: CSSProperties = {
  ...ACTION_BUTTON_STYLE,
  borderColor: COLORS.borderStrong,
  color: COLORS.error,
}

/** 分段控件里的一段；未选中时透明，悬停底色由面板样式表提供。 */
export const CHIP_STYLE: CSSProperties = {
  border: 'none',
  borderRadius: 6,
  color: COLORS.secondary,
  padding: '2px 10px',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 12,
  lineHeight: '20px',
  whiteSpace: 'nowrap',
}

export const CHIP_ACTIVE_STYLE: CSSProperties = {
  color: COLORS.text,
  fontWeight: 500,
  background: COLORS.surfaceRaised,
  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.12), 0 0 0 0.5px rgba(0, 0, 0, 0.08)',
}

/** 分段控件的槽。 */
export const SEGMENTED_STYLE: CSSProperties = {
  display: 'inline-flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 2,
  padding: 2,
  borderRadius: 8,
  background: COLORS.track,
}

/** 面板顶部：左侧视图页签，右侧流程帮助入口；分隔线横跨整行。 */
export const VIEW_BAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '0 12px',
  borderBottom: `1px solid ${COLORS.border}`,
}

/** 视图页签：导航层级，用下划线而不是分段控件，和下面的筛选区分开。 */
export const VIEW_TABS_STYLE: CSSProperties = {
  display: 'flex',
  gap: 16,
  padding: '0 12px',
  borderBottom: `1px solid ${COLORS.border}`,
  // 三个页签在窄侧栏里放不下时横向滚动，不挤压标题。
  overflowX: 'auto',
  flex: 'none',
}

export const VIEW_TAB_STYLE: CSSProperties = {
  position: 'relative',
  borderWidth: '0 0 2px',
  borderStyle: 'solid',
  borderColor: 'transparent',
  marginBottom: -1,
  padding: '9px 0 7px',
  color: COLORS.secondary,
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 13,
  whiteSpace: 'nowrap',
}

export const VIEW_TAB_ACTIVE_STYLE: CSSProperties = {
  borderColor: `transparent transparent ${COLORS.accent}`,
  color: COLORS.text,
  fontWeight: 600,
}

export const STATS_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
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
  fontSize: 14,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
}

export const TOOLBAR_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  padding: '0 12px 4px',
}

export const LOADED_STYLE: CSSProperties = {
  padding: '0 12px 6px',
  color: COLORS.tertiary,
  fontSize: 11,
  fontVariantNumeric: 'tabular-nums',
}

/** 加载与空状态的提示：左边与列表、工具栏同在 12px 页边距上。 */
export const EMPTY_STYLE: CSSProperties = {
  padding: '16px 12px',
  color: COLORS.secondary,
}

/** 卡片列表：卡片间距收紧到 6px，窄侧栏里一屏能多放几张。 */
export const LIST_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  padding: '0 12px 12px',
}

/**
 * 工单卡片：左列是行按钮（编号 + 标题，下面一行是状态与分类），右列是技能按钮或原因徽标，
 * 和标题第一行对齐。卡片表面在容器上，点空白处也算打开详情。
 */
export const CARD_ROW_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'start',
  columnGap: 10,
  padding: '7px 10px 8px',
  // 用边框长属性：悬停只改 borderColor，移开时 React 会把它恢复成这里的值，
  // 若写成 border 简写，移开会清空颜色、退回 currentColor（黑框）。
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: COLORS.border,
  borderRadius: 8,
  color: COLORS.text,
  cursor: 'pointer',
}

/** 从概览跳过来要定位的那一行：用强调色描边标出来。 */
export const CARD_FOCUSED_STYLE: CSSProperties = {
  borderColor: COLORS.accent,
  background: `color-mix(in srgb, ${COLORS.accent} 7%, transparent)`,
}

/** 行按钮：编号一列，标题与元信息共用第二列，标题换行时编号仍贴着第一行。 */
export const CARD_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0, 1fr)',
  alignItems: 'start',
  columnGap: 8,
  rowGap: 2,
  minWidth: 0,
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  font: 'inherit',
  textAlign: 'left',
}
export const NUMBER_BADGE_STYLE: CSSProperties = {
  gridColumn: '1',
  gridRow: '1',
  // 两位数编号刚好放下，标题在常见编号下对齐；更长的编号自然撑开。
  minWidth: '3ch',
  color: COLORS.tertiary,
  fontSize: 12,
  fontVariantNumeric: 'tabular-nums',
  lineHeight: '20px',
  whiteSpace: 'nowrap',
}

export const CARD_TITLE_STYLE: CSSProperties = {
  gridColumn: '2',
  gridRow: '1',
  minWidth: 0,
  fontWeight: 500,
  lineHeight: '20px',
  overflowWrap: 'anywhere',
}

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

/** 行内状态：圆点 + 文字，不加描边，避免和右侧按钮抢视线。 */
const STATUS_INLINE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 11,
  lineHeight: '18px',
  whiteSpace: 'nowrap',
}

const BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  border: '1px solid currentColor',
  borderRadius: 999,
  padding: '0 7px',
  fontSize: 11,
  lineHeight: '18px',
  whiteSpace: 'nowrap',
}

export const STATUS_LABELS: Record<TicketStatus, string> = {
  ready: '可接',
  blocked: '阻塞',
  closed: '已关闭',
  open: '开放',
}

export const STATUS_BADGES: Record<TicketStatus, CSSProperties> = {
  ready: { ...STATUS_INLINE_STYLE, color: COLORS.success, fontWeight: 500 },
  blocked: { ...STATUS_INLINE_STYLE, color: COLORS.warn },
  closed: { ...STATUS_INLINE_STYLE, color: COLORS.tertiary },
  open: { ...STATUS_INLINE_STYLE, color: COLORS.tertiary },
}

export const STATUS_DOT_STYLE: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: 'currentColor',
}

/** 分类是次要信息：浅色底、无描边，和状态区分开。 */
const CATEGORY_BADGE_STYLE: CSSProperties = {
  ...BADGE_STYLE,
  border: 'none',
  borderRadius: 4,
  padding: '0 5px',
  lineHeight: '17px',
}

export const CATEGORY_BADGES: Record<'bug' | 'enhancement', CSSProperties> = {
  bug: {
    ...CATEGORY_BADGE_STYLE,
    color: COLORS.error,
    background: `color-mix(in srgb, ${COLORS.error} 10%, transparent)`,
  },
  enhancement: {
    ...CATEGORY_BADGE_STYLE,
    color: COLORS.accent,
    background: `color-mix(in srgb, ${COLORS.accent} 10%, transparent)`,
  },
}

/** 渲染后的 Markdown 容器标记；样式表据此给其中的标题、列表、代码等元素排版。 */
export const MARKDOWN_ATTRIBUTE = 'data-markdown'

/**
 * Markdown 排版，对齐 GitHub issue 的读法：h1/h2 下有分隔线、代码与代码块浅灰底、
 * 表格斑马纹、引用左侧竖线、任务列表去掉圆点。侧栏窄，字号整体比 GitHub 小一号。
 * 只作用于 `[data-markdown]` 之内，不影响面板其它部分。
 */
const MARKDOWN_SHEET = `
[data-markdown] { font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
[data-markdown] > :first-child { margin-top: 0 !important; }
[data-markdown] > :last-child { margin-bottom: 0 !important; }
[data-markdown] p, [data-markdown] ul, [data-markdown] ol, [data-markdown] blockquote, [data-markdown] pre, [data-markdown] table, [data-markdown] details { margin: 0 0 12px; }
[data-markdown] h1, [data-markdown] h2, [data-markdown] h3, [data-markdown] h4, [data-markdown] h5, [data-markdown] h6 { margin: 20px 0 10px; font-weight: 600; line-height: 1.3; }
[data-markdown] h1 { font-size: 17px; padding-bottom: 0.3em; border-bottom: 1px solid ${COLORS.border}; }
[data-markdown] h2 { font-size: 15px; padding-bottom: 0.3em; border-bottom: 1px solid ${COLORS.border}; }
[data-markdown] h3 { font-size: 14px; }
[data-markdown] h4 { font-size: 13px; }
[data-markdown] h5, [data-markdown] h6 { font-size: 12px; color: ${COLORS.secondary}; }
[data-markdown] ul, [data-markdown] ol { padding-left: 2em; }
[data-markdown] li + li { margin-top: 0.25em; }
[data-markdown] li > p { margin: 0; }
[data-markdown] li > ul, [data-markdown] li > ol { margin: 0.25em 0 0; }
[data-markdown] li:has(> input[type="checkbox"]) { list-style: none; }
[data-markdown] li > input[type="checkbox"] { margin: 0 0.35em 0.2em -1.5em; vertical-align: middle; accent-color: ${COLORS.accent}; }
[data-markdown] a { color: ${COLORS.accent}; text-decoration: none; }
[data-markdown] a:hover { text-decoration: underline; text-underline-offset: 2px; }
[data-markdown] strong { font-weight: 600; }
[data-markdown] code { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; font-size: 85%; padding: 0.2em 0.4em; border-radius: 6px; background: rgba(128, 128, 128, 0.15); }
[data-markdown] pre { padding: 12px; border-radius: 6px; background: rgba(128, 128, 128, 0.1); overflow-x: auto; font-size: 85%; line-height: 1.45; }
[data-markdown] pre code { padding: 0; font-size: 100%; background: none; overflow-wrap: normal; white-space: pre; }
[data-markdown] blockquote { padding: 0 1em; border-left: 0.25em solid ${COLORS.borderStrong}; color: ${COLORS.secondary}; }
[data-markdown] hr { height: 0.25em; margin: 20px 0; border: none; background: ${COLORS.border}; }
[data-markdown] img { max-width: 100%; height: auto; border-radius: 6px; }
[data-markdown] table { display: block; width: max-content; max-width: 100%; overflow-x: auto; border-collapse: collapse; font-size: 12px; }
[data-markdown] th, [data-markdown] td { padding: 5px 12px; border: 1px solid ${COLORS.border}; text-align: left; }
[data-markdown] th { font-weight: 600; }
[data-markdown] tr:nth-child(2n) { background: rgba(128, 128, 128, 0.06); }
[data-markdown] kbd { padding: 2px 5px; font: 11px ui-monospace, Menlo, monospace; border: 1px solid ${COLORS.borderStrong}; border-bottom-width: 2px; border-radius: 6px; }
`

/**
 * 判定依据对应的颜色：不可开工的原因用中性/警告色，三个技能分别用实现（强调）、
 * 诊断（错误）、分流（警告）色。原因徽标与技能按钮共用这一份色相。
 */
export const ACTION_TONES: Record<TicketActionReason, string> = {
  closed: COLORS.tertiary,
  blocked: COLORS.warn,
  wontfix: COLORS.tertiary,
  'ready-for-human': COLORS.secondary,
  'needs-triage': COLORS.warn,
  'needs-info': COLORS.warn,
  untriaged: COLORS.warn,
  bug: COLORS.error,
  'ready-for-agent': COLORS.accent,
}

/** 不可开工的原因徽标：圆环 + 色相，读作标签而不是按钮。 */
export const ACTION_BADGE_STYLES: Record<TicketActionReason, CSSProperties> = {
  closed: { ...BADGE_STYLE, color: ACTION_TONES.closed },
  blocked: { ...BADGE_STYLE, color: ACTION_TONES.blocked },
  wontfix: { ...BADGE_STYLE, color: ACTION_TONES.wontfix },
  'ready-for-human': { ...BADGE_STYLE, color: ACTION_TONES['ready-for-human'] },
  'needs-triage': { ...BADGE_STYLE, color: ACTION_TONES['needs-triage'] },
  'needs-info': { ...BADGE_STYLE, color: ACTION_TONES['needs-info'] },
  untriaged: { ...BADGE_STYLE, color: ACTION_TONES.untriaged },
  bug: { ...BADGE_STYLE, color: ACTION_TONES.bug },
  'ready-for-agent': { ...BADGE_STYLE, color: ACTION_TONES['ready-for-agent'] },
}

/** 技能按钮（或原因徽标）在右列，与标题第一行的 20px 行高居中对齐。 */
export const CARD_ACTION_BADGE_STYLE: CSSProperties = {
  justifySelf: 'end',
  marginTop: -1,
}

/**
 * 可点的技能徽标：形状换成面板里通用的按钮（6px 圆角、12px、22px 高），
 * 和状态/分类标签的圆环拉开距离。底色与描边由样式表按 currentColor 调出，
 * 悬停和“已填入”才能在样式表里覆盖。
 */
export const SKILL_BADGE_BUTTON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  boxSizing: 'border-box',
  borderWidth: 1,
  borderStyle: 'solid',
  borderRadius: 6,
  height: 22,
  padding: '0 8px 0 5px',
  fontSize: 12,
  fontWeight: 500,
  lineHeight: '20px',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
}

/** 没有可用会话时技能徽标不可点。 */
export const SKILL_BADGE_DISABLED_STYLE: CSSProperties = {
  opacity: 0.45,
  cursor: 'not-allowed',
}

/**
 * 内联样式写不了伪类，这里集中放悬停、焦点和过渡。只作用于面板根节点之内；
 * 按钮的默认底色也放在这里，这样内联的选中态底色能覆盖它，悬停又能覆盖默认值。
 */
export const PANEL_SHEET = `
[data-anvil-panel] button { background: transparent; transition: background-color 150ms ease-out, border-color 150ms ease-out, color 150ms ease-out; }
[data-anvil-panel] [data-hover="card"] { transition: background-color 150ms ease-out, border-color 150ms ease-out; }
[data-anvil-panel] button:disabled { cursor: default; opacity: 0.5; }
[data-anvil-panel] input { transition: border-color 150ms ease-out; }
[data-anvil-panel] input::placeholder { color: ${COLORS.tertiary}; opacity: 1; }
[data-anvil-panel] input:disabled { opacity: 0.6; }
[data-anvil-panel] input:focus { outline: none; }
[data-anvil-panel] input:focus-visible { border-color: ${COLORS.accent}; box-shadow: 0 0 0 1px ${COLORS.accent}; }
[data-anvil-panel] button:focus { outline: none; }
[data-anvil-panel] button:focus-visible { outline: 2px solid ${COLORS.accent}; outline-offset: 1px; }
[data-anvil-panel] [data-hover="soft"]:not(:disabled):not([aria-pressed="true"]):hover { background: ${COLORS.surfaceActive}; color: ${COLORS.text}; }
[data-anvil-panel] [data-hover="tab"]:not([aria-pressed="true"]):hover { color: ${COLORS.text}; }
[data-anvil-panel] [data-hover="card"]:hover { border-color: ${COLORS.borderStrong}; background: rgba(128, 128, 128, 0.06); }
[data-anvil-panel] [data-hover="primary"]:not(:disabled):hover { filter: brightness(1.08); }
[data-anvil-panel] [data-hover="secondary"]:not(:disabled):hover { background: color-mix(in srgb, ${COLORS.error} 8%, transparent); }
[data-anvil-panel] [data-hover="action"] { border-color: color-mix(in srgb, currentColor 30%, transparent); background: color-mix(in srgb, currentColor 12%, transparent); }
[data-anvil-panel] [data-hover="action"]:not(:disabled):not([data-injected="true"]):hover { border-color: color-mix(in srgb, currentColor 55%, transparent); background: color-mix(in srgb, currentColor 20%, transparent); }
[data-anvil-panel] [data-hover="action"]:not(:disabled):active { border-color: color-mix(in srgb, currentColor 65%, transparent); background: color-mix(in srgb, currentColor 28%, transparent); }
[data-anvil-panel] [data-hover="action"][data-injected="true"]:not(:disabled) { border-color: color-mix(in srgb, currentColor 55%, transparent); background: color-mix(in srgb, currentColor 20%, transparent); }
[data-anvil-panel] [data-hover="action"]:disabled { border-color: ${COLORS.border}; background: transparent; }
[data-anvil-panel] [data-hover="link"]:hover { text-decoration: underline; }
[data-anvil-panel] a:focus { outline: none; }
[data-anvil-panel] a:focus-visible { outline: 2px solid ${COLORS.accent}; outline-offset: 1px; border-radius: 2px; }
${MARKDOWN_SHEET}
@media (prefers-reduced-motion: reduce) { [data-anvil-panel] button, [data-anvil-panel] [data-hover="card"], [data-anvil-panel] input { transition: none; } }
`

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
  { value: 'status', label: '状态' },
  { value: 'updated', label: '更新' },
  { value: 'created', label: '创建' },
  { value: 'number', label: '编号' },
  { value: 'title', label: '标题' },
]
