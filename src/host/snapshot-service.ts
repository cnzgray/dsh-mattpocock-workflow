/**
 * 快照服务：缓存、刷新与错误映射。主接缝是 `handle(method, params)`，
 * 测试注入假的「按工作区解析后端」函数就能覆盖缓存、错误码和刷新失败保留旧快照。
 */
import { classifyTickets } from '../core/classify.ts'
import type { TicketLabelNames } from '../core/ticket.ts'
import { TrackerError } from '../core/tracker-error.ts'
import type { BackendKind } from '../protocol/backend.ts'
import { LOG_EVENTS } from '../protocol/log-events.ts'
import {
  ERROR_CODES,
  RPC_METHODS,
  type ErrorCode,
  type RpcResult,
  type WorkspaceSnapshot,
} from '../protocol/tracker.ts'
import type { BackendResolver } from './backend-resolver.ts'
import type { LogSink } from './log.ts'

/** 快照服务依赖。 */
export interface SnapshotServiceDeps {
  /** 按工作区解析后端；解析结果由宿主自己缓存。 */
  readonly resolve: BackendResolver
  readonly now: () => number
  readonly labels: TicketLabelNames
  readonly log: LogSink
}

/** 宿主对界面的唯一 RPC 入口。 */
export interface SnapshotService {
  /**
   * 处理一个 RPC 方法。
   * @param method - `snapshot.get` 或 `snapshot.refresh`。
   * @param params - `{ workspaceRoot }`。
   * @returns 成功快照或带错误码的失败。
   */
  handle(method: string, params: unknown): Promise<RpcResult<WorkspaceSnapshot>>
}

/**
 * 创建按工作区根目录缓存的快照服务。
 * @param deps - 工单后端、时钟、标签名与日志出口。
 * @returns 快照服务。
 */
export function createSnapshotService(deps: SnapshotServiceDeps): SnapshotService {
  const cache = new Map<string, WorkspaceSnapshot>()

  return {
    async handle(method, params) {
      if (method !== RPC_METHODS.snapshotGet && method !== RPC_METHODS.snapshotRefresh) {
        return failure(ERROR_CODES.unknownMethod, `未知方法：${method}`)
      }

      const workspaceRoot = readWorkspaceRoot(params)
      if (workspaceRoot === undefined) {
        return failure(ERROR_CODES.invalidParams, '缺少非空的 workspaceRoot 参数。')
      }

      if (method === RPC_METHODS.snapshotGet) {
        const cached = cache.get(workspaceRoot)
        if (cached !== undefined) return { ok: true, result: cached }
      }

      return fetchAndCache(deps, cache, workspaceRoot)
    },
  }
}

async function fetchAndCache(
  deps: SnapshotServiceDeps,
  cache: Map<string, WorkspaceSnapshot>,
  workspaceRoot: string,
): Promise<RpcResult<WorkspaceSnapshot>> {
  const startedAt = deps.now()
  let kind: BackendKind | undefined

  try {
    const resolved = await deps.resolve(workspaceRoot)
    kind = resolved.kind
    const raw = await resolved.tracker.fetchSnapshot(workspaceRoot)
    const tickets = classifyTickets(raw.tickets, deps.labels)
    const snapshot: WorkspaceSnapshot = {
      backend: resolved.kind,
      repository: raw.repository,
      fetchedAt: raw.fetchedAt,
      loaded: tickets.length,
      total: raw.total,
      tickets: tickets.map((ticket) => ({
        ref: ticket.ref,
        number: ticket.number,
        title: ticket.title,
        state: ticket.state,
        category: ticket.category,
        status: ticket.status,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        openBlockers: ticket.openBlockers,
      })),
    }

    cache.set(workspaceRoot, snapshot)
    deps.log('info', LOG_EVENTS.snapshot, {
      result: 'ok',
      backend: resolved.kind,
      durationMs: Math.max(0, deps.now() - startedAt),
      repository: snapshot.repository,
      loaded: snapshot.loaded,
      total: snapshot.total,
    })
    return { ok: true, result: snapshot }
  } catch (error) {
    const mapped = mapError(error)
    deps.log('warn', LOG_EVENTS.snapshot, {
      result: 'error',
      ...(kind === undefined ? {} : { backend: kind }),
      code: mapped.code,
      durationMs: Math.max(0, deps.now() - startedAt),
    })
    return failure(mapped.code, mapped.message)
  }
}

function readWorkspaceRoot(params: unknown): string | undefined {
  if (typeof params !== 'object' || params === null) return undefined
  if (!('workspaceRoot' in params)) return undefined
  const root = params.workspaceRoot
  return typeof root === 'string' && root.length > 0 ? root : undefined
}

function mapError(error: unknown): { readonly code: ErrorCode; readonly message: string } {
  if (error instanceof TrackerError) {
    return { code: error.code, message: error.message }
  }
  return { code: ERROR_CODES.internal, message: '读取工单时发生未预期的错误。' }
}

function failure(code: ErrorCode, message: string): RpcResult<WorkspaceSnapshot> {
  return { ok: false, error: { code, message } }
}
