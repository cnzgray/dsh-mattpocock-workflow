/**
 * 任务面板的 RPC 契约与快照类型。只放类型和常量，不放逻辑。
 *
 * 请求统一为 `{ method, params }`，响应统一为 `{ ok: true, result }` 或
 * `{ ok: false, error: { code, message } }`。宿主在每张票上附带判定结果，
 * 界面只做展示层的统计、过滤和排序。
 */
import type { BackendKind } from './backend.ts'
import type { EnvCheckParams } from './env-check.ts'
import type { TicketActionReason, TicketSkillAction } from './labels.ts'

/** 插件私有的 HTTP 路由。宿主用 `connection.fetch.register` 挂载，界面用同源 fetch 调用。 */
export const RPC_PATH = '/api/dsh-mattpocock-workflow'

/**
 * 列表窗口一页的票数。三个远端后端首屏都只取这一页，
 * 列表滚到底时再向宿主扩一页；界面文案里的数字也从这里取。
 */
export const SNAPSHOT_PAGE_SIZE = 100

/**
 * 单个仓库的列表窗口上限。窗口涨到它以后不再请求，
 * 界面显示「已达上限」。界面与宿主共用这一个定义。
 */
export const SNAPSHOT_MAX_WINDOW = 2000

/** 当前版本提供的方法：读缓存、强制刷新、补齐阻塞信息、加载更多、环境检查与工单详情。 */
export const RPC_METHODS = {
  /** 读缓存；没有缓存时拉取一次。阻塞信息可能尚未定稿。 */
  snapshotGet: 'snapshot.get',
  /** 忽略缓存，强制拉取。 */
  snapshotRefresh: 'snapshot.refresh',
  /** 补齐原生阻塞信息；快照已定稿时直接返回缓存。同一工作区的进行中请求会复用。 */
  snapshotResolveBlockers: 'snapshot.resolveBlockers',
  /** 把列表窗口扩大一页，返回合并后的完整快照。同一工作区的进行中请求会复用。 */
  snapshotMore: 'snapshot.more',
  /** 读取本地快照库的信息；带确认词时可以清空它。 */
  snapshotCache: 'snapshot.cache',
  /** 重新跑一次环境检查；同一工作区的进行中请求会复用。 */
  envCheck: 'env.check',
  /** 读取单张工单详情；只在打开详情时请求，不进入列表快照。 */
  ticketGet: 'ticket.get',
  /** 应用一次工单变更；成功后界面重新读取详情并刷新列表快照。 */
  ticketUpdate: 'ticket.update',
  /** 读取仓库的标签与可分配用户，供详情里添加标签、分配人时补全。 */
  ticketOptions: 'ticket.options',
  /** 永久删除一张工单；必须带 `confirm: 'delete'`，宿主再按权限拒绝或执行。 */
  ticketDelete: 'ticket.delete',
} as const

/** 工单的开闭状态。 */
export type TicketState = 'open' | 'closed'

/** 分类标签，没有分类时为 null。 */
export type TicketCategory = 'bug' | 'enhancement' | null

/**
 * 工单创建人。与 core 的同名类型形状一致：protocol 是叶子，不引用 core。
 */
export interface TicketAuthor {
  /** 登录名：GitHub 是 login，GitLab 是 username，Gitea 是 login。 */
  readonly login: string
  /** 展示名；后端没给时为 null，界面退回 login。 */
  readonly displayName: string | null
  /** 远端头像地址；没有头像、或不是 http(s) 绝对地址时为 null。 */
  readonly avatarUrl: string | null
}

/**
 * 一张票的判定结果：
 * - `ready`：开放、无未关闭阻塞、带 `ready-for-agent`；
 * - `blocked`：开放且至少有一张未关闭的阻塞票；
 * - `closed`：已关闭；
 * - `open`：其余开放票。
 */
export type TicketStatus = 'ready' | 'blocked' | 'closed' | 'open'

/**
 * 压力维度：规模、阻塞、时效。三个维度各自判档，总档位取最重的一维，
 * 不合成加权总分——平均分会把一个已经爆掉的维度藏起来。
 */
export type PressureDimension = 'scale' | 'blocking' | 'freshness'

/** 压力档位，从轻到重。 */
export type PressureTier = 'light' | 'normal' | 'tight'

