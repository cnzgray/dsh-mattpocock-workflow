/**
 * 工单服务：读取单张工单详情、应用变更补丁。
 *
 * 与快照服务并列，共用 `handle(method, params)` 接缝。它只做三件事：
 * 校验参数、按工作区解析后端并调用可选能力、把适配器错误映射成协议错误码。
 *
 * 能力存在即支持，不存在即不支持：本地 Markdown 只实现 `fetchDetail`，
 * 因此详情里的写控件全部禁用；宿主不返回空数据冒充成功。
 */
import type { SnapshotStore } from '../adapters/fs/snapshot-store.ts'
import { isRecord } from '../core/json.ts'
import type {
  TicketDetail,
  TicketOptions,
  TicketPatch,
  TicketReference,
  Tracker,
} from '../core/ticket.ts'
import { TrackerError } from '../core/tracker-error.ts'
import { BACKEND_LABELS, type BackendKind } from '../protocol/backend.ts'
import { LOG_EVENTS, TICKET_ACTIONS } from '../protocol/log-events.ts'
import {
  ERROR_CODES,
  RPC_METHODS,
  TICKET_DELETE_CONFIRMATION,
  type DetailCapabilities,
  type ErrorCode,
  type RpcResult,
  type TicketDeleteResult,
  type TicketDetail as ProtocolTicketDetail,
  type TicketUpdateResult,
} from '../protocol/tracker.ts'
import type { BackendResolver } from './backend-resolver.ts'
import type { LogSink } from './log.ts'
import { readTicketParams, readWorkspaceRoot, type TicketParams } from './rpc-params.ts'

/** 工单服务依赖。 */
export interface TicketServiceDeps {
  /** 按工作区解析后端；解析结果由宿主自己缓存。 */
  readonly resolve: BackendResolver
  readonly now: () => number
  readonly log: LogSink
  /**
   * 本地快照库。写操作成功后同步缓存里那张票，缓存才不会比远端更旧。
   * 没有它时写操作只影响远端。
   */
  readonly store?: SnapshotStore | undefined
}

/** 宿主对界面的工单 RPC 入口。 */
export interface TicketService {
  /**
   * 处理一个工单方法。
   * @param method - `ticket.get`、`ticket.update`、`ticket.options` 或 `ticket.delete`。
   * @param params - 工作区与工单定位参数；变更还带补丁，删除还带确认词。
   * @returns 详情、补全候选、变更 / 删除回执或带错误码的失败。
   */
  handle(method: string, params: unknown): Promise<RpcResult<unknown>>
}

const PATCH_KEYS: Record<string, true> = {
  labels: true,
  assignees: true,
  assignSelf: true,
  state: true,
}

/**
 * 创建工单服务。
 * @param deps - 后端解析器、时钟与日志出口。
 * @returns 工单服务。
 */
export function createTicketService(deps: TicketServiceDeps): TicketService {
  return {
    handle(method, params) {
      if (method === RPC_METHODS.ticketGet) return getDetail(deps, params)
      if (method === RPC_METHODS.ticketUpdate) return update(deps, params)
      if (method === RPC_METHODS.ticketOptions) return readOptions(deps, params)
      if (method === RPC_METHODS.ticketDelete) return remove(deps, params)
      return Promise.resolve(failure(ERROR_CODES.unknownMethod, `未知方法：${method}`))
    },
  }
}

async function getDetail(
  deps: TicketServiceDeps,
  params: unknown,
): Promise<RpcResult<ProtocolTicketDetail>> {
  const target = readTicketParams(params)
  if (target === undefined) {
    return failure(ERROR_CODES.invalidParams, '缺少 workspaceRoot、ref 或 number 参数。')
  }

  const startedAt = deps.now()
  let kind: BackendKind | undefined
  try {
    const resolved = await deps.resolve(target.workspaceRoot)
    kind = resolved.kind
    const fetchDetail = resolved.tracker.fetchDetail
    if (fetchDetail === undefined) {
      return unsupported(kind, '读取工单详情')
    }

    // 权限查询与详情并行；查询失败只让删除能力为 false，不影响详情本身。
    const [detail, canDelete] = await Promise.all([
      fetchDetail(target.workspaceRoot, referenceOf(target)),
      readCanDelete(resolved.tracker, target.workspaceRoot),
    ])
    logResult(deps, 'info', kind, 'get', startedAt)
    return { ok: true, result: withCapabilities(kind, resolved.tracker, detail, canDelete) }
  } catch (error) {
    const mapped = mapError(error)
    logResult(deps, 'warn', kind, 'get', startedAt, mapped.code)
    return failure(mapped.code, mapped.message)
  }
}

