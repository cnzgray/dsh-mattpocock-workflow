/**
 * 工单模型与后端契约。core 不做 IO：这里只有类型和错误定义，
 * 具体命令由 adapters 通过注入的 {@link CommandRunner} 执行。
 */

/** 工单的开闭状态。 */
export type TicketState = 'open' | 'closed'

/**
 * 工单创建人。core 与 protocol 各自声明同形状的类型：core 保持纯逻辑，
 * protocol 保持叶子，两者都不跨目录引用。
 */
export interface TicketAuthor {
  /** 登录名：GitHub 是 login，GitLab 是 username，Gitea 是 login。 */
  readonly login: string
  /** 展示名；后端没给时为 null，界面退回 login。 */
  readonly displayName: string | null
  /** 远端头像地址；没有头像、或不是 http(s) 绝对地址时为 null。 */
  readonly avatarUrl: string | null
}

/** 一张工单的原始数据（判定之前）。 */
export interface Ticket {
  /** 唯一引用：远端后端是 `#15`，本地 Markdown 是相对工作区的文件路径。 */
  readonly ref: string
  /** 数字编号；本地 Markdown 没有编号，为 null。 */
  readonly number: number | null
  readonly title: string
  readonly state: TicketState
  readonly labels: readonly string[]
  /** 创建人；本地 Markdown 没有创建人，为 null。 */
  readonly author: TicketAuthor | null
  readonly createdAt: string
  readonly updatedAt: string
  /**
   * 未关闭的阻塞票数量。来源由后端决定：GitHub 的 issue dependencies、
   * GitLab 的原生 blocking link（实例不支持时退回 `Blocked by:` 行）、
   * Gitea 的 issue 依赖、本地 Markdown 的 `Blocked by:` 行。
   */
  readonly openBlockers: number
  /** 关闭时间；后端给不出时省略。本地 Markdown 没有。 */
  readonly closedAt?: string
  /**
   * 挡住这张票的引用集合（`Ticket.ref`），不论开闭。后端给不出依赖边时省略；
   * 引用不在已加载列表里时，链深度只按已知的未关闭票计算。
   */
  readonly blockedBy?: readonly string[]
}

/** 后端返回的一次拉取结果。 */
export interface TrackerSnapshot {
  /** 后端相关的仓库显示名：`owner/name`、含嵌套 group 的项目路径或工作区目录名。 */
  readonly repository: string
  readonly fetchedAt: number
  readonly loaded: number
  readonly total: number
  readonly tickets: readonly Ticket[]
  /**
   * 列表覆盖的上限：只覆盖最近更新的 N 张票（GitHub 的单页上限）。
   * 缺省表示覆盖全部。宿主合并增量时按它裁剪，使结果与全量重拉一致。
   */
  readonly windowLimit?: number
}

/** 一次增量拉取的结果。 */
export interface TrackerChanges {
  /** 变更过的工单：更新时间落在增量窗口内。 */
  readonly tickets: readonly Ticket[]
  /**
   * 是否被后端上限截断。为 true 时宿主改用全量重拉，
   * 不把一份不完整的增量当成完整结果。
   */
  readonly truncated: boolean
  /** 变更查询返回的仓库总票数；给出时用它更新总数，没有则沿用上次的。 */
  readonly total?: number
}

/**
 * 工单引用：`ref` 与 {@link Ticket.ref} 相同，`number` 为 null 表示本地 Markdown。
 * 阻塞补齐、详情读取与变更提交都用它把结果对回同一张票。
 */
export type TicketReference = Pick<Ticket, 'ref' | 'number'>

/** 一条工单评论。本地 Markdown 的评论没有作者与时间，两项为 null。 */
export interface TicketComment {
  readonly author: string | null
  readonly body: string
  readonly createdAt: string | null
}

