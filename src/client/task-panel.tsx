/**
 * MattWorkflow 右栏面板外壳：在「列表」「环境检查」和「流程帮助」三个视图之间切换。
 * 两个业务视图各自管理自己的请求与状态；帮助视图只是静态流程图。
 * 切换视图不丢失列表的视图偏好——偏好按工作区存在浏览器本地存储里。
 */
import * as React from 'react'

import type { BackendKind } from '../protocol/backend.ts'
import type { CapabilityDiagnostic } from '../protocol/env-check.ts'
import { ERROR_BACKENDS } from '../protocol/tracker.ts'
import { EnvCheckView } from './env-check-view.tsx'
import { HelpView } from './help-view.tsx'
import type { PanelClient } from './rpc.ts'
import {
  ICON_BUTTON_STYLE,
  PANEL_SHEET,
  PANEL_STYLE,
  VIEW_BAR_STYLE,
  VIEW_TAB_ACTIVE_STYLE,
  VIEW_TAB_STYLE,
  VIEW_TABS_STYLE,
} from './task-panel-styles.ts'
import { TicketsView } from './tickets-view.tsx'

/** 面板依赖。 */
export interface TaskPanelProps {
  readonly client: PanelClient
  readonly workspaceRoot: string | undefined
  readonly canInject: boolean
  readonly injectDraft: (text: string) => boolean
  readonly now?: (() => number) | undefined
  /** 界面扩展点探测结果；省略时环境检查仍能显示宿主服务。 */
  readonly clientCapabilities?: (() => readonly CapabilityDiagnostic[]) | undefined
}

type View = 'tickets' | 'env' | 'help'

const NO_CAPABILITIES = (): readonly CapabilityDiagnostic[] => []

/**
 * MattWorkflow 面板的根组件。
 * @param props - 面板客户端、工作区、提示词注入能力与界面能力读取函数。
 * @returns 视图切换条与当前视图。
 */
export function TaskPanel(props: TaskPanelProps): React.ReactElement {
  const [view, setView] = React.useState<View>('tickets')
  const [focusBackend, setFocusBackend] = React.useState<FocusBackend>(null)
  // 从帮助返回打开前的视图；帮助里再点 tips 不覆盖它。
  const previousView = React.useRef<Exclude<View, 'help'>>('tickets')
  const clientCapabilities = props.clientCapabilities ?? NO_CAPABILITIES

  const openHelp = (): void => {
    if (view !== 'help') previousView.current = view
    setView('help')
  }

  return (
    <div data-testid="task-panel" data-anvil-panel="" style={PANEL_STYLE}>
      <style>{PANEL_SHEET}</style>
      <div style={VIEW_BAR_STYLE}>
        <div role="group" aria-label="视图" style={VIEW_TABS_STYLE}>
          <ViewChip
            testId="view-tickets"
            label="列表"
            active={view === 'tickets'}
            onClick={() => {
              setView('tickets')
            }}
          />
          <ViewChip
            testId="view-env"
            label="环境检查"
            active={view === 'env'}
            onClick={() => {
              setFocusBackend(null)
              setView('env')
            }}
          />
        </div>
        <TipsButton onClick={openHelp} />
      </div>
      {view === 'tickets' ? (
        <TicketsView
          client={props.client}
          workspaceRoot={props.workspaceRoot}
          canInject={props.canInject}
          injectDraft={props.injectDraft}
          now={props.now}
          onOpenEnvCheck={(code) => {
            setFocusBackend(ERROR_BACKENDS[code] ?? null)
            setView('env')
          }}
        />
      ) : view === 'env' ? (
        <EnvCheckView
          client={props.client}
          workspaceRoot={props.workspaceRoot}
          canInject={props.canInject}
          injectDraft={props.injectDraft}
          clientCapabilities={clientCapabilities}
          focusBackend={focusBackend}
        />
      ) : (
        <HelpView
          onBack={() => {
            setView(previousView.current)
          }}
        />
      )}
    </div>
  )
}

/** 从列表错误跳到环境检查时，要落到的后端。 */
type FocusBackend = Exclude<BackendKind, 'markdown'> | null

function ViewChip(props: {
  readonly testId: string
  readonly label: string
  readonly active: boolean
  readonly onClick: () => void
}): React.ReactElement {
  return (
    <button
      type="button"
      data-testid={props.testId}
      aria-pressed={props.active}
      onClick={props.onClick}
      data-hover="tab"
      style={{ ...VIEW_TAB_STYLE, ...(props.active ? VIEW_TAB_ACTIVE_STYLE : undefined) }}
    >
      {props.label}
    </button>
  )
}

function TipsButton(props: { readonly onClick: () => void }): React.ReactElement {
  return (
    <button
      type="button"
      data-testid="tips"
      aria-label="流程帮助"
      title="流程帮助"
      onClick={props.onClick}
      style={ICON_BUTTON_STYLE}
    >
      <TipsIcon />
    </button>
  )
}

function TipsIcon(): React.ReactElement {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 1.8a4.1 4.1 0 0 0-2.5 7.4c.3.2.5.5.5.9v.4h4v-.4c0-.4.2-.7.5-.9A4.1 4.1 0 0 0 8 1.8Z" />
      <path d="M6.4 12.6h3.2" />
      <path d="M7.2 14.4h1.6" />
    </svg>
  )
}
