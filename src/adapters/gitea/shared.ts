/**
 * Gitea 后端共用的小工具：识别 owner/name、执行 `tea`、把命令失败翻译成带错误码的
 * `TrackerError`。列表、依赖、详情与变更共用一份。
 */
import { parseRemotes, pickRemoteAddress } from '../../core/remote.ts'
import type { CommandRunner } from '../../core/ticket.ts'
import { CommandError, TrackerError, commandFailureDetail } from '../../core/tracker-error.ts'
import { parseApiResponse, type ApiResponse } from './parse.ts'

/** Gitea 仓库的 owner 与 name。 */
export interface GiteaRepository {
  readonly owner: string
  readonly name: string
}

const SEGMENT = /^[A-Za-z0-9_.-]+$/
const AUTH_FAILURE =
  /tea login add|not logged in|no token|token.*(?:expired|invalid)|authentication failed|bad credentials|HTTP 401|HTTP 403|Unauthorized|Forbidden/i

/**
 * 读取工作区 `origin` 并拆成 owner/name。
 * @param run - 命令执行器。
 * @param workspaceRoot - 工作区根目录。
 * @returns 仓库标识。
 * @throws {TrackerError} git 失败或远端无法识别。
 */
export async function readRepository(
  run: CommandRunner,
  workspaceRoot: string,
): Promise<GiteaRepository> {
  let output: string
  try {
    output = (await run('git', ['remote', '-v'], { cwd: workspaceRoot })).stdout
  } catch (error) {
    throw new TrackerError('fetch-failed', '读取 git 远端失败，无法识别 Gitea 仓库。', {
      cause: error,
    })
  }

  const address = pickRemoteAddress(parseRemotes(output))
  if (address === undefined) {
    throw new TrackerError('fetch-failed', '当前仓库的 origin 不是可识别的 Gitea 远端。')
  }

  const segments = address.path.split('/')
  const owner = segments[0]
  const name = segments[1]
  // Gitea 只有 owner/name 两层，子路径不是合法仓库地址。
  if (segments.length !== 2 || owner === undefined || name === undefined) {
    throw new TrackerError('fetch-failed', 'Gitea 远端地址无法识别 owner/name。')
  }
  if (!SEGMENT.test(owner) || !SEGMENT.test(name)) {
    throw new TrackerError('fetch-failed', 'Gitea 远端地址无法识别 owner/name。')
  }

  return { owner, name }
}

/**
 * 请求一个 Gitea REST 接口。
 * @param run - 命令执行器。
 * @param workspaceRoot - 工作区根目录，作为 cwd。
 * @param endpoint - 以 `/repos/...` 或 `/user` 开头的接口路径。
 * @param method - 可选的 HTTP 方法；省略时沿用 tea 的默认 GET。
 * @returns 状态码、总条数与响应体。
 * @throws {TrackerError} 命令失败。
 */
export async function callGiteaApi(
  run: CommandRunner,
  workspaceRoot: string,
  endpoint: string,
  method?: 'GET' | 'DELETE',
): Promise<ApiResponse> {
  try {
    const args =
      method === undefined
        ? ['api', '--include', endpoint]
        : ['api', '--include', '--method', method, endpoint]
    const output = await run('tea', args, { cwd: workspaceRoot })
    return parseApiResponse(output.stdout, output.stderr)
  } catch (error) {
    throw mapTeaError(error)
  }
}

/**
 * 非 2xx 响应按状态码翻译。
 * @param response - 一次 API 调用。
 * @param action - 失败文案里的动作，例如「读取 Gitea 工单」。
 * @throws {TrackerError} 状态码不小于 400。
 */
export function ensureSuccess(response: ApiResponse, action: string): void {
  if (response.status < 400) return
  if (response.status === 401 || response.status === 403) {
    throw new TrackerError(
      'tea-unauthenticated',
      'tea 未登录该实例或令牌已失效，请运行 tea login add。',
    )
  }
  throw new TrackerError(
    'fetch-failed',
    `${action}失败：Gitea 返回 HTTP ${String(response.status)}。`,
  )
}

/**
 * 执行一条 `tea` 命令并返回标准输出。
 * @param run - 命令执行器。
 * @param workspaceRoot - 工作区根目录，作为 cwd。
 * @param args - `tea` 参数。
 * @returns 标准输出。
 * @throws {TrackerError} 失败时按缺 CLI / 未登录 / 其他错误映射。
 */
export async function callTea(
  run: CommandRunner,
  workspaceRoot: string,
  args: readonly string[],
): Promise<string> {
  try {
    return (await run('tea', args, { cwd: workspaceRoot })).stdout
  } catch (error) {
    throw mapTeaError(error)
  }
}

/**
 * 把 `tea` 的失败翻译成协议错误码。
 * @param error - 命令执行失败。
 * @returns 带稳定错误码的 `TrackerError`。
 */
export function mapTeaError(error: unknown): TrackerError {
  if (error instanceof CommandError) {
    if (error.kind === 'not-found') {
      return new TrackerError(
        'tea-missing',
        '未找到 tea 命令，请先安装 Gitea CLI（https://gitea.com/gitea/tea）。',
        { cause: error },
      )
    }
    if (AUTH_FAILURE.test(error.stderr)) {
      return new TrackerError(
        'tea-unauthenticated',
        'tea 未登录该实例或令牌已失效，请运行 tea login add。',
        { cause: error },
      )
    }
    return new TrackerError('fetch-failed', `读取 Gitea 工单失败：${commandFailureDetail(error)}`, {
      cause: error,
    })
  }
  return new TrackerError('fetch-failed', '读取 Gitea 工单失败。', { cause: error })
}
