/**
 * 浏览器侧的 RPC 客户端。只通过 protocol 定义的路径、方法名和响应形状
 * 与宿主通信；不导入 core 或 adapters。
 */
import type { EnvCheckReport } from '../protocol/env-check.ts'
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
  type RpcResult,
  TICKET_DELETE_CONFIRMATION,
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
  refresh(workspaceRoot: string): Promise<RpcResult<WorkspaceSnapshot>>
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
}

/**
 * 创建走插件私有 HTTP 路由的客户端。
 * @param fetchImpl - fetch 实现，默认用全局 fetch。
 * @returns 面板客户端。
 */
export function createPanelClient(fetchImpl: FetchLike = defaultFetch): PanelClient {
  return {
    get: (workspaceRoot) =>
      call(fetchImpl, RPC_METHODS.snapshotGet, { workspaceRoot }, isSnapshotResult),
    refresh: (workspaceRoot) =>
      call(fetchImpl, RPC_METHODS.snapshotRefresh, { workspaceRoot }, isSnapshotResult),
    resolveBlockers: (workspaceRoot) =>
      call(fetchImpl, RPC_METHODS.snapshotResolveBlockers, { workspaceRoot }, isSnapshotResult),
    envCheck: (workspaceRoot) =>
      call(fetchImpl, RPC_METHODS.envCheck, { workspaceRoot }, isEnvCheckResult),
    getDetail: (workspaceRoot, ref, number) =>
      call(fetchImpl, RPC_METHODS.ticketGet, { workspaceRoot, ref, number }, isTicketDetailResult),
    updateTicket: (workspaceRoot, ref, number, patch) =>
      call(
        fetchImpl,
        RPC_METHODS.ticketUpdate,
        { workspaceRoot, ref, number, patch },
        isTicketUpdateResult,
      ),
    getOptions: (workspaceRoot) =>
      call(fetchImpl, RPC_METHODS.ticketOptions, { workspaceRoot }, isTicketOptionsResult),
    deleteTicket: (workspaceRoot, ref, number) =>
      call(
        fetchImpl,
        RPC_METHODS.ticketDelete,
        { workspaceRoot, ref, number, confirm: TICKET_DELETE_CONFIRMATION },
        isTicketDeleteResult,
      ),
  }
}

async function call<T>(
  fetchImpl: FetchLike,
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
      return failure(ERROR_CODES.fetchFailed, `请求失败（HTTP ${String(response.status)}）。`)
    }

    const body = await response.json()
    if (!isResult(body)) {
      return failure(ERROR_CODES.fetchFailed, '宿主返回的响应格式不正确。')
    }
    return body
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知错误'
    return failure(ERROR_CODES.fetchFailed, `网络请求失败：${detail}`)
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

function isWorkspaceSnapshot(value: unknown): value is WorkspaceSnapshot {
  if (typeof value !== 'object' || value === null) return false
  if (!('backend' in value) || typeof value.backend !== 'string') return false
  if (!('repository' in value) || typeof value.repository !== 'string') return false
  if (!('repositoryHost' in value)) return false
  if (value.repositoryHost !== null && typeof value.repositoryHost !== 'string') return false
  if (!('fetchedAt' in value) || typeof value.fetchedAt !== 'number') return false
  if (!('loaded' in value) || typeof value.loaded !== 'number') return false
  if (!('total' in value) || typeof value.total !== 'number') return false
  if (!('tickets' in value) || !Array.isArray(value.tickets)) return false
  if (!value.tickets.every(hasSkillAction)) return false
  if (!('blockersFinalized' in value) || typeof value.blockersFinalized !== 'boolean') return false
  return true
}

function hasSkillAction(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  if (!('skillAction' in value) || !isSkillAction(value.skillAction)) return false
  return 'skillActionReason' in value && isActionReason(value.skillActionReason)
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
