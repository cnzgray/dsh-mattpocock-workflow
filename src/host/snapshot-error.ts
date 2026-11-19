/**
 * 快照失败的统一出口：业务错误映射成协议错误码，失败响应只在这里拼。
 */
import { TrackerError } from '../core/tracker-error.ts'
import { ERROR_CODES, type ErrorCode, type RpcResult } from '../protocol/tracker.ts'

/**
 * 把后端抛出的错误映射成协议错误码。
 * @param error - 后端或库抛出的任意错误。
 * @returns 错误码与可展示的说明。
 */
export function mapSnapshotError(error: unknown): {
  readonly code: ErrorCode
  readonly message: string
  readonly retryAfterMs?: number
} {
  if (error instanceof TrackerError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
    }
  }
  return { code: ERROR_CODES.internal, message: '读取工单时发生未预期的错误。' }
}

/**
 * 组装失败响应。
 * @param code - 错误码。
 * @param message - 可展示的说明。
 * @returns 失败响应。
 */
export function snapshotFailure(code: ErrorCode, message: string): RpcResult<never> {
  return { ok: false, error: { code, message } }
}