async function update(
  deps: TicketServiceDeps,
  params: unknown,
): Promise<RpcResult<TicketUpdateResult>> {
  const target = readTicketParams(params)
  if (target === undefined) {
    return failure(ERROR_CODES.invalidParams, '缺少 workspaceRoot、ref 或 number 参数。')
  }

  const patch = readPatch(readField(params, 'patch'))
  if (patch === undefined) {
    return failure(ERROR_CODES.invalidParams, 'patch 形状不正确：需要至少一项已知属性。')
  }

  const startedAt = deps.now()
  let kind: BackendKind | undefined
  try {
    const resolved = await deps.resolve(target.workspaceRoot)
    kind = resolved.kind
    const updateTicket = resolved.tracker.updateTicket
    if (updateTicket === undefined) {
      return unsupported(kind, '修改工单属性')
    }

    await updateTicket(target.workspaceRoot, referenceOf(target), patch)
    await syncCachedTicket(deps, target.workspaceRoot, target.ref, patch)
    logResult(deps, 'info', kind, 'update', startedAt)
    return { ok: true, result: { applied: true } }
  } catch (error) {
    const mapped = mapError(error)
    logResult(deps, 'warn', kind, 'update', startedAt, mapped.code)
    return failure(mapped.code, mapped.message)
  }
}

async function readOptions(
  deps: TicketServiceDeps,
  params: unknown,
): Promise<RpcResult<TicketOptions>> {
  const workspaceRoot = readWorkspaceRoot(params)
  if (workspaceRoot === undefined) {
    return failure(ERROR_CODES.invalidParams, '缺少 workspaceRoot 参数。')
  }

  const startedAt = deps.now()
  let kind: BackendKind | undefined
  try {
    const resolved = await deps.resolve(workspaceRoot)
    kind = resolved.kind
    const fetchOptions = resolved.tracker.fetchOptions
    if (fetchOptions === undefined) {
      return unsupported(kind, '读取标签与分配人候选')
    }

    const result = await fetchOptions(workspaceRoot)
    logResult(deps, 'info', kind, 'options', startedAt)
    return { ok: true, result }
  } catch (error) {
    const mapped = mapError(error)
    logResult(deps, 'warn', kind, 'options', startedAt, mapped.code)
    return failure(mapped.code, mapped.message)
  }
}

async function remove(
  deps: TicketServiceDeps,
  params: unknown,
): Promise<RpcResult<TicketDeleteResult>> {
  const target = readTicketParams(params)
  if (target === undefined) {
    return failure(ERROR_CODES.invalidParams, '缺少 workspaceRoot、ref 或 number 参数。')
  }
  if (readField(params, 'confirm') !== TICKET_DELETE_CONFIRMATION) {
    return failure(ERROR_CODES.invalidParams, `删除工单需要确认词 ${TICKET_DELETE_CONFIRMATION}。`)
  }

  const startedAt = deps.now()
  let kind: BackendKind | undefined
  try {
    const resolved = await deps.resolve(target.workspaceRoot)
    kind = resolved.kind
    const deleteTicket = resolved.tracker.deleteTicket
    if (deleteTicket === undefined) {
      return unsupported(kind, '删除工单')
    }

    // 删除不可撤销：调用前再查一次权限，查询失败或没有权限都不发删除命令。
    if (!(await readCanDelete(resolved.tracker, target.workspaceRoot))) {
      const code = ERROR_CODES.fetchFailed
      logResult(deps, 'warn', kind, 'delete', startedAt, code)
      return failure(code, `没有删除这张工单的权限（${BACKEND_LABELS[kind]}）。`)
    }

    await deleteTicket(target.workspaceRoot, referenceOf(target))
    await removeCachedTicket(deps, target.workspaceRoot, target.ref)
    logResult(deps, 'info', kind, 'delete', startedAt)
    return { ok: true, result: { deleted: true } }
  } catch (error) {
    const mapped = mapError(error)
    logResult(deps, 'warn', kind, 'delete', startedAt, mapped.code)
    return failure(mapped.code, mapped.message)
  }
}

/**
 * 变更成功后同步本地快照库里的那张票。
 *
 * 只同步列表级字段（标签、状态）；分配人不进列表快照。同步失败就跳过：
 * 缓存比远端旧一点，下一次刷新会把它拉齐。
 * @param deps - 服务依赖。
 * @param workspaceRoot - 工作区根目录。
 * @param ref - 工单引用。
 * @param patch - 已应用的补丁。
 */
