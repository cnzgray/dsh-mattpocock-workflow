/**
 * MattWorkflow 右栏面板外壳：在「列表 / 概览 / 工单详情 / 环境检查」与「流程帮助」之间切换。
 * 三个业务视图各自管理自己的请求与状态；帮助视图只是静态流程图。
 * 详情态由当前选中的工单驱动：点击工单行进入详情，返回或 Esc 回到列表；
 * 列表的筛选与排序由视图偏好按工作区记住，重新挂载时原样恢复。
 * 概览只读：从关注清单点进列表只定位那张票，不注入提示词。
 * 切换工作区时详情复位，避免显示上一个仓库的票。
 */
import * as React from 'react'

import type { BackendKind } from '../protocol/backend.ts'
import type { CapabilityDiagnostic } from '../protocol/env-check.ts'
import { ERROR_BACKENDS, type ErrorCode, type TicketSnapshot } from '../protocol/tracker.ts'
import { EnvCheckView } from './env-check-view.tsx'
import { HelpView } from './help-view.tsx'
import { OverviewView } from './overview-view.tsx'
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
import { TicketDetailView } from './ticket-detail-view.tsx'
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

type View = 'tickets' | 'overview' | 'env' | 'help'

/** 当前打开的详情；保存整张列表快照行，详情头部与列表行共用同一份技能动作。 */
interface OpenTicket {
  /** 详情所属工作区：工作区一变就立即失效，不会用新工作区去读旧票。 */
  readonly workspaceRoot: string
  readonly ticket: TicketSnapshot
}

const NO_CAPABILITIES = (): readonly CapabilityDiagnostic[] => []

/**
 * MattWorkflow 面板的根组件。
 * @param props - 面板客户端、工作区、提示词注入能力与界面能力读取函数。
 * @returns 视图切换条与当前视图。
 */
export function TaskPanel(props: TaskPanelProps): React.ReactElement {
  const [view, setView] = React.useState<View>('tickets')
  const [focusBackend, setFocusBackend] = React.useState<FocusBackend>(null)
  const [openTicket, setOpenTicket] = React.useState<OpenTicket | null>(null)
  // 从概览跳进列表时要定位的票；列表消费后清空。
  const [focusTicket, setFocusTicket] = React.useState<string | null>(null)
  // 从帮助返回打开前的视图；帮助里再点 tips 不覆盖它。
  const previousView = React.useRef<Exclude<View, 'help'>>('tickets')
  const clientCapabilities = props.clientCapabilities ?? NO_CAPABILITIES

  // 详情只在它所属的工作区里有效；切换工作区后立即回到新仓库的列表。
  const open =
    openTicket !== null && openTicket.workspaceRoot === props.workspaceRoot ? openTicket : null

  const openHelp = (): void => {
    if (view !== 'help') previousView.current = view
    setView('help')
  }

  return (
    <div data-testid="task-panel" data-anvil-panel="" style={PANEL_STYLE}>
      <style>{PANEL_SHEET}</style>
      <ViewTabs
        view={view}
        onOpenTickets={() => {
          setView('tickets')
          setOpenTicket(null)
        }}
        onOpenOverview={() => {
          setOpenTicket(null)
          setView('overview')
        }}
        onOpenEnvCheck={() => {
          setFocusBackend(null)
          setView('env')
        }}
        onOpenHelp={openHelp}
      />
      <PanelContent
        panel={props}
        view={view}
        open={open}
        focusBackend={focusBackend}
        focusTicket={focusTicket}
        clientCapabilities={clientCapabilities}
        onOpenEnvCheck={(code) => {
          setFocusBackend(ERROR_BACKENDS[code] ?? null)
          setView('env')
        }}
        onOpenTicket={(ticket: TicketSnapshot) => {
          if (props.workspaceRoot === undefined) return
          setOpenTicket({ workspaceRoot: props.workspaceRoot, ticket })
        }}
        onFocusHandled={() => {
          setFocusTicket(null)
        }}
        onCloseDetail={() => {
          setOpenTicket(null)
        }}
        onLocateTicket={(ref: string) => {
          setFocusTicket(ref)
          setOpenTicket(null)
          setView('tickets')
        }}
        onBack={() => {
          setView(previousView.current)
        }}
      />
    </div>
  )
}

/**
 * 当前视图的内容：列表、概览、环境检查或流程帮助。
 * @param props - 面板依赖、当前状态与跳转回调。
 * @returns 当前视图。
 */
