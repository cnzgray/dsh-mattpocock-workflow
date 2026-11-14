/**
 * 分裂动作：主键把提示词填进当前会话，右侧窄箭头用同一段提示词开一个新会话。
 * 顶部三个提示词按钮与工单行内的技能徽标共用这个控件，交互与无障碍说明只有一份。
 *
 * 箭头是直接动作，不是菜单：一次点击就选定目标会话。宿主不提供新建会话能力时
 * 只禁用箭头，主键照常可用；禁用原因写进悬停说明与读屏标签。
 */
import * as React from 'react'
import type { CSSProperties, ReactNode } from 'react'

import { NewSessionIcon } from './icons.tsx'
import { NO_NEW_SESSION } from './injection.ts'
import { SPLIT_DISABLED_STYLE } from './task-panel-styles.ts'

/**
 * 分裂动作：主键与小箭头并排成一组，共用边框、底色和圆角。
 * 外层不换行；箭头不参与收缩，窄侧栏里只有主键文字会截断。
 */
const GROUP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'stretch',
  flex: 'none',
  whiteSpace: 'nowrap',
}

/** 主键左圆角、箭头右圆角；中缝只留箭头左侧一条分隔线。 */
const PRIMARY_STYLE: CSSProperties = {
  borderRadius: '6px 0 0 6px',
  borderRight: 'none',
}

const SEAM_COLOR = 'color-mix(in srgb, currentColor 35%, transparent)'

const ARROW_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxSizing: 'border-box',
  flex: 'none',
  width: 20,
  padding: 0,
  borderWidth: 1,
  borderStyle: 'solid',
  borderRadius: '0 6px 6px 0',
  cursor: 'pointer',
  font: 'inherit',
}

/** 工单行里的徽标保持 22px 高，箭头比顶部按钮更窄。 */
const ARROW_COMPACT_STYLE: CSSProperties = {
  width: 16,
  height: 22,
}

/** 分裂动作的依赖。 */
export interface SplitActionProps {
  /** 主键的 `data-testid`；小箭头固定用 `${testId}-new-session`。 */
  readonly testId: string
  readonly label: ReactNode
  /** 主键前的图标；大头针与小箭头各自渲染。 */
  readonly icon?: ReactNode
  readonly title: string
  readonly ariaLabel: string
  readonly primaryStyle: CSSProperties
  /** 与面板样式表的悬停约定一致。 */
  readonly primaryHover: 'primary' | 'secondary' | 'action'
  readonly disabled: boolean
  readonly canStartNewSession: boolean
  /** 小箭头的说明，例如「在新会话开始」。 */
  readonly newSessionTitle: string
  /** 宿主缺新建会话能力时的原因；省略时用共用文案。 */
  readonly newSessionDisabledHint?: string | undefined
  readonly onPrimary: () => void
  readonly onStartSession: () => void
  /** 工单行里的紧凑版：22px 高、箭头更窄。 */
  readonly compact?: boolean
  /** 版式位置；两组分裂动作的按钮本体不变。 */
  readonly style?: CSSProperties | undefined
  /** 主键上的额外数据属性（例如定位用的 `data-ref`）。 */
  readonly primaryAttributes?: Readonly<Record<string, string>>
}

/**
 * 渲染一组分裂动作。
 * @param props - 文案、样式、可用性与两个回调。
 * @returns 主键加小箭头。
 */
export function SplitAction(props: SplitActionProps): React.ReactElement {
  const arrowHint = props.canStartNewSession
    ? props.newSessionTitle
    : `${props.newSessionTitle}（${props.newSessionDisabledHint ?? NO_NEW_SESSION}）`

  return (
    <div
      data-split-group=""
      data-testid={`${props.testId}-group`}
      style={{ ...GROUP_STYLE, ...props.style }}
    >
      <button
        type="button"
        data-testid={props.testId}
        {...props.primaryAttributes}
        data-hover={props.primaryHover}
        disabled={props.disabled}
        title={props.title}
        aria-label={props.ariaLabel}
        onClick={(event) => {
          // 工单行整体可点：分裂动作只执行自己的动作，不打开详情。
          event.stopPropagation()
          props.onPrimary()
        }}
        style={{
          ...props.primaryStyle,
          ...PRIMARY_STYLE,
          ...(props.disabled ? SPLIT_DISABLED_STYLE : undefined),
        }}
      >
        {props.icon}
        {props.label}
      </button>
      <button
        type="button"
        data-testid={`${props.testId}-new-session`}
        data-hover={props.primaryHover}
        disabled={!props.canStartNewSession}
        title={arrowHint}
        aria-label={arrowHint}
        onClick={(event) => {
          event.stopPropagation()
          props.onStartSession()
        }}
        style={arrowStyle(props)}
      >
        <NewSessionIcon />
      </button>
    </div>
  )
}

function arrowStyle(props: SplitActionProps): CSSProperties {
  const primary = props.primaryStyle
  return {
    ...ARROW_STYLE,
    ...(props.compact === true ? ARROW_COMPACT_STYLE : undefined),
    // 与主键共用底色、描边和文字色，读起来是一整个动作。
    ...(primary.color === undefined ? undefined : { color: primary.color }),
    ...(primary.borderColor === undefined ? undefined : { borderColor: primary.borderColor }),
    ...(primary.background === undefined ? undefined : { background: primary.background }),
    // 分隔线跟随文字色淡化：实心按钮上是浅白线，描边按钮上是淡错误色线。
    borderLeftColor: SEAM_COLOR,
    ...(props.canStartNewSession ? undefined : SPLIT_DISABLED_STYLE),
  }
}