/** 指标不可用的原因。界面据此解释“不可用”，不用 0 冒充。 */
export type MetricGap =
  /** 后端不提供工单时间戳（本地 Markdown 的文件时间不算工单时间）。 */
  | 'no-timestamps'
  /** 后端不提供关闭时间，关闭速率与净流入无法计算。 */
  | 'no-closed-time'
  /** 后端不提供阻塞依赖边，最长阻塞链无法计算。 */
  | 'no-dependency-edges'

/** 一个指标的取值；value 为 null 时 gap 说明缺的是什么数据。 */
export interface MetricValue {
  readonly value: number | null
  readonly gap: MetricGap | null
}

/** 参与压力判档的指标。 */
export type PressureMetric = 'backlog' | 'netFlow' | 'blockedRatio' | 'staleRatio' | 'stalled'

/** 一个判档指标的取值。 */
export interface PressureSignal {
  readonly metric: PressureMetric
  readonly value: number
}

/** 一个维度的判档结果。 */
export interface PressureDimensionReport {
  readonly dimension: PressureDimension
  /** 判档结果；时间数据缺失导致该维度无法判档时为 null。 */
  readonly tier: PressureTier | null
  /** 参与这一维判档的指标取值。 */
  readonly signals: readonly PressureSignal[]
  /**
   * 与最终档位相同的指标，也就是触发这一档的事实；轻松档为空数组，
   * 表示所有可用指标都在轻松范围。
   */
  readonly triggers: readonly PressureMetric[]
  /** 这一维缺失的数据。 */
  readonly gaps: readonly MetricGap[]
  /** 阻塞信息还没定稿，这一维是暂估，补齐后会重算。 */
  readonly provisional: boolean
}

/** 三个维度的判档结果；`tier` 是其中最重的一档。 */
export interface PressureReport {
  readonly tier: PressureTier
  readonly dimensions: readonly PressureDimensionReport[]
}

/** 指标覆盖的样本范围。已加载数与总数直接复用快照字段，这里只记录是否被截断。 */
export interface MetricsCoverage {
  /** 总数大于已加载数：基于票集合的指标只覆盖样本，关闭类指标可能低估。 */
  readonly truncated: boolean
}

/** 关注清单条目的入选原因。 */
export type AttentionReason = 'untriaged-bug' | 'stale' | 'most-blocking' | 'oldest-stalled'

/** 关注清单里的一张票。 */
export interface AttentionItem {
  readonly ref: string
  readonly title: string
  readonly reason: AttentionReason
  /** 支撑数字：陈旧或停滞天数、未关闭阻塞数；不适用时为 null。 */
  readonly evidence: number | null
}

/**
 * 快照附带的项目指标与压力判档。所有比率都是 0–1 的小数；
 * 给不出数据的指标 `value` 为 null 并带 `gap`，不用 0 冒充。
 */
export interface SnapshotMetrics {
  /** 开放积压：开放票总数。 */
  readonly openBacklog: number
  /** 可接容量：可接票数。 */
  readonly readyCapacity: number
  /** 阻塞占比：阻塞票 ÷ 开放票；开放票为 0 时按 0 处理。 */
  readonly blockedRatio: number
  /** 待 triage：开放且没有分类标签的票数。 */
  readonly needsTriage: number
  /** 停滞票：状态为“其他开放”的票数。 */
  readonly stalled: number
  /** 陈旧票：创建超过 30 天的开放票数。 */
  readonly staleCount: MetricValue
  /** 陈旧率：陈旧票 ÷ 开放票。 */
  readonly staleRatio: MetricValue
  /** 最久未动天数：开放票里最大的（当前时间 − 更新时间）。 */
  readonly oldestUpdateDays: MetricValue
  /** 最长阻塞链深度：未关闭依赖链的最大层数；没有链时为 0。 */
  readonly longestBlockerChain: MetricValue
  /** 近 30 天新开：创建时间落在窗口内的票数。 */
  readonly openedLast30Days: MetricValue
  /** 近 30 天关闭：关闭时间落在窗口内的票数。 */
  readonly closedLast30Days: MetricValue
  /** 净流入：近 30 天新开 − 近 30 天关闭。 */
  readonly netFlow: MetricValue
  readonly coverage: MetricsCoverage
  readonly pressure: PressureReport
  /** 最该先看的票（最多 5 张），按固定优先级挑选；没有候选时为空。 */
  readonly attention: readonly AttentionItem[]
}

