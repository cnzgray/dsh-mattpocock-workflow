/**
 * 详情导航：当前打开的是哪张票、详情返回栈，以及从详情里按引用打开阻塞票。
 *
 * 返回栈只保存每张票打开时的目标；快照刷新不改变它，换工作区清空。
 * 从列表打开详情时清空栈；从详情里打开阻塞项时压入当前目标。
 * 按引用打开、快照里没有这张票时也照常打开，只把快照行留空。
 */
import * as React from 'react'

import type { TicketSnapshot, WorkspaceSnapshot } from '../protocol/tracker.ts'
import type { DetailTarget } from './ticket-detail-view.tsx'
import { blockerNumber, findSnapshotTicket } from './ticket-blockers.tsx'

/** 导航里的详情目标：详情视图的目标，外加它所属的工作区。 */
export interface DetailTargetState {
  /** 详情所属工作区：工作区一变就立即失效，不会用新工作区去读旧票。 */
  readonly workspaceRoot: string
  readonly target: DetailTarget
}

export interface DetailNavigation {
  /** 当前工作区里打开的详情；没有或属于别的工作区时为 null。 */
  readonly open: DetailTargetState | null
  /** 返回栈顶的引用；栈空时为 null。 */
  readonly backRef: string | null
  /** 从列表打开：清空返回栈。 */
  readonly openFromList: (ticket: TicketSnapshot) => void
  /** 从详情里打开一条阻塞项：压入当前目标，再按引用打开下一张。 */
  readonly openBlocker: (ref: string, snapshot: WorkspaceSnapshot | null) => void
  /** 返回上一层；栈空时回列表。 */
  readonly back: () => void
  /** 清空详情与返回栈（页签栏回列表、切到概览）。 */
  readonly close: () => void
}

interface NavigationState {
  readonly open: DetailTargetState | null
  readonly stack: readonly DetailTargetState[]
}

const EMPTY: NavigationState = { open: null, stack: [] }

/**
 * 详情导航状态。
 * @param workspaceRoot - 当前工作区；undefined 时不能打开详情。
 * @returns 当前详情、返回栈顶与四个入口。
 */
export function useDetailNavigation(workspaceRoot: string | undefined): DetailNavigation {
  const [navigation, setNavigation] = React.useState<NavigationState>(EMPTY)

  // 换工作区时清空返回栈：不能把上一个仓库的票当成“上一张”。
  React.useEffect(() => {
    setNavigation((current) => (current.stack.length === 0 ? current : { ...current, stack: [] }))
  }, [workspaceRoot])

  const open =
    navigation.open !== null && navigation.open.workspaceRoot === workspaceRoot
      ? navigation.open
      : null

  return {
    open,
    backRef: open === null ? null : (navigation.stack.at(-1)?.target.ref ?? null),
    openFromList: (ticket) => {
      if (workspaceRoot === undefined) return
      setNavigation({
        open: {
          workspaceRoot,
          target: { ref: ticket.ref, number: ticket.number, ticket },
        },
        stack: [],
      })
    },
    openBlocker: (ref, snapshot) => {
      if (workspaceRoot === undefined) return
      setNavigation((current) => {
        const from = current.open
        if (from?.workspaceRoot !== workspaceRoot) return current
        const row = findSnapshotTicket(snapshot?.tickets, ref)
        return {
          open: {
            workspaceRoot,
            target: {
              ref,
              number: row?.number ?? blockerNumber(ref),
              ticket: row,
            },
          },
          stack: [...current.stack, from],
        }
      })
    },
    back: () => {
      setNavigation((current) => {
        const previous = current.stack.at(-1)
        if (previous === undefined) return EMPTY
        return { open: previous, stack: current.stack.slice(0, -1) }
      })
    },
    close: () => {
      setNavigation(EMPTY)
    },
  }
}