function PanelContent(props: {
  readonly panel: TaskPanelProps
  readonly view: View
  readonly open: OpenTicket | null
  readonly focusBackend: FocusBackend
  readonly focusTicket: string | null
  readonly clientCapabilities: () => readonly CapabilityDiagnostic[]
  readonly onOpenEnvCheck: (code: ErrorCode) => void
  readonly onOpenTicket: (ticket: TicketSnapshot) => void
  readonly onFocusHandled: () => void
  readonly onCloseDetail: () => void
  readonly onLocateTicket: (ref: string) => void
  readonly onBack: () => void
}): React.ReactElement {
  const panel = props.panel

  if (props.view === 'tickets') {
    return (
      <TicketsPane
        client={panel.client}
        workspaceRoot={panel.workspaceRoot}
        canInject={panel.canInject}
        injectDraft={panel.injectDraft}
        now={panel.now}
        open={props.open}
        focusTicket={props.focusTicket}
        onOpenEnvCheck={props.onOpenEnvCheck}
        onOpenTicket={props.onOpenTicket}
        onFocusHandled={props.onFocusHandled}
        onCloseDetail={props.onCloseDetail}
      />
    )
  }

  if (props.view === 'overview') {
    return (
      <OverviewPane
        client={panel.client}
        workspaceRoot={panel.workspaceRoot}
        now={panel.now}
        onOpenTicket={props.onLocateTicket}
        onOpenEnvCheck={props.onOpenEnvCheck}
      />
    )
  }

  if (props.view === 'env') {
    return (
      <EnvCheckView
        client={panel.client}
        workspaceRoot={panel.workspaceRoot}
        canInject={panel.canInject}
        injectDraft={panel.injectDraft}
        clientCapabilities={props.clientCapabilities}
        focusBackend={props.focusBackend}
      />
    )
  }

  return <HelpView onBack={props.onBack} />
}

/** 从列表错误跳到环境检查时，要落到的后端。 */
type FocusBackend = Exclude<BackendKind, 'markdown'> | null

/**
 * 概览页：只读的一屏总览。
 * @param props - 面板依赖与跳转回调。
 * @returns 概览视图。
 */
function OverviewPane(props: {
  readonly client: PanelClient
  readonly workspaceRoot: string | undefined
  readonly now: (() => number) | undefined
  readonly onOpenTicket: (ref: string) => void
  readonly onOpenEnvCheck: (code: ErrorCode) => void
}): React.ReactElement {
  return (
    <OverviewView
      client={props.client}
      workspaceRoot={props.workspaceRoot}
      now={props.now}
      onOpenTicket={props.onOpenTicket}
      onOpenEnvCheck={props.onOpenEnvCheck}
    />
  )
}

/**
 * 列表页：选中工单时显示详情，否则显示列表。
 * @param props - 面板依赖、当前打开的工单与跳转回调。
 * @returns 详情视图或列表视图。
 */
function TicketsPane(props: {
  readonly client: PanelClient
  readonly workspaceRoot: string | undefined
  readonly canInject: boolean
  readonly injectDraft: (text: string) => boolean
  readonly now: (() => number) | undefined
  readonly open: OpenTicket | null
  readonly focusTicket: string | null
  readonly onOpenEnvCheck: (code: ErrorCode) => void
  readonly onOpenTicket: (ticket: TicketSnapshot) => void
  readonly onFocusHandled: () => void
  readonly onCloseDetail: () => void
}): React.ReactElement {
  if (props.workspaceRoot !== undefined && props.open !== null) {
    return (
      <TicketDetailView
        client={props.client}
        workspaceRoot={props.workspaceRoot}
        ticket={props.open.ticket}
        canInject={props.canInject}
        injectDraft={props.injectDraft}
        onBack={props.onCloseDetail}
      />
    )
  }

  return (
    <TicketsView
      client={props.client}
      workspaceRoot={props.workspaceRoot}
      canInject={props.canInject}
      injectDraft={props.injectDraft}
      now={props.now}
      focusRef={props.focusTicket}
      onFocusHandled={props.onFocusHandled}
      onOpenEnvCheck={props.onOpenEnvCheck}
      onOpenTicket={props.onOpenTicket}
    />
  )
}

/** 视图切换条：「列表」「概览」「环境检查」与右侧的流程帮助入口。 */
function ViewTabs(props: {
  readonly view: View
  readonly onOpenTickets: () => void
  readonly onOpenOverview: () => void
  readonly onOpenEnvCheck: () => void
  readonly onOpenHelp: () => void
}): React.ReactElement {
  return (
    <div style={VIEW_BAR_STYLE}>
      <div role="group" aria-label="视图" style={VIEW_TABS_STYLE}>
        <ViewChip
          testId="view-tickets"
          label="列表"
          active={props.view === 'tickets'}
          onClick={props.onOpenTickets}
        />
        <ViewChip
          testId="view-overview"
          label="概览"
          active={props.view === 'overview'}
          onClick={props.onOpenOverview}
        />
        <ViewChip
          testId="view-env"
          label="环境检查"
          active={props.view === 'env'}
          onClick={props.onOpenEnvCheck}
        />
      </div>
      <TipsButton onClick={props.onOpenHelp} />
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
