/**
 * 浏览器侧的 RPC 客户端。只通过 protocol 定义的路径、方法名和响应形状
 * 与宿主通信；不导入 core 或 adapters。
 */
import type { EnvCheckReport } from '../protocol/env-check.ts'
import type { Translate } from './i18n-runtime.ts'
import {
  TICKET_ACTION_REASONS,
  TICKET_SKILL_ACTIONS,
  type TicketActionReason,
  type TicketSkillAction,
} from '../protocol/labels.ts'
import {
  ERROR_CODES,
  RPC_METHODS,
  RPC_PATH,
  type ErrorCode,
  type RpcErrorBody,
  type RpcResult,
  SNAPSHOT_CLEAR_CONFIRMATION,
  type SnapshotCacheInfo,
  type SnapshotCacheParams,
  type SnapshotRefreshParams,
  type SnapshotRefreshResult,
  TICKET_DELETE_CONFIRMATION,
  type TicketAttachment,
  type TicketDeleteResult,
  type TicketDetail,
  type TicketOptions,
  type TicketPatch,
  type TicketUpdateResult,
  type WorkspaceSnapshot,
} from '../protocol/tracker.ts'

/** 浏览器 fetch 的最小形状，测试可以注入假实现。 */
export interface HttpResponseLike {
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
}

/** 发送一次 POST 请求。 */
export type FetchLike = (
  input: string,
  init: {
    readonly method: 'POST'
    readonly headers: Record<string, string>
    readonly body: string
  },
) => Promise<HttpResponseLike>

/** 面板客户端：界面只依赖这些方法。 */
export interface PanelClient {
  get(workspaceRoot: string): Promise<RpcResult<WorkspaceSnapshot>>
  /**
   * 扩一页列表窗口。宿主把新页并入当前快照后返回完整快照；
   * 已经覆盖全部工单或到窗口上限时原样返回。
   */
  more(workspaceRoot: string): Promise<RpcResult<WorkspaceSnapshot>>
  /**
   * 刷新快照。默认走增量；`full` 为 true 时忽略本地快照库，全量重拉一次。
   * `ifVersion` 是界面持有的库版本：带上后数据没变回 not-modified，
   * 变了只回变化的行与墓碑（必要时回退整份）。
   */
  refresh(
    workspaceRoot: string,
    options?: { readonly full?: boolean; readonly ifVersion?: number },
  ): Promise<RpcResult<SnapshotRefreshResult>>
  /**
   * 读取本地快照库的信息；`clear` 为 true 时按确认词清空它。
   */
  cache(
    workspaceRoot: string,
    options?: { readonly clear?: boolean },
  ): Promise<RpcResult<SnapshotCacheInfo>>
  /** 补齐原生阻塞信息；快照已定稿时宿主直接返回缓存。 */
  resolveBlockers(workspaceRoot: string): Promise<RpcResult<WorkspaceSnapshot>>
  /** 重新跑一次环境检查；宿主不缓存结果。 */
  envCheck(workspaceRoot: string): Promise<RpcResult<EnvCheckReport>>
  /** 读取单张工单详情；打开详情时按需请求，不进入列表快照。 */
  getDetail(
    workspaceRoot: string,
    ref: string,
    number: number | null,
  ): Promise<RpcResult<TicketDetail>>
  /** 提交一次变更；成功后由调用方重新读取详情。 */
  updateTicket(
    workspaceRoot: string,
    ref: string,
    number: number | null,
    patch: TicketPatch,
  ): Promise<RpcResult<TicketUpdateResult>>
  /** 读取仓库的标签与可分配用户，供补全使用；不支持时返回 capability-unsupported。 */
  getOptions(workspaceRoot: string): Promise<RpcResult<TicketOptions>>
  /** 永久删除一张工单；确认词由界面在用户输入后传入。 */
  deleteTicket(
    workspaceRoot: string,
    ref: string,
    number: number | null,
  ): Promise<RpcResult<TicketDeleteResult>>
  /** 取回正文里内联的后端上传图片；`path` 是根相对的 `/uploads/...` 地址。 */
  getAttachment(workspaceRoot: string, path: string): Promise<RpcResult<TicketAttachment>>
}

/**
 * 创建走插件私有 HTTP 路由的客户端。
 * @param t - 翻译入口；请求失败的原因按当前语言生成。
 * @param fetchImpl - fetch 实现，默认用全局 fetch。
 * @returns 面板客户端。
 */
