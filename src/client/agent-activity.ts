/**
 * agent 侧的活动信号：会话里的这一轮跑完、面板该重新看一次工单时，把信号加一。
 *
 * 面板常驻右栏，agent 建票、triage、改状态都走跟踪器自己的命令行，宿主不会通知面板；
 * 唯一现成的同步点是会话列表里的两件事——这一轮在不在跑、最近一次持久活动是什么时候。
 * 面板只读这两个字段，不去猜 agent 跑了哪条命令：命令失败、只读查看都照样可能动过数据，
 * 拉回来再按数据有没有变决定要不要更新界面。
 */
import * as React from 'react'

/** 会话列表里本插件读到的字段。 */
export interface SessionRowLike {
  /** 会话的工作目录；面板按它选后端与缓存。 */
  readonly cwd?: string | undefined
  /** 宿主报告的这一轮是否在跑；缺省按空闲处理。 */
  readonly running?: boolean | undefined
  /** 最近的持久活动时间（毫秒）；缺省时只靠运行状态判断。 */
  readonly updatedAt?: number | undefined
}

/** 会话列表的只读视图。 */
export interface SessionListLike {
  readonly byId: Record<string, SessionRowLike | undefined>
}

/** 宿主给的会话列表选择器。 */
export type UseSessionsLike = <T>(selector: (state: SessionListLike) => T) => T | undefined

/** 一轮结束后等这么久再刷新：把同一轮里的连续写入合并成一次。 */
export const ACTIVITY_SETTLE_MS = 1_000

/**
 * 会话的活动摘要，用来判断「这一轮停下来了没有、之后有没有新活动」。
 * @param row - 会话列表里的一行。
 * @returns `运行中:最近活动`；没有这一行时是 null。
 */
export function activityToken(row: SessionRowLike | undefined): string | null {
  if (row === undefined) return null
  const running = row.running === true ? '1' : '0'
  const updated = typeof row.updatedAt === 'number' ? String(row.updatedAt) : ''
  return `${running}:${updated}`
}

/**
 * 摘要里的这一轮是否还在跑。
 * @param token - `activityToken` 的返回值。
 * @returns 在跑时为 true。
 */
export function tokenIsRunning(token: string): boolean {
  return token.startsWith('1:')
}

/**
 * 把会话活动变成刷新信号。
 *
 * 挂载时先记下现状，不补一次刷新（首屏加载已经负责取数）；
 * 之后每有一次活动更新、且这一轮已经停下，就在安静 `ACTIVITY_SETTLE_MS` 之后把信号加一。
 * 还在跑的时候不动：一轮里的写入可能没结束，等它停下再拉。
 * @param useSessions - 宿主给的会话列表选择器。
 * @param sessionId - 面板所在会话；没有会话时不发信号。
 * @returns 单调递增的刷新信号，初始为 0。
 */
export function useAgentActivitySignal(
  useSessions: UseSessionsLike,
  sessionId: string | undefined,
): number {
  const token = useSessions((state) =>
    activityToken(sessionId === undefined ? undefined : state.byId[sessionId]),
  )
  const current = token ?? null
  const [signal, setSignal] = React.useState(0)
  const seen = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (current === null) return
    if (seen.current === current) return
    const first = seen.current === null
    seen.current = current
    if (first) return
    if (tokenIsRunning(current)) return

    const timer = setTimeout(() => {
      setSignal((value) => value + 1)
    }, ACTIVITY_SETTLE_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [current])

  return signal
}