/** 快照里的一张票。 */
export interface TicketSnapshot {
  /**
   * 唯一、可直接展示并写进提示词的引用：GitHub / GitLab 是 `#15`，
   * 本地 Markdown 是相对工作区的文件路径。列表 key、选中态与注入文本都用它。
   */
  readonly ref: string
  /** 数字编号；本地 Markdown 没有编号，为 null。 */
  readonly number: number | null
  readonly title: string
  readonly state: TicketState
  readonly category: TicketCategory
  readonly status: TicketStatus
  /** 工单上的全部标签；界面用它显示分类之外的标签。 */
  readonly labels: readonly string[]
  /** 创建人；本地 Markdown 没有创建人，为 null。 */
  readonly author: TicketAuthor | null
  /** 该票对应的技能动作；`none` 表示不提供注入入口。判定在 core，界面只展示。 */
  readonly skillAction: TicketSkillAction
  /** 判定依据；界面用它渲染原因徽标和悬停说明。 */
  readonly skillActionReason: TicketActionReason
  readonly createdAt: string
  readonly updatedAt: string
  /** 未关闭的阻塞票数量；0 表示可以开工。 */
  readonly openBlockers: number
  /** 关闭时间；后端给不出时省略。本地 Markdown 没有。 */
  readonly closedAt?: string
  /** 远端网页地址；本地 Markdown 没有。界面点编号时复制它。 */
  readonly url?: string
  /**
   * 挡住这张票的引用集合，不论开闭。后端给不出阻塞依赖边时省略
   * （GitHub 列表查询只给未关闭阻塞数）；宿主用它算最长阻塞链。
   */
  readonly blockedBy?: readonly string[]
}

/** 一个工作区的工单快照。 */
export interface WorkspaceSnapshot {
  /** 本快照来自哪个后端。 */
  readonly backend: BackendKind
  /**
   * 后端相关的仓库显示名：GitHub 是 `owner/name`，GitLab 是含嵌套 group 的完整项目路径，
   * Gitea 是 `owner/name`，本地 Markdown 是工作区目录名。
   */
  readonly repository: string
  /**
   * 仓库所在实例的主机名：GitHub、GitLab、Gitea 是远端主机，本地 Markdown 为 null。
   * 同时使用多个 Gitea 实例时，界面靠它区分同名仓库。
   */
  readonly repositoryHost: string | null
  /** 快照生成时间（毫秒时间戳），界面用它显示“多久之前”。 */
  readonly fetchedAt: number
  /** 本次实际加载到的票数。 */
  readonly loaded: number
  /** 仓库里的票总数；大于 `loaded` 时列表不完整。 */
  readonly total: number
  /**
   * 列表窗口：按更新时间倒序实际覆盖的票数上限。扩窗后与 `loaded` 一起增长；
   * 达到 {@link SNAPSHOT_MAX_WINDOW} 后界面不再请求下一页。
   */
  readonly windowLimit: number
  readonly tickets: readonly TicketSnapshot[]
  /**
   * 项目指标与压力判档。宿主在列表返回时算一次，阻塞补齐完成后重算；
   * 界面只渲染，不重复判定。
   */
  readonly metrics: SnapshotMetrics
  /**
   * 阻塞信息是否已定稿。为 false 时部分票的 `openBlockers` 来自描述回退，
   * 界面应在首屏之后请求一次 {@link RPC_METHODS.snapshotResolveBlockers}。
   * 原生阻塞随列表返回、后端不支持原生阻塞、补齐完成或补齐失败后都为 true。
   */
  readonly blockersFinalized: boolean
  /**
   * 数据来源：实时拉取还是本地快照库。来自本地库时界面应标注出来，
   * 并在后台发起一次刷新把它推向最新。
   */
  readonly source: SnapshotSource
  /** 是否陈旧：数据来自本地库，或最近一次刷新失败。 */
  readonly stale: boolean
  /** 最近一次刷新失败的原因；没有失败时为 null。 */
  readonly refreshError: RpcErrorBody | null
}

/** 三个快照方法共用的参数。 */
export interface SnapshotParams {
  /** 当前工作区根目录，宿主用它解析 git 远端并缓存快照。 */
  readonly workspaceRoot: string
}

/** 刷新快照的参数。 */
export interface SnapshotRefreshParams extends SnapshotParams {
  /**
   * 为 true 时忽略本地快照库，重新全量拉一次。
   * 缺省时能用增量就增量，缓存不可信时由界面显式要求全量。
   */
  readonly full?: boolean
}

