/**
 * 工单模型与后端契约。core 不做 IO：这里只有类型和错误定义，
 * 具体命令由 adapters 通过注入的 {@link CommandRunner} 执行。
 */

/** 工单的开闭状态。 */
export type TicketState = 'open' | 'closed'

/**
 * 后端的父子关系能力：
 * - `native`：远端后端原生给出父子关系（GitHub 子工单、GitLab 工作项层级）；
 * - `convention`：按本地工单约定从文件内容解析（`Parent:` 行）；
 * - `none`：后端不提供父子关系，父子布局不可用。
 */
export type HierarchyKind = 'native' | 'convention' | 'none'

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
  /** 分配人的远端登录名；后端没有分配人概念时为空数组。 */
  readonly assignees: readonly string[]
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
  /** 远端网页地址（只收 http/https）；本地 Markdown 没有，后端给不出时也省略。 */
  readonly url?: string
  /**
   * 挡住这张票的引用集合（`Ticket.ref`），不论开闭。后端给不出依赖边时省略；
   * 引用不在已加载列表里时，链深度只按已知的未关闭票计算。
   *
   * 同仓库引用是 `#15`；跨仓库引用是 `owner/repo#15`（Gitea 的原生依赖可以指向
   * 另一个仓库的票）。跨仓库引用不会匹配当前列表里的同号票。
   */
  readonly blockedBy?: readonly string[]
  /**
   * 父级引用；没有父级或后端给不出父子关系时省略。
   *
   * 引用不保证指向当前列表里的票：可能是 GitHub 跨仓库父票（`owner/repo#15`）、
   * GitLab epic（`&3`），或本地 Markdown 里当前没读到的文件。界面只把能在
   * 当前列表里找到的引用画成父子树，其余只显示父级提示。
   */
  readonly parent?: string
}

/** 后端返回的一次拉取结果。 */
export interface TrackerSnapshot {
  /** 后端相关的仓库显示名：`owner/name`、含嵌套 group 的项目路径或工作区目录名。 */
  readonly repository: string
  readonly fetchedAt: number
  readonly loaded: number
  readonly total: number
  readonly tickets: readonly Ticket[]
  /** 当前登录用户的远端登录名；识别不出时为 null。 */
  readonly viewer: string | null
  /** 这次列表的父子关系来源；每个后端都必须显式给出。 */
  readonly hierarchy: HierarchyKind
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
   * 这次增量的父子关系来源。与本地快照库不一致时宿主退回全量重拉：
   * 例如上次拿到 GitLab 原生层级，这次层级查询失败降级为 `none`。
   */
  readonly hierarchy: HierarchyKind
  /**
   * 是否被后端上限截断。为 true 时宿主改用全量重拉，
   * 不把一份不完整的增量当成完整结果。
   */
  readonly truncated: boolean
  /**
   * 增量刷新时顺带刷新的当前登录用户；省略表示这次没查，沿用上一次。
   * 查询失败时省略；查询成功但没有身份时为 null。
   */
  readonly viewer?: string | null
  /**
   * 同一过滤条件下的权威总数：与全量列表口径一致，不受增量时间窗影响。
   *
   * 宿主把它与合并结果对账：合并后票数超过它，说明缓存里有远端已删除的票，
   * 当次退回全量重拉。实现 `fetchChanges` 的后端必须给出这个数，
   * 不能用「带窗口的查询自己的 X-Total-Count」或上次的总数凑数。
   */
  readonly total: number
}

/**
 * 工单引用：`ref` 与 {@link Ticket.ref} 相同，`number` 为 null 表示本地 Markdown。
 * 阻塞补齐、详情读取与变更提交都用它把结果对回同一张票。
 *
 * 打开跨仓库详情时 `repository` 是目标仓库的 `owner/name`；省略表示当前工作区仓库。
 * 该形态只由 Gitea 实现，其余后端遇到仓库段返回不支持。
 */
export interface TicketReference {
  readonly ref: string
  readonly number: number | null
  readonly repository?: string
}

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
  /**
   * 正文与评论里根相对 `/uploads/` 附件地址的补全前缀（含结尾 `/uploads/`）。
   * GitLab 的附件在正文里是 `/uploads/<secret>/<filename>`，网页端补成
   * `<实例源>/-/project/<id>/uploads/...`；其他后端为 null。
   */
  readonly uploadsBaseUrl: string | null
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
  /**
   * 读取一个工作区的工单快照；业务失败抛 {@link TrackerError}。
   *
   * 列表、扩窗与全量刷新共用这一份排序与窗口口径：窗口为 N 的结果必须等价于
   * 「按更新时间倒序取前 N 张」，不出现重复引用。不实现翻页的后端忽略窗口。
   * @param workspaceRoot - 工作区根目录。
   * @param windowLimit - 要覆盖的票数上限；省略时由后端决定（通常是首屏一页）。
   */
  fetchSnapshot(workspaceRoot: string, windowLimit?: number): Promise<TrackerSnapshot>
  /**
   * 可选能力：读取某时刻之后变更过的工单。
   *
   * 不实现该能力的后端由宿主退回全量刷新。实现的后端必须与列表查询使用
   * 同一套过滤条件（状态、类型等），只在时间窗口上不同；窗口起点是
   * 「上次成功拉取的时刻」向前重叠一小段，重叠部分按工单引用去重。
   *
   * 增量看不见远端删除，宿主只能拿 {@link TrackerChanges.total} 对账，
   * 因此实现者必须同时给出一份权威总数；给不出总数的后端不要实现这个能力。
   * 列表带 `windowLimit` 的后端（如 GitHub）只在「上次拉取已覆盖全仓」时才会被
   * 宿主调用：覆盖全仓的基准里窗口外没有票，删除总能被总数对账发现。
   * @param workspaceRoot - 工作区根目录。
   * @param since - 毫秒时间戳；后端按「更新时间在此刻之后」过滤。
   * @returns 变更过的工单、是否被上限截断与权威总数。
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
  /**
   * 可选能力：取回工单正文 / 评论里内联的后端上传图片。
   *
   * `path` 是正文里的根相对附件地址（GitLab 为 `/uploads/<secret>/<filename>`）；
   * 适配器只按当前工作区的项目推导抓取目标，不信任正文里的主机。取不到、不是图片或
   * 超过大小上限时抛 {@link TrackerError}。
   */
  fetchAttachment?: (workspaceRoot: string, path: string) => Promise<TicketAttachment>
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
  options?: CommandOptions,
) => Promise<CommandOutput>

/** 一次命令的执行选项。 */
export interface CommandOptions {
  readonly cwd?: string
  /**
   * 标准输出的交付形式。默认 `text`；`base64` 用于二进制响应（如图片附件）：
   * 子进程服务只交付 UTF-8 文本，原始字节会被解码坏，所以由执行器把输出转成 base64 再收集。
   */
  readonly stdout?: 'text' | 'base64'
}

/** 后端附件的原始字节，按 base64 交付；只用于图片内联显示。 */
export interface TicketAttachment {
  /** 按文件头识别出的图片类型，例如 `image/png`。 */
  readonly mediaType: string
  /** 图片字节的 base64，不含换行。 */
  readonly base64: string
}

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
