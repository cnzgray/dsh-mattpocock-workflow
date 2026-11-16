/**
 * 父子布局的会话内状态：折叠集合在面板存活期间跨视图保留，
 * 打开详情、切到概览再回来都不会丢；换工作区时清空。
 * 不写进视图偏好，也不持久化。
 */
import * as React from 'react'

/** 面板级的父子布局会话状态。 */
export interface TicketTreeSession {
  readonly collapsed: ReadonlySet<string>
  readonly setCollapsed: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>
}

const CONTEXT = React.createContext<TicketTreeSession | null>(null)

/**
 * 提供面板级的折叠集合。
 * @param props - 当前工作区与子树；工作区变化时清空折叠。
 * @returns 带上下文的子树。
 */
export function TicketTreeSessionProvider(props: {
  readonly workspaceRoot: string | undefined
  readonly children: React.ReactNode
}): React.ReactElement {
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(() => new Set())
  const previousRoot = React.useRef(props.workspaceRoot)
  if (previousRoot.current !== props.workspaceRoot) {
    previousRoot.current = props.workspaceRoot
    setCollapsed(new Set())
  }

  const value = React.useMemo<TicketTreeSession>(() => ({ collapsed, setCollapsed }), [collapsed])
  return <CONTEXT.Provider value={value}>{props.children}</CONTEXT.Provider>
}

/**
 * 读取面板级的折叠集合；列表单独渲染（例如组件测试）时没有 Provider，返回 null，
 * 由列表自己维护一份会话内状态。
 * @returns 会话状态或 null。
 */
export function useTicketTreeSession(): TicketTreeSession | null {
  return React.useContext(CONTEXT)
}
