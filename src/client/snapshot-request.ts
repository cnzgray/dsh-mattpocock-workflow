/**
 * 两个视图共用的快照请求：首屏只等列表，阻塞信息由后台补齐。
 * 列表与概览都要在两阶段之间保持可用，这里只实现一次。
 */
import * as React from 'react'

import type { RpcErrorBody, WorkspaceSnapshot } from '../protocol/tracker.ts'
import type { PanelClient } from './rpc.ts'

/** 请求阶段。 */
export type SnapshotPhase = 'loading' | 'ready' | 'refreshing' | 'error'

export interface SnapshotRequestState {
  readonly snapshot: WorkspaceSnapshot | null
  readonly error: RpcErrorBody | null
  readonly phase: SnapshotPhase
  readonly refresh: () => void
}

/**
 * 读取一个工作区的快照，并在首屏之后补齐阻塞信息。
 * @param client - 面板客户端。
 * @param workspaceRoot - 当前工作区；没有工作区时直接进入错误态。
 * @returns 快照、错误、阶段与刷新入口。
 */
export function useSnapshotRequest(
  client: PanelClient,
  workspaceRoot: string | undefined,
): SnapshotRequestState {
  const [snapshot, setSnapshot] = React.useState<WorkspaceSnapshot | null>(null)
  const [error, setError] = React.useState<RpcErrorBody | null>(null)
  const [phase, setPhase] = React.useState<SnapshotPhase>('loading')
  const sequence = React.useRef(0)

  const request = React.useCallback(
    async (mode: 'get' | 'refresh'): Promise<void> => {
      const current = sequence.current + 1
      sequence.current = current

      if (workspaceRoot === undefined) {
        setSnapshot(null)
        setError({ code: 'invalid-params', message: '当前会话没有工作区目录，无法读取工单。' })
        setPhase('error')
        return
      }

      setPhase(mode === 'refresh' ? 'refreshing' : 'loading')
      setError(null)
      const result =
        mode === 'refresh' ? await client.refresh(workspaceRoot) : await client.get(workspaceRoot)
      if (current !== sequence.current) return

      if (!result.ok) {
        setError(result.error)
        setPhase('error')
        return
      }

      // 首屏只等列表：阻塞数先按描述回退显示，补齐结果到了再原子替换。
      setSnapshot(result.result)
      setError(null)
      setPhase('ready')
      if (result.result.blockersFinalized) return

      const finalized = await client.resolveBlockers(workspaceRoot)
      // 刷新会推进序号；旧补齐结果不能覆盖新列表。
      if (current !== sequence.current) return
      // 补齐失败保留首屏结果：列表已经可用，不弹错误横幅。
      if (finalized.ok) setSnapshot(finalized.result)
    },
    [client, workspaceRoot],
  )

  React.useEffect(() => {
    setSnapshot(null)
    setError(null)
    void request('get')
  }, [request])

  const refresh = React.useCallback(() => {
    if (phase === 'loading' || phase === 'refreshing') return
    void request('refresh')
  }, [phase, request])

  return { snapshot, error, phase, refresh }
}