/**
 * 快照的数据来源。
 * - `live`：这次是刚从后端拉到的；
 * - `cache`：这次来自本地快照库，正在被刷新推向最新。
 */
export type SnapshotSource = 'live' | 'cache'

/** 读取或清空本地快照库的参数。 */
export interface SnapshotCacheParams {
  /** 当前工作区根目录。 */
  readonly workspaceRoot: string
  /** 为 true 时清空本地快照库；必须带确认词。 */
  readonly clear?: boolean
  /** 清空时的确认词。 */
  readonly confirm?: string
}

/** 本地快照库的信息。 */
export interface SnapshotCacheInfo {
  /** 缓存目录的位置，用符号形式给出，不含机器上的绝对路径。 */
  readonly location: string
  /** 当前缓存条目数。 */
  readonly entries: number
  /** 最近一次写入时间；没有条目时为 null。 */
  readonly lastWrittenAt: number | null
  /** 本次清掉的条目数；没有清空时为 0。 */
  readonly cleared: number
}

/** 清空本地快照库的确认词。与删除工单的确认词不同，避免手滑。 */
export const SNAPSHOT_CLEAR_CONFIRMATION = 'clear-cache'

/** 一条工单评论。本地 Markdown 的评论没有作者与时间，两项为 null。 */
export interface TicketComment {
  readonly author: string | null
  readonly body: string
  readonly createdAt: string | null
}

/**
 * 详情视图的控件能力位。false 表示该后端不提供这项能力，界面禁用对应控件
 * 并说明是哪个后端、缺哪项能力；宿主不返回空数据冒充成功。
 */
export interface DetailCapabilities {
  /** 能否增删标签。 */
  readonly labels: boolean
  /** 能否增删分配人（含「分配给我」）。 */
  readonly assignees: boolean
  /** 能否关闭 / 重开。 */
  readonly state: boolean
  /** 是否有远端链接地址（本地 Markdown 没有）。 */
  readonly link: boolean
  /**
   * 当前登录用户能否删除这张工单：后端实现了删除，且用户在该仓库有删除权限
   * （GitHub 仓库管理员、GitLab Owner 或实例管理员、Gitea 仓库管理员）。
   * 权限查询失败按没有权限处理。
   */
  readonly delete: boolean
}

/** 一张工单的完整详情。 */
export interface TicketDetail {
  /** 与列表里的 `TicketSnapshot.ref` 相同。 */
  readonly ref: string
  readonly number: number | null
  readonly title: string
  readonly state: TicketState
  /** 创建者的远端用户名；本地 Markdown 没有作者，为 null。 */
  readonly author: string | null
  /** 正文原文，保留原始 Markdown；界面渲染时不改写原文。 */
  readonly body: string
  readonly labels: readonly string[]
  /** 分配人的远端用户名。 */
  readonly assignees: readonly string[]
  readonly comments: readonly TicketComment[]
  /** 后端返回的原生链接地址；本地 Markdown 为 null。 */
  readonly url: string | null
  readonly createdAt: string
  readonly updatedAt: string
  /** 这张详情来自哪个后端；界面用它在禁用控件旁说明原因。 */
  readonly backend: BackendKind
  readonly capabilities: DetailCapabilities
}

/**
 * 变更补丁：表达属性的期望最终状态，不表达增删指令。
 * 字段省略表示不改这一项；`assignSelf` 与 `assignees` 同时给出时先取目标集合再加自己。
 */
export interface TicketPatch {
  readonly labels?: readonly string[] | undefined
  readonly assignees?: readonly string[] | undefined
  readonly assignSelf?: boolean | undefined
  readonly state?: TicketState | undefined
}

/** 详情读取与变更共用的参数。 */
export interface TicketDetailParams {
  readonly workspaceRoot: string
  /** 工单引用：远端后端是 `#15`，本地 Markdown 是相对工作区的文件路径。 */
  readonly ref: string
  /** 数字编号；本地 Markdown 为 null。 */
  readonly number: number | null
}

/** 工单变更的参数：定位一张票并给出补丁。 */
export interface TicketUpdateParams extends TicketDetailParams {
  readonly patch: TicketPatch
}

/** 变更成功的回执；新值由界面重新读取详情获得，不做乐观更新。 */
export interface TicketUpdateResult {
  readonly applied: true
}

