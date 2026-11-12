/**
 * 工单模型与后端契约。core 不做 IO：这里只有类型和错误定义，
 * 具体命令由 adapters 通过注入的 {@link CommandRunner} 执行。
 */

/** 工单的开闭状态。 */
export type TicketState = 'open' | 'closed'

/** 一张工单的原始数据（判定之前）。 */
export interface Ticket {
  readonly number: number
  readonly title: string
  readonly state: TicketState
  readonly labels: readonly string[]
  readonly createdAt: string
  readonly updatedAt: string
  /** 未关闭的阻塞票数量；来源是 GitHub 原生 issue dependencies 的汇总。 */
  readonly openBlockers: number
}

/** 后端返回的一次拉取结果。 */
export interface TrackerSnapshot {
  /** `owner/name`。 */
  readonly repository: string
  readonly fetchedAt: number
  readonly loaded: number
  readonly total: number
  readonly tickets: readonly Ticket[]
}

/** 工单后端。MVP 只有 GitHub 实现，后续 markdown/gitlab 复用同一契约。 */
export interface Tracker {
  /** 读取一个工作区的工单快照；业务失败抛 {@link TrackerError}。 */
  fetchSnapshot(workspaceRoot: string): Promise<TrackerSnapshot>
}

/**
 * 执行一个命令并返回标准输出；失败时抛带错误码的 `CommandError`。
 * 注入函数而不是进程对象，adapter 的测试才能完全脱离子进程。
 */
export type CommandRunner = (
  command: string,
  args: readonly string[],
  options?: { readonly cwd?: string },
) => Promise<string>

/** 标签名集合，由宿主从 protocol 的常量传入，规则本身留在 core。 */
export interface TicketLabelNames {
  readonly readyForAgent: string
  readonly bug: string
  readonly enhancement: string
}
