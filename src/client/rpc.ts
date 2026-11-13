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

/** 面板客户端：界面只依赖这四个方法。 */
export interface PanelClient {
  get(workspaceRoot: string): Promise<RpcResult<WorkspaceSnapshot>>
  refresh(workspaceRoot: string): Promise<RpcResult<WorkspaceSnapshot>>
  /** 补齐原生阻塞信息；快照已定稿时宿主直接返回缓存。 */
  resolveBlockers(workspaceRoot: string): Promise<RpcResult<WorkspaceSnapshot>>
  /** 重新跑一次环境检查；宿主不缓存结果。 */
  envCheck(workspaceRoot: string): Promise<RpcResult<EnvCheckReport>>
}

/**
 * 创建走插件私有 HTTP 路由的客户端。
 * @param fetchImpl - fetch 实现，默认用全局 fetch。
 * @returns 面板客户端。
 */
export function createPanelClient(fetchImpl: FetchLike = defaultFetch): PanelClient {
  return {
    get: (workspaceRoot) =>
      call(fetchImpl, RPC_METHODS.snapshotGet, workspaceRoot, isSnapshotResult),
    refresh: (workspaceRoot) =>
      call(fetchImpl, RPC_METHODS.snapshotRefresh, workspaceRoot, isSnapshotResult),
    resolveBlockers: (workspaceRoot) =>
      call(fetchImpl, RPC_METHODS.snapshotResolveBlockers, workspaceRoot, isSnapshotResult),
    envCheck: (workspaceRoot) =>
      call(fetchImpl, RPC_METHODS.envCheck, workspaceRoot, isEnvCheckResult),
  }
}

async function call<T>(
  fetchImpl: FetchLike,
  method: string,
  workspaceRoot: string,
  isResult: (value: unknown) => value is RpcResult<T>,
): Promise<RpcResult<T>> {
  try {
    const response = await fetchImpl(RPC_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, params: { workspaceRoot } }),
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