/** 删除工单的参数：定位一张票，并带上用户输入的确认词。 */
export interface TicketDeleteParams extends TicketDetailParams {
  /** 必须是字面量 `delete`；界面要求用户手动输入这个词才发出请求。 */
  readonly confirm: typeof TICKET_DELETE_CONFIRMATION
}

/** 删除确认词：界面要求用户输入，宿主再校验一次。 */
export const TICKET_DELETE_CONFIRMATION = 'delete'

/** 删除成功的回执。 */
export interface TicketDeleteResult {
  readonly deleted: true
}

/** 仓库里的一个标签。 */
export interface LabelOption {
  readonly name: string
  /** `#rrggbb` 形式的标签颜色；后端没有颜色时为 null。 */
  readonly color: string | null
  readonly description: string | null
}

/** 仓库里一个可分配的用户。 */
export interface AssigneeOption {
  /** 远端用户名：GitHub login、GitLab / Gitea username。 */
  readonly username: string
  /** 显示名；后端不提供时为 null。 */
  readonly name: string | null
}

/** 详情里添加标签、分配人时的补全候选。 */
export interface TicketOptions {
  readonly labels: readonly LabelOption[]
  readonly assignees: readonly AssigneeOption[]
}

/** 方法名到参数类型的映射。 */
export interface RpcParamsMap {
  'snapshot.get': SnapshotParams
  'snapshot.refresh': SnapshotRefreshParams
  'snapshot.resolveBlockers': SnapshotParams
  'snapshot.more': SnapshotParams
  'snapshot.cache': SnapshotCacheParams
  'env.check': EnvCheckParams
  'ticket.get': TicketDetailParams
  'ticket.update': TicketUpdateParams
  'ticket.options': SnapshotParams
  'ticket.delete': TicketDeleteParams
}

/** 已支持的方法名。 */
export type RpcMethod = keyof RpcParamsMap

/** 一个 RPC 请求。 */
export interface RpcRequest<M extends RpcMethod = RpcMethod> {
  readonly method: M
  readonly params: RpcParamsMap[M]
}

/**
 * 错误码。工单读取的业务错误在前，其余是协议层错误。
 * 客户端按错误码给出可操作的提示（装 gh / glab / tea、登录、检查 `.scratch` 权限）。
 */
export const ERROR_CODES = {
  ghMissing: 'gh-missing',
  ghUnauthenticated: 'gh-unauthenticated',
  glabMissing: 'glab-missing',
  glabUnauthenticated: 'glab-unauthenticated',
  teaMissing: 'tea-missing',
  teaUnauthenticated: 'tea-unauthenticated',
  markdownReadFailed: 'markdown-read-failed',
  fetchFailed: 'fetch-failed',
  /** 编号不存在或工单已被删除。 */
  ticketNotFound: 'ticket-not-found',
  /** 当前后端不提供所请求的详情或写能力。 */
  capabilityUnsupported: 'capability-unsupported',
  invalidParams: 'invalid-params',
  unknownMethod: 'unknown-method',
  invalidRequest: 'invalid-request',
  internal: 'internal',
} as const

/** 错误码的联合类型。 */
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

/**
 * 环境问题错误码对应的后端。列表据此显示入口，环境检查据此定位失败项；
 * 新增后端只在这一张表里登记错误码到后端的对应关系。
 */
export const ERROR_BACKENDS: Readonly<
  Partial<Record<ErrorCode, Exclude<BackendKind, 'markdown'>>>
> = {
  [ERROR_CODES.ghMissing]: 'github',
  [ERROR_CODES.ghUnauthenticated]: 'github',
  [ERROR_CODES.glabMissing]: 'gitlab',
  [ERROR_CODES.glabUnauthenticated]: 'gitlab',
  [ERROR_CODES.teaMissing]: 'gitea',
  [ERROR_CODES.teaUnauthenticated]: 'gitea',
}

/**
 * 属于环境问题的快照错误码。列表视图据此在错误提示里给出「查看环境检查」入口：
 * 这几类失败都能在环境检查里定位到具体检查项。
 */
export const ENV_ISSUE_ERROR_CODES: readonly ErrorCode[] = Object.keys(
  ERROR_BACKENDS,
) as readonly ErrorCode[]

/** 失败的响应体。 */
export interface RpcErrorBody {
  readonly code: ErrorCode
  readonly message: string
}

/** RPC 响应：成功带 `result`，失败带 `error`。 */
export type RpcResult<T> =
  { readonly ok: true; readonly result: T } | { readonly ok: false; readonly error: RpcErrorBody }
