/**
 * 父子布局的折叠状态：优先用面板级的会话状态（跨视图保留），
 * 单独渲染列表时退回本地会话状态；换工作区时清空。
 * 从概览定位一张被折叠的票时展开它的祖先链。
 */
import * as React from 'react'

import type { TicketSnapshot } from '../protocol/tracker.ts'
import { useTicketTreeSession } from './ticket-tree-session.tsx'
import { expandAncestors } from './ticket-tree.ts'

/**
 * 维护列表视图的折叠集合。
 * @param workspaceRoot - 当前工作区；变化时清空折叠。
 * @param focused - 当前定位的票；变化时展开祖先。
 * @param visible - 当前可见票，用来找祖先链。
 * @returns 折叠集合与切换入口。
 */
export function useCollapsedTickets(
  workspaceRoot: string | undefined,
  focused: string | null,
  visible: readonly TicketSnapshot[],
): {
  readonly collapsed: ReadonlySet<string>
  readonly toggle: (ref: string) => void
} {
  const session = useTicketTreeSession()
  const [localCollapsed, setLocalCollapsed] = React.useState<ReadonlySet<string>>(() => new Set())
  const previousRoot = React.useRef(workspaceRoot)
  const expandedFor = React.useRef<string | null>(null)

  if (previousRoot.current !== workspaceRoot) {
    previousRoot.current = workspaceRoot
    expandedFor.current = null
    // 没有面板级 Provider 时，列表自己清空；有 Provider 时由它负责。
    if (session === null) setLocalCollapsed(new Set())
  }

  const collapsed = session?.collapsed ?? localCollapsed
  const setCollapsed = session?.setCollapsed ?? setLocalCollapsed

  React.useEffect(() => {
    // 定位先于数据到达时先不标记，等可见票就绪后再展开一次。
    if (focused === null || visible.length === 0 || expandedFor.current === focused) return
    expandedFor.current = focused
    setCollapsed((current) => expandAncestors(visible, current, focused))
  }, [focused, visible, setCollapsed])

  return {
    collapsed,
    toggle: (ref) => {
      setCollapsed((current) => {
        const next = new Set(current)
        if (!next.delete(ref)) next.add(ref)
        return next
      })
    },
  }
}
