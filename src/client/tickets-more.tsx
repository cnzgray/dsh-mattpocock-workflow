/**
 * 列表底部的「加载更多」：判断还能不能扩、渲染哨兵、观察它是否进入视口。
 * 只做界面状态与观察，合并、排序与窗口上限都在宿主。
 */
import * as React from 'react'

import {
  SNAPSHOT_MAX_WINDOW,
  type RpcErrorBody,
  type WorkspaceSnapshot,
} from '../protocol/tracker.ts'
import { COLORS } from './task-panel-styles.ts'

/** 列表底部哨兵：滚到这里就自动扩一页；失败时停在这里等重试。 */
const MORE_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '8px 12px',
  color: COLORS.tertiary,
  fontSize: 11,
}

const MORE_RETRY_STYLE: React.CSSProperties = {
  padding: '2px 8px',
  border: `1px solid ${COLORS.border}`,
  borderRadius: 4,
  background: 'transparent',
  color: COLORS.accent,
  fontSize: 11,
  cursor: 'pointer',
}

/** 加载更多的界面状态：是否还能扩、是否已到窗口上限、进行中与失败原因。 */
export interface MoreState {
  readonly available: boolean
  readonly capped: boolean
  readonly loading: boolean
  readonly error: RpcErrorBody | null
  readonly onLoadMore: () => void
}

/**
 * 判断列表还能不能继续扩：覆盖全部、本地 Markdown 或已到窗口上限都不再请求。
 * @param snapshot - 当前快照；没有数据时为 null。
 * @returns 是否可扩与是否已达上限。
 */
export function moreStateOf(snapshot: WorkspaceSnapshot | null): {
  readonly available: boolean
  readonly capped: boolean
} {
  if (snapshot === null || snapshot.backend === 'markdown') {
    return { available: false, capped: false }
  }
  const incomplete = snapshot.loaded < snapshot.total
  return {
    available: incomplete && snapshot.windowLimit < SNAPSHOT_MAX_WINDOW,
    capped: incomplete && snapshot.windowLimit >= SNAPSHOT_MAX_WINDOW,
  }
}

/**
 * 列表底部：滚到底就自动扩一页；失败时原样保留列表，只给重试入口。
 * @param props - 加载更多状态与哨兵 ref。
 * @returns 哨兵节点。
 */
export function MoreFooter(props: {
  readonly state: MoreState
  readonly sentinel: React.RefObject<HTMLDivElement | null>
}): React.ReactElement {
  const { state } = props
  return (
    <div ref={props.sentinel} data-testid="load-more" style={MORE_STYLE}>
      {state.loading
        ? '正在加载更多…'
        : state.error === null
          ? '继续向下滚动加载更多'
          : `加载更多失败：${state.error.message}`}
      {state.error === null ? null : (
        <button
          type="button"
          data-testid="load-more-retry"
          onClick={state.onLoadMore}
          style={MORE_RETRY_STYLE}
        >
          重试
        </button>
      )}
    </div>
  )
}

/**
 * 底部哨兵进入视口时扩一页。
 *
 * 只观察、不轮询；环境没有 IntersectionObserver 时什么都不做（列表仍可用）。
 * @param active - 是否允许自动扩窗。
 * @param onVisible - 哨兵进入视口时的回调。
 * @returns 挂到哨兵节点上的 ref。
 */
export function useMoreSentinel(
  active: boolean,
  onVisible: () => void,
): React.RefObject<HTMLDivElement | null> {
  const node = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!active) return
    const target = node.current
    if (target === null || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onVisible()
    })
    observer.observe(target)
    return () => {
      observer.disconnect()
    }
  }, [active, onVisible])

  return node
}
