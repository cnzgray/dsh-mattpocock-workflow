/**
 * 错误码到用户可操作提示的映射。列表视图与详情视图共用同一套文案，
 * 同一个后端故障在两个入口不会给出两种说法。
 */
import { ENV_ISSUE_ERROR_CODES, type ErrorCode, type RpcErrorBody } from '../protocol/tracker.ts'
import type { Translate } from './i18n-runtime.ts'
import type { MessageKey } from './messages.ts'

const ERROR_MESSAGES: Partial<Record<ErrorCode, MessageKey>> = {
  'gh-missing': 'error.ghMissing',
  'gh-unauthenticated': 'error.ghUnauthenticated',
  'glab-missing': 'error.glabMissing',
  'glab-unauthenticated': 'error.glabUnauthenticated',
  'tea-missing': 'error.teaMissing',
  'tea-unauthenticated': 'error.teaUnauthenticated',
  'markdown-read-failed': 'error.markdownReadFailed',
  'ticket-not-found': 'error.ticketNotFound',
}

/**
 * 把 RPC 错误翻译成一句可操作的提示。
 * @param error - 宿主返回的错误体。
 * @param t - 翻译入口；省略时用内置中文。
 * @returns 固定文案；没有固定文案时用后端给的诊断。
 */
export function errorText(error: RpcErrorBody, t: Translate): string {
  const key = ERROR_MESSAGES[error.code]
  return key === undefined ? error.message : t(key)
}

/**
 * 是否属于环境问题；列表视图据此给出「查看环境检查」入口。
 * @param code - 错误码。
 * @returns 环境类错误码时为 true。
 */
export function isEnvIssue(code: ErrorCode): boolean {
  return ENV_ISSUE_ERROR_CODES.includes(code)
}
