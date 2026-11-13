/**
 * 工单模型与后端契约。core 不做 IO：这里只有类型和错误定义，
 * 具体命令由 adapters 通过注入的 {@link CommandRunner} 执行。
 */

/** 工单的开闭状态。 */
export type TicketState = 'open' | 'closed'

/** 一张工单的原始数据（判定之前）。 */
export interface Ticket {
  /** 唯一引用：远端后端是 `#15`，本地 Markdown 是相对工作区的文件路径。 */
  readonly ref: string
  /** 数字编号；本地 Markdown 没有编号，为 null。 */
  readonly number: number | null
  readonly title: string
  readonly state: TicketState
  readonly labels: readonly string[]
  readonly createdAt: string
  readonly updatedAt: string
  /**
   * 未关闭的阻塞票数量。来源由后端决定：GitHub 的 issue dependencies、
   * GitLab 的原生 blocking link（实例不支持时退回 `Blocked by:` 行）、
   * Gitea 的 issue 依赖、本地 Markdown 的 `Blocked by:` 行。
   */
  readonly openBlockers: number
}

/** 后端返回的一次拉取结果。 */
export interface TrackerSnapshot {
  /** 后端相关的仓库显示名：`owner/name`、含嵌套 group 的项目路径或工作区目录名。 */
  readonly repository: string
  readonly fetchedAt: number
  readonly loaded: number
  readonly total: number
  readonly tickets: readonly Ticket[]
}

/**
 * 需要补齐原生阻塞信息的票。`ref` 与 {@link Ticket.ref} 相同，用于把补齐结果
 * 对回快照；`number` 为 null 的票（本地 Markdown）没有原生链接。
 */
export type BlockerTarget = Pick<Ticket, 'ref' | 'number'>

/** 工单后端。GitHub / GitLab / 本地 Markdown 都实现同一契约。 */
export interface Tracker {
  /** 读取一个工作区的工单快照；业务失败抛 {@link TrackerError}。 */
  fetchSnapshot(workspaceRoot: string): Promise<TrackerSnapshot>
  /**
   * 可选能力：读取开放票的未关闭原生阻塞数。
   *
   * 列表阶段只能拿到描述回退结果；实现该能力的后端在首屏之后补齐原生计数，
   * 返回 `ref → 未关闭阻塞数`。没有原生数据的票可以不出现在结果里，宿主会保留
   * 描述回退值。不实现该能力的后端视为阻塞信息已定稿；业务失败时抛
   * {@link TrackerError}，宿主会保留阶段一结果。
   */
  resolveBlockers?: (
    workspaceRoot: string,
    tickets: readonly BlockerTarget[],
  ) => Promise<ReadonlyMap<string, number>>
}

/** 一次命令的标准输出与标准错误。 */
export interface CommandOutput {
  readonly stdout: string
  readonly stderr: string
  /**
   * 实际执行的可执行文件路径。DSH 子进程服务解析后得到，环境检查用它显示
   * 找到了哪个 `gh` / `glab`；注入的假 runner 可以省略。
   */
  readonly executable?: string
}

/**
 * 执行一个命令；失败时抛带错误码的 `CommandError`。
 * 成功时同时返回标准输出与标准错误：`glab auth status` 的报告写在标准错误上。
 * 注入函数而不是进程对象，adapter 的测试才能完全脱离子进程。
 */
export type CommandRunner = (
  command: string,
  args: readonly string[],
  options?: { readonly cwd?: string },
) => Promise<CommandOutput>

/** 标签名集合，由宿主从 protocol 的常量传入，规则本身留在 core。 */
export interface TicketLabelNames {
  readonly readyForAgent: string
  readonly needsTriage: string
  readonly needsInfo: string
  readonly readyForHuman: string
  readonly wontfix: string
  readonly bug: string
  readonly enhancement: string
}