export function createPanelClient(t: Translate, fetchImpl: FetchLike = defaultFetch): PanelClient {
  return {
    get: (workspaceRoot) =>
      call(fetchImpl, t, RPC_METHODS.snapshotGet, { workspaceRoot }, isSnapshotResult),
    more: (workspaceRoot) =>
      call(fetchImpl, t, RPC_METHODS.snapshotMore, { workspaceRoot }, isSnapshotResult),
    refresh: (workspaceRoot, options) => {
      // 只有明确要求全量时才带上 full：缺省时宿主能用增量就用增量。
      // 有库版本才带 ifVersion：没有数据时宿主按整份回。
      const params: SnapshotRefreshParams = {
        workspaceRoot,
        ...(options?.full === true ? { full: true } : {}),
        ...(options?.ifVersion === undefined ? {} : { ifVersion: options.ifVersion }),
      }
      return call(fetchImpl, t, RPC_METHODS.snapshotRefresh, params, isSnapshotRefreshResult)
    },
    cache: (workspaceRoot, options) => {
      const params: SnapshotCacheParams =
        options?.clear === true
          ? { workspaceRoot, clear: true, confirm: SNAPSHOT_CLEAR_CONFIRMATION }
          : { workspaceRoot }
      return call(fetchImpl, t, RPC_METHODS.snapshotCache, params, isSnapshotCacheResult)
    },
    resolveBlockers: (workspaceRoot) =>
      call(fetchImpl, t, RPC_METHODS.snapshotResolveBlockers, { workspaceRoot }, isSnapshotResult),
    envCheck: (workspaceRoot) =>
      call(fetchImpl, t, RPC_METHODS.envCheck, { workspaceRoot }, isEnvCheckResult),
    getDetail: (workspaceRoot, ref, number) =>
      call(
        fetchImpl,
        t,
        RPC_METHODS.ticketGet,
        { workspaceRoot, ref, number },
        isTicketDetailResult,
      ),
    updateTicket: (workspaceRoot, ref, number, patch) =>
      call(
        fetchImpl,
        t,
        RPC_METHODS.ticketUpdate,
        { workspaceRoot, ref, number, patch },
        isTicketUpdateResult,
      ),
    getOptions: (workspaceRoot) =>
      call(fetchImpl, t, RPC_METHODS.ticketOptions, { workspaceRoot }, isTicketOptionsResult),
    deleteTicket: (workspaceRoot, ref, number) =>
      call(
        fetchImpl,
        t,
        RPC_METHODS.ticketDelete,
        { workspaceRoot, ref, number, confirm: TICKET_DELETE_CONFIRMATION },
        isTicketDeleteResult,
      ),
    getAttachment: (workspaceRoot, path) =>
      call(
        fetchImpl,
        t,
        RPC_METHODS.ticketAttachment,
        { workspaceRoot, path },
        isTicketAttachmentResult,
      ),
  }
}

async function call<T>(
  fetchImpl: FetchLike,
  t: Translate,
  method: string,
  params: unknown,
  isResult: (value: unknown) => value is RpcResult<T>,
): Promise<RpcResult<T>> {
  try {
    const response = await fetchImpl(RPC_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, params }),
    })

    if (!response.ok) {
      return failure(ERROR_CODES.fetchFailed, t('error.rpcHttpFailed', { status: response.status }))
    }

    const body = await response.json()
    if (!isResult(body)) {
      return failure(ERROR_CODES.fetchFailed, t('error.rpcBadResponse'))
    }
    return body
  } catch (error) {
    const detail = error instanceof Error ? error.message : t('common.unknownError')
    return failure(ERROR_CODES.fetchFailed, t('error.rpcNetworkFailed', { detail }))
  }
}

function defaultFetch(
  input: string,
  init: {
    readonly method: 'POST'
    readonly headers: Record<string, string>
    readonly body: string
  },
): Promise<HttpResponseLike> {
  return fetch(input, init)
}

function failure<T>(code: ErrorCode, message: string): RpcResult<T> {
  return { ok: false, error: { code, message } }
}

function isRpcResult<T>(
  value: unknown,
  isPayload: (payload: unknown) => payload is T,
): value is RpcResult<T> {
  if (typeof value !== 'object' || value === null) return false
  if (!('ok' in value)) return false

  if (value.ok === false) {
    if (!('error' in value)) return false
    const error = value.error
    if (typeof error !== 'object' || error === null) return false
    return 'code' in error && typeof error.code === 'string' && 'message' in error
  }

  if (value.ok !== true) return false
  if (!('result' in value)) return false
  return isPayload(value.result)
}

function isSnapshotResult(value: unknown): value is RpcResult<WorkspaceSnapshot> {
  return isRpcResult(value, isWorkspaceSnapshot)
}

function isSnapshotRefreshResult(value: unknown): value is RpcResult<SnapshotRefreshResult> {
  return isRpcResult(value, isSnapshotRefreshResultPayload)
}

