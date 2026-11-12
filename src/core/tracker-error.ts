/**
 * 边界层向外抛出的错误类型。core 用返回值表示规则判定的失败，
 * 但命令执行和远端读取没有“返回值即失败”的形状，因此用带错误码的异常。
 */

/** 工单读取的业务错误码。 */
export type TrackerErrorCode =
  'gh-missing' | 'gh-unauthenticated' | 'not-a-repo' | 'no-github-remote' | 'fetch-failed'

/** 带稳定错误码的工单读取失败。 */
export class TrackerError extends Error {
  readonly code: TrackerErrorCode

  /**
   * @param code - 客户端可据以给出操作提示的错误码。
   * @param message - 面向用户的失败原因。
   * @param options - 原始错误，保留调用链。
   */
  constructor(code: TrackerErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'TrackerError'
    this.code = code
  }
}

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