/** 一张工单的完整详情。写能力不在这里：宿主按后端是否实现变更能力附加。 */
export interface TicketDetail {
  /** 与列表里的 {@link Ticket.ref} 相同，界面用它把详情对回选中的票。 */
  readonly ref: string
  readonly number: number | null
  readonly title: string
  readonly state: TicketState
  /** 创建者的远端用户名；本地 Markdown 没有作者，为 null。 */
  readonly author: string | null
  /** 正文原文，保留原始 Markdown，不做二次渲染。 */
  readonly body: string
  readonly labels: readonly string[]
  /** 分配人的远端用户名：GitHub login / GitLab、Gitea username。 */
  readonly assignees: readonly string[]
  readonly comments: readonly TicketComment[]
  /** 后端返回的原生链接；本地 Markdown 没有链接地址，为 null。 */
  readonly url: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * 变更补丁：表达属性的期望最终状态，不表达「加一个 / 删一个」的指令。
 *
 * 各后端的 CLI 语义不一致（增量、整体替换、带前缀的增删），补丁只给目标集合，
 * 语义差异全部收敛在适配器一层。字段省略表示不改这一项。
 */
export interface TicketPatch {
  /** 期望的标签集合。 */
  readonly labels?: readonly string[] | undefined
  /** 期望的分配人集合（远端用户名）。 */
  readonly assignees?: readonly string[] | undefined
  /** 把当前登录用户并入分配人集合；用户名由适配器按后端解析。 */
  readonly assignSelf?: boolean | undefined
  /** 期望的开闭状态。 */
  readonly state?: TicketState | undefined
}

/** 仓库里的一个标签；颜色统一为 `#rrggbb`，没有颜色时为 null。 */
export interface LabelOption {
  readonly name: string
  readonly color: string | null
  readonly description: string | null
}

/** 仓库里一个可分配的用户。 */
export interface AssigneeOption {
  readonly username: string
  readonly name: string | null
}

/** 添加标签、分配人时的补全候选。 */
export interface TicketOptions {
  readonly labels: readonly LabelOption[]
  readonly assignees: readonly AssigneeOption[]
}

/** 工单后端。GitHub / GitLab / Gitea / 本地 Markdown 都实现同一契约。 */
export interface Tracker {
  /** 读取一个工作区的工单快照；业务失败抛 {@link TrackerError}。 */
  fetchSnapshot(workspaceRoot: string): Promise<TrackerSnapshot>
  /**
   * 可选能力：读取某时刻之后变更过的工单。
   *
   * 不实现该能力的后端由宿主退回全量刷新。实现的后端必须与列表查询使用
   * 同一套过滤条件（状态、类型等），只在时间窗口上不同；窗口起点是
   * 「上次成功拉取的时刻」向前重叠一小段，重叠部分按工单引用去重。
   * @param workspaceRoot - 工作区根目录。
   * @param since - 毫秒时间戳；后端按「更新时间在此刻之后」过滤。
   * @returns 变更过的工单与是否被上限截断。
   */
  fetchChanges?: (workspaceRoot: string, since: number) => Promise<TrackerChanges>
  /**
   * 可选能力：读取开放票的未关闭原生阻塞数与阻塞引用。
   *
   * 列表阶段只能拿到描述回退结果；实现该能力的后端在首屏之后补齐原生计数，
   * 返回未关闭阻塞数与全部阻塞票引用。没有原生数据的票可以不出现在结果里，宿主会保留
   * 描述回退值。不实现该能力的后端视为阻塞信息已定稿；业务失败时抛
   * {@link TrackerError}，宿主会保留阶段一结果。
   */
  resolveBlockers?: (
    workspaceRoot: string,
    tickets: readonly TicketReference[],
  ) => Promise<BlockerResolution>
  /**
   * 可选能力：读取单张工单的详情（正文、评论、标签、分配人、链接与时间）。
   * 不实现该能力的后端没有「工单详情」；业务失败抛 {@link TrackerError}。
   */
  fetchDetail?: (workspaceRoot: string, reference: TicketReference) => Promise<TicketDetail>
  /**
   * 可选能力：应用一次变更补丁（标签、分配人、开闭状态）。
   *
   * 补丁表达目标集合；适配器按各自 CLI 的语义落地，成功后不返回新值——
   * 界面会重新读取详情，确认后端真的接受了这次变更。不实现该能力的后端
   * 没有任何写操作；业务失败抛 {@link TrackerError}。
   */
  updateTicket?: (
    workspaceRoot: string,
    reference: TicketReference,
    patch: TicketPatch,
  ) => Promise<void>
  /**
   * 可选能力：读取仓库的标签（含颜色）与可分配用户，供补全使用。
   * 不实现该能力的后端没有补全；业务失败抛 {@link TrackerError}。
   */
  fetchOptions?: (workspaceRoot: string) => Promise<TicketOptions>
  /**
   * 可选能力：当前登录用户能否删除这个仓库的工单。与 {@link Tracker.deleteTicket} 成对实现；
   * 宿主在读取详情时并行调用，失败按没有权限处理。
   */
  canDeleteTickets?: (workspaceRoot: string) => Promise<boolean>
  /**
   * 可选能力：永久删除一张工单。不可撤销；宿主只在请求带确认词时调用。
   * 业务失败（含没有权限）抛 {@link TrackerError}。
   */
  deleteTicket?: (workspaceRoot: string, reference: TicketReference) => Promise<void>
}

/**
 * 原生阻塞补齐的结果。`open` 只带未关闭阻塞数，`blockedBy` 带全部阻塞票引用
 * （不论开闭，宿主用它算链深度）。没有原生数据的票可以不出现在结果里，
 * 宿主会保留列表阶段的描述回退值。
 */
export interface BlockerResolution {
  readonly open: ReadonlyMap<string, number>
  readonly blockedBy: ReadonlyMap<string, readonly string[]>
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