/** 刷新回包守卫：三分支各自校验，缺字段按格式不对拒绝。 */
function isSnapshotRefreshResultPayload(value: unknown): value is SnapshotRefreshResult {
  if (!isObject(value)) return false
  if (typeof value.kind !== 'string') return false
  if (value.kind === 'full') {
    return 'snapshot' in value && isWorkspaceSnapshot(value.snapshot)
  }
  if (value.kind === 'not-modified') {
    return typeof value.version === 'number' && typeof value.checkedAt === 'number'
  }
  if (value.kind === 'changes') {
    return (
      typeof value.version === 'number' &&
      typeof value.fetchedAt === 'number' &&
      Array.isArray(value.tickets) &&
      value.tickets.every(hasTicketFilterFields) &&
      isStringArray(value.removed) &&
      typeof value.metrics === 'object' &&
      value.metrics !== null &&
      (value.viewer === null || typeof value.viewer === 'string') &&
      typeof value.total === 'number' &&
      typeof value.loaded === 'number' &&
      typeof value.windowLimit === 'number' &&
      typeof value.blockersFinalized === 'boolean'
    )
  }
  return false
}

function isWorkspaceSnapshot(value: unknown): value is WorkspaceSnapshot {
  if (typeof value !== 'object' || value === null) return false
  if (!('backend' in value) || typeof value.backend !== 'string') return false
  if (!('repository' in value) || typeof value.repository !== 'string') return false
  if (!('repositoryHost' in value)) return false
  if (value.repositoryHost !== null && typeof value.repositoryHost !== 'string') return false
  // 当前用户是人员筛选的必填依据：缺字段或类型不对时拒绝整份响应，不静默当成无身份。
  if (!('viewer' in value)) return false
  if (value.viewer !== null && typeof value.viewer !== 'string') return false
  if (!('fetchedAt' in value) || typeof value.fetchedAt !== 'number') return false
  if (!('loaded' in value) || typeof value.loaded !== 'number') return false
  if (!('total' in value) || typeof value.total !== 'number') return false
  if (!('windowLimit' in value) || typeof value.windowLimit !== 'number') return false
  if (
    !('hierarchy' in value) ||
    !(
      value.hierarchy === 'native' ||
      value.hierarchy === 'convention' ||
      value.hierarchy === 'none'
    )
  ) {
    return false
  }
  if (
    !('libraryVersion' in value) ||
    !(value.libraryVersion === null || typeof value.libraryVersion === 'number')
  ) {
    return false
  }
  if (!('tickets' in value) || !Array.isArray(value.tickets)) return false
  if (!value.tickets.every(hasTicketFilterFields)) return false
  if (!('metrics' in value) || typeof value.metrics !== 'object' || value.metrics === null) {
    return false
  }
  if (!('blockersFinalized' in value) || typeof value.blockersFinalized !== 'boolean') return false
  // 数据来源、是否陈旧与刷新失败原因：少一个字段就无法如实呈现数据的新鲜度。
  if (!('source' in value) || !(value.source === 'live' || value.source === 'cache')) return false
  if (!('stale' in value) || typeof value.stale !== 'boolean') return false
  if (!('refreshError' in value)) return false
  if (value.refreshError !== null && !isRpcErrorBody(value.refreshError)) return false
  return true
}

/** 失败响应体：错误码与说明都要有，缺一个就当作格式不对。 */
function isRpcErrorBody(value: unknown): value is RpcErrorBody {
  if (typeof value !== 'object' || value === null) return false
  if (!('code' in value) || typeof value.code !== 'string') return false
  if (!('message' in value) || typeof value.message !== 'string') return false
  return true
}

function isSnapshotCacheResult(value: unknown): value is RpcResult<SnapshotCacheInfo> {
  return isRpcResult(value, isSnapshotCacheInfo)
}

function isSnapshotCacheInfo(value: unknown): value is SnapshotCacheInfo {
  if (typeof value !== 'object' || value === null) return false
  if (!('location' in value) || typeof value.location !== 'string') return false
  if (!('entries' in value) || typeof value.entries !== 'number') return false
  if (!('lastWrittenAt' in value)) return false
  if (value.lastWrittenAt !== null && typeof value.lastWrittenAt !== 'number') return false
  if (!('cleared' in value) || typeof value.cleared !== 'number') return false
  return true
}

/**
 * 列表筛选依赖的每票字段：技能动作与分配人。
 * 缺任一字段都按整份响应格式不对处理，避免宿主与界面版本错配时静默显示错误的「我的工单」。
 */
