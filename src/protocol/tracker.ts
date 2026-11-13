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

/** 当前版本提供的方法：读缓存、强制刷新、补齐阻塞信息与环境检查。 */
export const RPC_METHODS = {
  /** 读缓存；没有缓存时拉取一次。阻塞信息可能尚未定稿。 */
  snapshotGet: 'snapshot.get',
  /** 忽略缓存，强制拉取。 */
  snapshotRefresh: 'snapshot.refresh',
  /** 补齐原生阻塞信息；快照已定稿时直接返回缓存。同一工作区的进行中请求会复用。 */
  snapshotResolveBlockers: 'snapshot.resolveBlockers',
  /** 重新跑一次环境检查；同一工作区的进行中请求会复用。 */
  envCheck: 'env.check',
} as const

/** 工单的开闭状态。 */
export type TicketState = 'open' | 'closed'

/** 分类标签，没有分类时为 null。 */
export type TicketCategory = 'bug' | 'enhancement' | null

/**
 * 一张票的判定结果：
 * - `ready`：开放、无未关闭阻塞、带 `ready-for-agent`；
 * - `blocked`：开放且至少有一张未关闭的阻塞票；
 * - `closed`：已关闭；
 * - `open`：其余开放票。
 */
export type TicketStatus = 'ready' | 'blocked' | 'closed' | 'open'

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
  /** 该票对应的技能动作；`none` 表示不提供注入入口。判定在 core，界面只展示。 */
  readonly skillAction: TicketSkillAction
  /** 判定依据；界面用它渲染原因徽标和悬停说明。 */
  readonly skillActionReason: TicketActionReason
  readonly createdAt: string
  readonly updatedAt: string
  /** 未关闭的阻塞票数量；0 表示可以开工。 */
  readonly openBlockers: number
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
  readonly tickets: readonly TicketSnapshot[]
  /**
   * 阻塞信息是否已定稿。为 false 时部分票的 `openBlockers` 来自描述回退，
   * 界面应在首屏之后请求一次 {@link RPC_METHODS.snapshotResolveBlockers}。
   * 原生阻塞随列表返回、后端不支持原生阻塞、补齐完成或补齐失败后都为 true。
   */
  readonly blockersFinalized: boolean
}

/** 三个快照方法共用的参数。 */
export interface SnapshotParams {
  /** 当前工作区根目录，宿主用它解析 git 远端并缓存快照。 */
  readonly workspaceRoot: string
}

/** 方法名到参数类型的映射。 */
export interface RpcParamsMap {
  'snapshot.get': SnapshotParams
  'snapshot.refresh': SnapshotParams
  'snapshot.resolveBlockers': SnapshotParams
  'env.check': EnvCheckParams
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
