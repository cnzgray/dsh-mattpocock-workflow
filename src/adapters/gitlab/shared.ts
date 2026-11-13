/**
 * GitLab 后端共用的小工具：识别项目路径、执行 `glab`、把命令失败翻译成带错误码的
 * `TrackerError`。列表、阻塞补齐、详情与变更四处共用一份。
 */
import { parseRemotes, pickRemoteAddress, type RepositoryAddress } from '../../core/remote.ts'
import type { CommandRunner } from '../../core/ticket.ts'
import { CommandError, TrackerError, commandFailureDetail } from '../../core/tracker-error.ts'
import { encodeProjectPath } from './parse.ts'

/**
 * 读取工作区 `origin` 并取出项目地址（路径与实例主机）。
 * @param run - 命令执行器。
 * @param workspaceRoot - 工作区根目录。
 * @returns 含嵌套 group 的路径与实例主机。
 * @throws {TrackerError} git 失败或远端无法识别。
 */
export async function readProjectAddress(
  run: CommandRunner,
  workspaceRoot: string,
): Promise<RepositoryAddress> {
  let output: string
  try {
    output = (await run('git', ['remote', '-v'], { cwd: workspaceRoot })).stdout
  } catch (error) {
    throw new TrackerError('fetch-failed', '读取 git 远端失败，无法识别 GitLab 项目。', {
      cause: error,
    })
  }

  const address = pickRemoteAddress(parseRemotes(output))
  if (address === undefined) {
    throw new TrackerError('fetch-failed', '当前仓库的 origin 不是可识别的 GitLab 远端。')
  }
  return { path: address.path, host: address.host }
}

/**
 * 读取工作区 `origin` 并只取出项目路径。
 * @param run - 命令执行器。
 * @param workspaceRoot - 工作区根目录。
 * @returns 含嵌套 group 的项目路径。
 * @throws {TrackerError} git 失败或远端无法识别。
 */
export async function readProjectPath(run: CommandRunner, workspaceRoot: string): Promise<string> {
  return (await readProjectAddress(run, workspaceRoot)).path
}

/**
 * 请求一个 GitLab REST 接口。
 * @param run - 命令执行器。
 * @param workspaceRoot - 工作区根目录，作为 cwd。
 * @param endpoint - 以 `projects/...` 开头的接口路径。
 * @returns 标准输出。
 * @throws {TrackerError} 失败时按缺 CLI / 未登录 / 其他错误映射。
 */
export async function callGlabApi(
  run: CommandRunner,
  workspaceRoot: string,
  endpoint: string,
): Promise<string> {
  return callGlab(run, workspaceRoot, ['api', endpoint])
}

/**
 * 执行一条 `glab` 命令并返回标准输出。
 * @param run - 命令执行器。
 * @param workspaceRoot - 工作区根目录，作为 cwd。
 * @param args - `glab` 参数。
 * @returns 标准输出。
 * @throws {TrackerError} 失败时按缺 CLI / 未登录 / 其他错误映射。
 */
export async function callGlab(
  run: CommandRunner,
  workspaceRoot: string,
  args: readonly string[],
): Promise<string> {
  try {
    return (await run('glab', args, { cwd: workspaceRoot })).stdout
  } catch (error) {
    throw mapGlabError(error)
  }
}

/** 项目接口前缀：`projects/<URL 编码的完整路径>`。 */
export function projectEndpoint(project: string): string {
  return `projects/${encodeProjectPath(project)}`
}

/**
 * 把 `glab` 的失败翻译成协议错误码。
 * @param error - 命令执行失败。
 * @returns 带稳定错误码的 `TrackerError`。
 */
export function mapGlabError(error: unknown): TrackerError {
  if (error instanceof CommandError) {
    if (error.kind === 'not-found') {
      return new TrackerError(
        'glab-missing',
        '未找到 glab 命令，请先安装 GitLab CLI（https://gitlab.com/gitlab-org/cli）。',
        { cause: error },
      )
    }
    if (isAuthenticationFailure(error.stderr)) {
      return new TrackerError(
        'glab-unauthenticated',
        'glab 未登录或令牌已失效，请运行 glab auth login。',
        { cause: error },
      )
    }
    return new TrackerError(
      'fetch-failed',
      `读取 GitLab 工单失败：${commandFailureDetail(error)}`,
      {
        cause: error,
      },
    )
  }
  return new TrackerError('fetch-failed', '读取 GitLab 工单失败。', { cause: error })
}

function isAuthenticationFailure(stderr: string): boolean {
  return /glab auth login|not logged in|no token|token.*(?:expired|invalid)|authentication failed|bad credentials|HTTP 401|Unauthorized/i.test(
    stderr,
  )
}
