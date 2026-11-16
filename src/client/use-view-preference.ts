/**
 * 把视图偏好接到 React 状态：首次渲染同步读取，工作区变化时换成本工作区的存档，
 * 筛选、排序键或方向变化后立即写回。存储不可用时全部退回默认视图。
 */
import * as React from 'react'

import { defaultSortDirection, type TicketFilter, type TicketSortKey } from './ticket-view.ts'
import {
  readViewPreference,
  writeViewPreference,
  type PreferenceStorage,
  type ViewPreference,
} from './view-preference.ts'

/** 视图偏好的当前值与两个修改入口。 */
export interface ViewPreferenceControls {
  readonly preference: ViewPreference
  readonly setFilter: (filter: TicketFilter) => void
  readonly toggleSort: (key: TicketSortKey) => void
  readonly toggleAssignedToMe: () => void
  readonly toggleCreatedByMe: () => void
  readonly clearMyTickets: () => void
}

interface ViewState {
  readonly workspaceRoot: string | undefined
  readonly preference: ViewPreference
}

/**
 * 读取并按工作区维护视图偏好。
 * @param workspaceRoot - 当前工作区根路径；没有工作区时始终返回默认视图且不写入。
 * @returns 当前偏好与筛选、排序入口。
 */
export function useViewPreference(workspaceRoot: string | undefined): ViewPreferenceControls {
  const storage = React.useMemo(resolvePreferenceStorage, [])
  const [viewState, setViewState] = React.useState<ViewState>(() => ({
    workspaceRoot,
    preference: readViewPreference(storage, workspaceRoot),
  }))
  // 工作区变化时就地换成本工作区的存档；渲染期更新状态可避免先闪一下默认视图。
  const activeState =
    viewState.workspaceRoot === workspaceRoot
      ? viewState
      : {
          workspaceRoot,
          preference: readViewPreference(storage, workspaceRoot),
        }
  if (activeState !== viewState) setViewState(activeState)
  const { preference } = activeState

  const apply = (next: ViewPreference): void => {
    setViewState({ workspaceRoot, preference: next })
    writeViewPreference(storage, workspaceRoot, next)
  }

  return {
    preference,
    setFilter: (filter) => {
      apply({ ...preference, filter })
    },
    toggleSort: (key) => {
      if (key === preference.sortKey) {
        apply({
          ...preference,
          direction: preference.direction === 'asc' ? 'desc' : 'asc',
        })
        return
      }
      apply({ ...preference, sortKey: key, direction: defaultSortDirection(key) })
    },
    toggleAssignedToMe: () => {
      apply({ ...preference, assignedToMe: !preference.assignedToMe })
    },
    toggleCreatedByMe: () => {
      apply({ ...preference, createdByMe: !preference.createdByMe })
    },
    clearMyTickets: () => {
      apply({ ...preference, assignedToMe: false, createdByMe: false })
    },
  }
}

function resolvePreferenceStorage(): PreferenceStorage | undefined {
  try {
    return window.localStorage
  } catch {
    // 隐私模式或存储被禁用：访问本身就会抛错。
    return undefined
  }
}
