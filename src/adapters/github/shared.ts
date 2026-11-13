/**
 * GitHub 后端共用的小工具：识别 `origin`、执行 `gh`、把命令失败翻译成带错误码的
 * `TrackerError`。列表、详情与变更三处共用一份，错误文案不会各写一遍。
 */
import { GITHUB_HOST } from '../../core/backend.ts'
import { parseRemotes, pickRemoteAddress } from '../../core/remote.ts'
import type { CommandRunner } from '../../core/ticket.ts'
import { CommandError, TrackerError, commandFailureDetail } from '../../core/tracker-error.ts'

/** GitHub 仓库的 owner 与 name。 */
export interface GithubRepository {
  readonly owner: string
  readonly name: string
}

const SEGMENT = /^[A-Za-z0-9_.-]+$/

/**
 * 读取工作区 `origin` 并拆成 owner/name。
 * @param run - 命令执行器。
 * @param workspaceRoot - 工作区根目录。
 * @returns 仓库标识。
 * @throws {TrackerError} git 失败或远端不是 GitHub。
 */
export async function readRepository(
  run: CommandRunner,
  workspaceRoot: string,
): Promise<GithubRepository> {
  let output: string
  try {
    output = (await run('git', ['remote', '-v'], { cwd: workspaceRoot })).stdout
  } catch (error) {
    throw mapGitError(error)
  }

  const address = pickRemoteAddress(parseRemotes(output))
  if (address?.host !== GITHUB_HOST) {
    throw new TrackerError('fetch-failed', '当前仓库的 origin 不是 GitHub 远端。')
  }

  const segments = address.path.split('/')
  const owner = segments[0]
  const name = segments[1]
  if (segments.length !== 2 || owner === undefined || name === undefined) {
    throw new TrackerError('fetch-failed', 'GitHub 远端地址无法识别 owner/name。')
  }
  if (!SEGMENT.test(owner) || !SEGMENT.test(name)) {
    throw new TrackerError('fetch-failed', 'GitHub 远端地址无法识别 owner/name。')
  }

  return { owner, name }
}

/**
 * 执行一条 `gh` 命令并返回标准输出。
 * @param run - 命令执行器。
 * @param workspaceRoot - 工作区根目录，作为 cwd。
 * @param args - `gh` 参数。
 * @returns 标准输出。
 * @throws {TrackerError} 失败时按缺 CLI / 未登录 / 其他错误映射。
 */
export async function callGh(
  run: CommandRunner,
  workspaceRoot: string,
  args: readonly string[],
): Promise<string> {
  try {
    return (await run('gh', args, { cwd: workspaceRoot })).stdout
  } catch (error) {
    throw mapGhError(error)
  }
}

/** 仓库显示名：`owner/name`。 */
export function repositoryLabel(repository: GithubRepository): string {
  return `${repository.owner}/${repository.name}`
}

function mapGitError(error: unknown): TrackerError {
  if (error instanceof CommandError) {
    if (error.kind === 'not-found') {
      return new TrackerError('fetch-failed', '未找到 git 命令，无法识别仓库。', { cause: error })
    }
    return new TrackerError('fetch-failed', `读取 git 远端失败：${commandFailureDetail(error)}`, {
      cause: error,
    })
  }
  return new TrackerError('fetch-failed', '读取 git 远端失败。', { cause: error })
}

/**
 * 把 `gh` 的失败翻译成协议错误码。
 * @param error - 命令执行失败。
 * @returns 带稳定错误码的 `TrackerError`。
 */
export function mapGhError(error: unknown): TrackerError {
  if (error instanceof CommandError) {
    if (error.kind === 'not-found') {
      return new TrackerError(
        'gh-missing',
        '未找到 gh 命令，请先安装 GitHub CLI（https://cli.github.com）。',
        { cause: error },
      )
    }
    if (isAuthenticationFailure(error.stderr)) {
      return new TrackerError('gh-unauthenticated', 'gh 未登录，请运行 gh auth login。', {
        cause: error,
      })
    }
    return new TrackerError('fetch-failed', `读取工单失败：${commandFailureDetail(error)}`, {
      cause: error,
    })
  }
  return new TrackerError('fetch-failed', '读取工单失败。', { cause: error })
}

function isAuthenticationFailure(stderr: string): boolean {
  return /gh auth login|not logged in|authentication failed|bad credentials|HTTP 401|requires authentication/i.test(
    stderr,
  )
}
