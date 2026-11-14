/**
 * 列表视图的测试外壳：真实的面板把快照状态当属性传下来，视图自己不再取数。
 * 用例仍然用假客户端驱动首屏、补齐与刷新，只是这份状态由真实的请求 hook 在这里造出来。
 */
import * as React from 'react'

import type { PanelClient } from './rpc.ts'
import { useSnapshotRequest } from './snapshot-request.ts'
import { TicketsView, type TicketsViewProps } from './tickets-view.tsx'

/** `TicketsView` 的依赖，外加造状态用的客户端与 agent 活动信号。 */
export type TicketsViewHarnessProps = Omit<TicketsViewProps, 'request'> & {
  readonly client: PanelClient
  readonly refreshSignal?: number | undefined
}

/**
 * 带快照状态的列表视图。
 * @param props - 视图依赖、假客户端与活动信号。
 * @returns 列表视图。
 */
export function TicketsViewWithRequest(props: TicketsViewHarnessProps): React.ReactElement {
  const { client, refreshSignal, ...view } = props
  const request = useSnapshotRequest(client, props.workspaceRoot, { signal: refreshSignal })
  return <TicketsView {...view} request={request} />
}