async function syncCachedTicket(
  deps: TicketServiceDeps,
  workspaceRoot: string,
  ref: string,
  patch: TicketPatch,
): Promise<void> {
  const store = deps.store
  if (store === undefined) return
  if (patch.labels === undefined && patch.state === undefined) return
  try {
    await store.patchTicket(workspaceRoot, ref, {
      ...(patch.labels === undefined ? {} : { labels: patch.labels }),
      ...(patch.state === undefined ? {} : { state: patch.state }),
    })
  } catch {
    // 缓存写不进去不影响这次变更的结果。
  }
}

/**
 * 删除成功后把那张票从本地快照库里去掉。
 * @param deps - 服务依赖。
 * @param workspaceRoot - 工作区根目录。
 * @param ref - 工单引用。
 */
async function removeCachedTicket(
  deps: TicketServiceDeps,
  workspaceRoot: string,
  ref: string,
): Promise<void> {
  const store = deps.store
  if (store === undefined) return
  try {
    await store.removeTicket(workspaceRoot, ref)
  } catch {
    // 同上：缓存清不掉不影响删除结果。
  }
}

/** 详情响应附带后端与能力位；写能力由后端是否实现变更能力决定。 */
function withCapabilities(
  kind: BackendKind,
  tracker: Tracker,
  detail: TicketDetail,
  canDelete: boolean,
): ProtocolTicketDetail {
  const writable = tracker.updateTicket !== undefined
  const capabilities: DetailCapabilities = {
    labels: writable,
    assignees: writable,
    state: writable,
    link: detail.url !== null,
    delete: canDelete,
  }

  return { ...detail, backend: kind, capabilities }
}

/**
 * 当前用户能否删除工单。后端必须同时实现删除与权限查询，权限查询失败按 false 处理。
 */
async function readCanDelete(tracker: Tracker, workspaceRoot: string): Promise<boolean> {
  if (tracker.canDeleteTickets === undefined || tracker.deleteTicket === undefined) return false
  try {
    return await tracker.canDeleteTickets(workspaceRoot)
  } catch {
    return false
  }
}

function readPatch(value: unknown): TicketPatch | undefined {
  if (!isRecord(value)) return undefined
  if (Object.keys(value).some((key) => !Object.hasOwn(PATCH_KEYS, key))) return undefined

  const patch: { -readonly [Key in keyof TicketPatch]: TicketPatch[Key] } = {}

  if ('labels' in value) {
    const labels = readNames(value.labels)
    if (labels === undefined) return undefined
    patch.labels = labels
  }
  if ('assignees' in value) {
    const assignees = readNames(value.assignees)
    if (assignees === undefined) return undefined
    patch.assignees = assignees
  }
  if ('assignSelf' in value) {
    if (typeof value.assignSelf !== 'boolean') return undefined
    patch.assignSelf = value.assignSelf
  }
  if ('state' in value) {
    const state = value.state
    if (state !== 'open' && state !== 'closed') return undefined
    patch.state = state
  }

  return Object.keys(patch).length === 0 ? undefined : patch
}

/** 标签与分配人集合：非空字符串，去重并保持顺序。 */
function readNames(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined

  const names: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') return undefined
    const trimmed = entry.trim()
    if (trimmed.length === 0) return undefined
    if (!names.includes(trimmed)) names.push(trimmed)
  }
  return names
}

function readField(params: unknown, key: string): unknown {
  if (typeof params !== 'object' || params === null) return undefined
  return key in params ? (params as Record<string, unknown>)[key] : undefined
}

function referenceOf(target: TicketParams): TicketReference {
  return { ref: target.ref, number: target.number }
}

function unsupported<T>(kind: BackendKind, action: string): RpcResult<T> {
  return failure(
    ERROR_CODES.capabilityUnsupported,
    `当前后端（${BACKEND_LABELS[kind]}）不支持${action}。`,
  )
}

function mapError(error: unknown): { readonly code: ErrorCode; readonly message: string } {
  if (error instanceof TrackerError) {
    return { code: error.code, message: error.message }
  }
  return { code: ERROR_CODES.internal, message: '处理工单时发生未预期的错误。' }
}

function logResult(
  deps: TicketServiceDeps,
  level: 'info' | 'warn',
  kind: BackendKind | undefined,
  action: keyof typeof TICKET_ACTIONS,
  startedAt: number,
  code?: ErrorCode,
): void {
  deps.log(level, LOG_EVENTS.ticket, {
    result: code === undefined ? 'ok' : 'error',
    action: TICKET_ACTIONS[action],
    ...(kind === undefined ? {} : { backend: kind }),
    ...(code === undefined ? {} : { code }),
    durationMs: Math.max(0, deps.now() - startedAt),
  })
}

function failure<T>(code: ErrorCode, message: string): RpcResult<T> {
  return { ok: false, error: { code, message } }
}