function hasTicketFilterFields(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  if (!('skillAction' in value) || !isSkillAction(value.skillAction)) return false
  if (!('skillActionReason' in value) || !isActionReason(value.skillActionReason)) return false
  return 'assignees' in value && isStringArray(value.assignees)
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isSkillAction(value: unknown): value is TicketSkillAction {
  return TICKET_SKILL_ACTIONS.some((action) => action === value)
}

function isActionReason(value: unknown): value is TicketActionReason {
  return TICKET_ACTION_REASONS.some((reason) => reason === value)
}

function isEnvCheckResult(value: unknown): value is RpcResult<EnvCheckReport> {
  return isRpcResult(value, isEnvCheckReport)
}

function isEnvCheckReport(value: unknown): value is EnvCheckReport {
  if (typeof value !== 'object' || value === null) return false
  if (!('checkedAt' in value) || typeof value.checkedAt !== 'number') return false
  if (!('backend' in value) || !(value.backend === null || typeof value.backend === 'string')) {
    return false
  }
  if (!('repository' in value)) return false
  if (value.repository !== null && typeof value.repository !== 'string') return false
  if (!('items' in value) || !Array.isArray(value.items)) return false
  if (!('capabilities' in value) || !Array.isArray(value.capabilities)) return false
  return true
}

function isTicketDetailResult(value: unknown): value is RpcResult<TicketDetail> {
  return isRpcResult(value, isTicketDetail)
}

function isTicketDetail(value: unknown): value is TicketDetail {
  if (typeof value !== 'object' || value === null) return false
  if (!('ref' in value) || typeof value.ref !== 'string') return false
  if (!('number' in value) || !(value.number === null || typeof value.number === 'number')) {
    return false
  }
  if (!('title' in value) || typeof value.title !== 'string') return false
  if (!('state' in value) || !(value.state === 'open' || value.state === 'closed')) return false
  if (!('author' in value) || !(value.author === null || typeof value.author === 'string')) {
    return false
  }
  if (!('body' in value) || typeof value.body !== 'string') return false
  if (
    !('uploadsBaseUrl' in value) ||
    !(value.uploadsBaseUrl === null || typeof value.uploadsBaseUrl === 'string')
  ) {
    return false
  }
  if (!('labels' in value) || !Array.isArray(value.labels)) return false
  if (!('assignees' in value) || !Array.isArray(value.assignees)) return false
  if (!('comments' in value) || !Array.isArray(value.comments)) return false
  if (!('url' in value) || !(value.url === null || typeof value.url === 'string')) return false
  if (!('createdAt' in value) || typeof value.createdAt !== 'string') return false
  if (!('updatedAt' in value) || typeof value.updatedAt !== 'string') return false
  if (!('backend' in value) || typeof value.backend !== 'string') return false
  if (!('capabilities' in value) || typeof value.capabilities !== 'object') return false
  if (value.capabilities === null) return false
  const capabilities = value.capabilities as Record<string, unknown>
  for (const key of ['labels', 'assignees', 'state', 'link', 'delete'] as const) {
    if (typeof capabilities[key] !== 'boolean') return false
  }
  return true
}

function isTicketUpdateResult(value: unknown): value is RpcResult<TicketUpdateResult> {
  return isRpcResult(
    value,
    (payload): payload is TicketUpdateResult =>
      typeof payload === 'object' &&
      payload !== null &&
      'applied' in payload &&
      payload.applied === true,
  )
}

function isTicketDeleteResult(value: unknown): value is RpcResult<TicketDeleteResult> {
  return isRpcResult(
    value,
    (payload): payload is TicketDeleteResult =>
      typeof payload === 'object' &&
      payload !== null &&
      'deleted' in payload &&
      payload.deleted === true,
  )
}

/** 只接受宿主识别过的位图类型，界面拼 data URL 时不会拼出别的协议内容。 */
const ATTACHMENT_MEDIA_TYPE = /^image\/(png|jpeg|gif|webp)$/
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

function isTicketAttachmentResult(value: unknown): value is RpcResult<TicketAttachment> {
  return isRpcResult(
    value,
    (payload): payload is TicketAttachment =>
      typeof payload === 'object' &&
      payload !== null &&
      'mediaType' in payload &&
      typeof payload.mediaType === 'string' &&
      ATTACHMENT_MEDIA_TYPE.test(payload.mediaType) &&
      'base64' in payload &&
      typeof payload.base64 === 'string' &&
      BASE64.test(payload.base64),
  )
}

function isTicketOptionsResult(value: unknown): value is RpcResult<TicketOptions> {
  return isRpcResult(value, isTicketOptions)
}

function isTicketOptions(value: unknown): value is TicketOptions {
  if (typeof value !== 'object' || value === null) return false
  if (!('labels' in value) || !Array.isArray(value.labels)) return false
  if (!('assignees' in value) || !Array.isArray(value.assignees)) return false
  const labelsValid = value.labels.every(
    (label: unknown) =>
      isObject(label) &&
      typeof label.name === 'string' &&
      (label.color === null || typeof label.color === 'string') &&
      (label.description === null || typeof label.description === 'string'),
  )
  const assigneesValid = value.assignees.every(
    (user: unknown) =>
      isObject(user) &&
      typeof user.username === 'string' &&
      (user.name === null || typeof user.name === 'string'),
  )
  return labelsValid && assigneesValid
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
