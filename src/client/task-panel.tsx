/**
 * MattWorkflow 右栏面板外壳：在「列表」和「环境检查」两个视图之间切换。
 * 两个视图各自管理自己的请求与状态，切换时列表视图会重新挂载并拉取快照。
 */
import * as React from 'react'

import type { CapabilityDiagnostic } from '../protocol/env-check.ts'
import { EnvCheckView } from './env-check-view.tsx'
import type { PanelClient } from './rpc.ts'
import {
  PANEL_SHEET,
  PANEL_STYLE,
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

type View = 'tickets' | 'env'

const NO_CAPABILITIES = (): readonly CapabilityDiagnostic[] => []

/**
 * MattWorkflow 面板的根组件。
 * @param props - 面板客户端、工作区、提示词注入能力与界面能力读取函数。
 * @returns 视图切换条与当前视图。
 */
export function TaskPanel(props: TaskPanelProps): React.ReactElement {
  const [view, setView] = React.useState<View>('tickets')
  const clientCapabilities = props.clientCapabilities ?? NO_CAPABILITIES

  return (
    <div data-testid="task-panel" data-anvil-panel="" style={PANEL_STYLE}>
      <style>{PANEL_SHEET}</style>
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
            setView('env')
          }}
        />
      </div>
      {view === 'tickets' ? (
        <TicketsView
          client={props.client}
          workspaceRoot={props.workspaceRoot}
          canInject={props.canInject}
          injectDraft={props.injectDraft}
          now={props.now}
          onOpenEnvCheck={() => {
            setView('env')
          }}
        />
      ) : (
        <EnvCheckView
          client={props.client}
          workspaceRoot={props.workspaceRoot}
          canInject={props.canInject}
          injectDraft={props.injectDraft}
          clientCapabilities={clientCapabilities}
        />
      )}
    </div>
  )
}

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
