/**
 * 两个视图共用的快照请求：首屏只等列表，阻塞信息由后台补齐。
 * 列表与概览都要在两阶段之间保持可用，这里只实现一次。
 *
 * 数据来自本地快照库时先把缓存显示出来，再自动发起一次增量刷新；
 * 刷新失败保留已有数据，只把失败原因记在状态里，不把整屏切成错误页。
 */
import * as React from 'react'

import type { RpcErrorBody, WorkspaceSnapshot } from '../protocol/tracker.ts'
import type { PanelClient } from './rpc.ts'

/** 请求阶段。 */
export type SnapshotPhase = 'loading' | 'ready' | 'refreshing' | 'error'

export interface SnapshotRequestState {
  readonly snapshot: WorkspaceSnapshot | null
  /** 整体错误：连一份数据都没有时才出现。 */
  readonly error: RpcErrorBody | null
  /** 最近一次刷新失败的原因；有数据时用它提示，列表本身照常显示。 */
  readonly refreshError: RpcErrorBody | null
  readonly phase: SnapshotPhase
  /** 增量刷新：能只拉变化就只拉变化。 */
  readonly refresh: () => void
  /** 全量刷新：忽略本地快照库重拉一次。 */
  readonly refreshFull: () => void
}

/** 请求方式：读缓存、增量刷新、全量刷新。 */
type RequestMode = 'get' | 'refresh' | 'refresh-full'

/**
 * 快照旁边要显示的失败原因。
 * 客户端刚失败的原因优先，其次是宿主记在快照里的原因；两者都没有但数据陈旧时，
 * 说明数据不是最新的。
 * @param snapshot - 当前快照；没有数据时为 null。
 * @param refreshError - 客户端最近一次刷新失败的原因。
 * @returns 要显示的原因文案；没有原因时为 null。
 */
export function snapshotRefreshNotice(
  snapshot: WorkspaceSnapshot | null,
  refreshError: RpcErrorBody | null,
): string | null {
  if (refreshError !== null) return refreshError.message
  const hostMessage = snapshot?.refreshError?.message
  if (hostMessage !== undefined) return hostMessage
  if (snapshot?.stale === true) return '数据可能不是最新的'
  return null
}

/** 一次请求的结果：已应用的数据，或失败时的 null。 */
interface Loader {
  readonly snapshot: WorkspaceSnapshot | null
  readonly error: RpcErrorBody | null
  readonly refreshError: RpcErrorBody | null
  readonly phase: SnapshotPhase
  readonly load: (mode: RequestMode) => Promise<WorkspaceSnapshot | null>
}

/**
 * 读取一个工作区的快照，并在首屏之后补齐阻塞信息。
 * @param client - 面板客户端。
 * @param workspaceRoot - 当前工作区；没有工作区时直接进入错误态。
 * @returns 快照、错误、阶段与两个刷新入口。
 */
export function useSnapshotRequest(
  client: PanelClient,
  workspaceRoot: string | undefined,
): SnapshotRequestState {
  const { snapshot, error, refreshError, phase, load } = useSnapshotLoader(client, workspaceRoot)
  // 一轮缓存只自动刷新一次：刷新失败时不再反复打宿主。
  const autoRefreshed = React.useRef(false)

  const run = React.useCallback(
    async (mode: RequestMode): Promise<void> => {
      const applied = await load(mode)
      if (applied === null) return
      if (applied.source === 'live') {
        autoRefreshed.current = false
        return
      }
      // 来自本地快照库：数据已经显示出来，再自动刷新一次让它收敛到最新。
      if (autoRefreshed.current) return
      autoRefreshed.current = true
      const refreshed = await load('refresh')
      if (refreshed !== null && refreshed.source === 'live') autoRefreshed.current = false
    },
    [load],
  )

  React.useEffect(() => {
    autoRefreshed.current = false
    void run('get')
  }, [run])

  const refresh = React.useCallback(() => {
    if (phase === 'loading' || phase === 'refreshing') return
    void run('refresh')
  }, [phase, run])

  const refreshFull = React.useCallback(() => {
    if (phase === 'loading' || phase === 'refreshing') return
    void run('refresh-full')
  }, [phase, run])

  return { snapshot, error, refreshError, phase, refresh, refreshFull }
}

/**
 * 快照的读取与落地：一次请求、一次落地，失败时按有没有旧数据决定去留。
 * @param client - 面板客户端。
 * @param workspaceRoot - 当前工作区。
 * @returns 当前状态与发起请求的入口。
 */
function useSnapshotLoader(client: PanelClient, workspaceRoot: string | undefined): Loader {
  const [snapshot, setSnapshot] = React.useState<WorkspaceSnapshot | null>(null)
  const [error, setError] = React.useState<RpcErrorBody | null>(null)
  const [refreshError, setRefreshError] = React.useState<RpcErrorBody | null>(null)
  const [phase, setPhase] = React.useState<SnapshotPhase>('loading')
  const sequence = React.useRef(0)
  // 已经拿到过数据：刷新失败时要靠它决定是保留列表还是切错误页。
  const hasData = React.useRef(false)

  const load = React.useCallback(
    async (mode: RequestMode): Promise<WorkspaceSnapshot | null> => {
      const current = sequence.current + 1
      sequence.current = current

      if (workspaceRoot === undefined) {
        setSnapshot(null)
        hasData.current = false
        setError({ code: 'invalid-params', message: '当前会话没有工作区目录，无法读取工单。' })
        setPhase('error')
        return null
      }

      setPhase(mode === 'get' ? 'loading' : 'refreshing')
      setError(null)
      const result =
        mode === 'get'
          ? await client.get(workspaceRoot)
          : await client.refresh(workspaceRoot, { full: mode === 'refresh-full' })
      if (current !== sequence.current) return null

      if (!result.ok) {
        // 刷新失败时保留已有数据：不清空列表、不切错误页，只把原因记下来。
        if (mode === 'get' || !hasData.current) {
          setError(result.error)
          setPhase('error')
          return null
        }
        setRefreshError(result.error)
        setPhase('ready')
        return null
      }

      // 首屏只等列表：阻塞数先按描述回退显示，补齐结果到了再原子替换。
      setSnapshot(result.result)
      hasData.current = true
      setError(null)
      setRefreshError(null)
      setPhase('ready')
      let applied = result.result

      if (!applied.blockersFinalized) {
        const finalized = await client.resolveBlockers(workspaceRoot)
        // 刷新会推进序号；旧补齐结果不能覆盖新列表。
        if (current !== sequence.current) return null
        // 补齐失败保留首屏结果：列表已经可用，不弹错误横幅。
        if (finalized.ok) {
          setSnapshot(finalized.result)
          applied = finalized.result
        }
      }

      return applied
    },
    [client, workspaceRoot],
  )

  // 换工作区时清掉上一份数据，不让旧仓库的票留在新仓库的列表里。
  React.useEffect(() => {
    setSnapshot(null)
    setError(null)
    setRefreshError(null)
    hasData.current = false
  }, [workspaceRoot])

  return { snapshot, error, refreshError, phase, load }
}
