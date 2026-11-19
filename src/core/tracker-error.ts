/**
 * 边界层向外抛出的错误类型。core 用返回值表示规则判定的失败，
 * 但命令执行和远端读取没有“返回值即失败”的形状，因此用带错误码的异常。
 */

/** 工单读取的业务错误码。 */
export type TrackerErrorCode =
  | 'gh-missing'
  | 'gh-unauthenticated'
  | 'glab-missing'
  | 'glab-unauthenticated'
  | 'tea-missing'
  | 'tea-unauthenticated'
  | 'markdown-read-failed'
  | 'fetch-failed'
  | 'ticket-not-found'
  | 'rate-limited'

/** 带稳定错误码的工单读取失败。 */
export class TrackerError extends Error {
  readonly code: TrackerErrorCode
  /**
   * 服务端要求的重试等待（毫秒）；限流类错误才有，
   * 调用方据此决定冷却时长，缺省时按失败次数指数退避。
   */
  readonly retryAfterMs: number | undefined

  /**
   * @param code - 客户端可据以给出操作提示的错误码。
   * @param message - 面向用户的失败原因。
   * @param options - 原始错误，保留调用链。
   * @param retryAfterMs - 服务端要求的重试等待（毫秒）。
   */
  constructor(
    code: TrackerErrorCode,
    message: string,
    options?: ErrorOptions,
    retryAfterMs?: number,
  ) {
    super(message, options)
    this.name = 'TrackerError'
    this.code = code
    this.retryAfterMs = retryAfterMs
  }
}

/**
 * 网络类失败的特征。`gh` / `glab` 的错误措辞接近，这里只认明确的连接与超时字样；
 * 两个后端的环境探测共用这一份，避免同一组判断各写一遍。
 */
const NETWORK_FAILURE =
  /dial tcp|no such host|i\/o timeout|timeout|network is unreachable|connection refused|connection reset|TLS handshake|proxyconnect|unexpected EOF/i

/** 命令失败的两类原因：可执行文件不存在，或进程非零退出。 */
export type CommandFailureKind = 'not-found' | 'failed'

/** 命令执行失败。adapter 负责把它翻译成 {@link TrackerError}。 */
export class CommandError extends Error {
  readonly kind: CommandFailureKind
  readonly stderr: string
  readonly exitCode: number | null

  /**
   * @param kind - 找不到可执行文件或进程非零退出。
   * @param message - 诊断信息。
   * @param stderr - 进程的标准错误；`not-found` 时为空串。
   * @param exitCode - 退出码；被信号终止或未启动时为 null。
   */
  constructor(
    kind: CommandFailureKind,
    message: string,
    stderr = '',
    exitCode: number | null = null,
  ) {
    super(message)
    this.name = 'CommandError'
    this.kind = kind
    this.stderr = stderr
    this.exitCode = exitCode
  }
}

/**
 * 判断命令失败是否属于网络不可达或超时。
 * @param stderr - 进程的标准错误。
 * @returns 命中网络类特征时为 true。
 */
export function isNetworkFailure(stderr: string): boolean {
  return NETWORK_FAILURE.test(stderr)
}

/**
 * 判断失败是否因为可执行文件不存在。
 * @param error - 任意错误。
 * @returns 是 `CommandError` 且 kind 为 `not-found` 时为 true。
 */
export function isCommandNotFound(error: unknown): error is CommandError {
  return error instanceof CommandError && error.kind === 'not-found'
}

/**
 * 取命令失败的一行诊断：优先标准错误，最多 200 字符。
 * 两个后端都要把子进程错误翻译成用户能看懂的提示，格式保持一致。
 * @param error - 命令执行失败。
 * @returns 第一行诊断。
 */
export function commandFailureDetail(error: CommandError): string {
  const text = error.stderr.trim() || error.message
  const firstLine = text.split('\n')[0] ?? text
  return firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine
}
