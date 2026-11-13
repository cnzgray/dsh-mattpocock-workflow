/**
 * GitHub 的环境探测：`gh` 是否安装、是否登录、当前仓库能否通过接口访问。
 * 只发起只读命令，不安装、不登录、不改任何文件；原始输出不进入结论。
 */
import { GITHUB_HOST, parseLoggedInHosts } from '../../core/backend.ts'
import type { EnvCommandProbe, ProbeOutcome } from '../../core/env-check.ts'
import { normalizeHost, repositorySlug } from '../../core/remote.ts'
import type { CommandRunner } from '../../core/ticket.ts'
import { CommandError, isCommandNotFound, isNetworkFailure } from '../../core/tracker-error.ts'

const AUTH_FAILURE =
  /gh auth login|not logged in|authentication failed|bad credentials|HTTP 401|requires authentication|token.*(?:expired|invalid)/i

/** 仓库不存在（GitHub 对无权限的私有仓库也返回 404）。 */
const NOT_FOUND = /HTTP 404|Not Found|could not resolve to a repository|repository not found/i

/** GitHub 环境探测依赖。 */
export interface GithubEnvProbeDeps {
  readonly run: CommandRunner
}

/**
 * 创建 GitHub 环境探测。
 * @param deps - 命令执行器。
 * @returns 满足 core `EnvCommandProbe` 的探测。
 */
export function createGithubEnvProbe(deps: GithubEnvProbeDeps): EnvCommandProbe {
  return {
    kind: 'github',
    async cli(workspaceRoot) {
      try {
        const output = await deps.run('gh', ['--version'], { cwd: workspaceRoot })
        return { status: 'pass', detail: output.executable ?? 'gh' }
      } catch (error) {
        if (isCommandNotFound(error)) {
          return { status: 'fail', detail: '未找到 gh 可执行文件', reason: 'cli-missing' }
        }
        // 版本命令失败但可执行文件存在，仍算已安装。
        return { status: 'pass', detail: 'gh' }
      }
    },
    async auth(workspaceRoot, remote) {
      // 只核对当前远端对应的主机：其他主机未登录时 gh 也可能非零退出。
      const host = normalizeHost(remote?.host ?? GITHUB_HOST)
      try {
        const output = await deps.run('gh', ['auth', 'status'], { cwd: workspaceRoot })
        const hosts = parseLoggedInHosts(`${output.stdout}\n${output.stderr}`)
        // 退出码为 0 且没有可识别行时按已登录处理：旧版本的提示语可能不同。
        if (hosts.length === 0 || hosts.includes(host)) {
          return { status: 'pass', detail: '已登录' }
        }
        return { status: 'fail', detail: `未登录 ${host}`, reason: 'cli-unauthenticated' }
      } catch (error) {
        if (isCommandNotFound(error)) {
          return { status: 'fail', detail: '未找到 gh 可执行文件', reason: 'cli-missing' }
        }
        const hosts = error instanceof CommandError ? parseLoggedInHosts(error.stderr) : []
        if (hosts.includes(host)) return { status: 'pass', detail: '已登录' }
        if (error instanceof CommandError && AUTH_FAILURE.test(error.stderr)) {
          return { status: 'fail', detail: '未登录或令牌已失效', reason: 'cli-unauthenticated' }
        }
        return { status: 'fail', detail: '无法确认登录状态', reason: 'cli-unauthenticated' }
      }
    },
    async repository(workspaceRoot, remote) {
      const repository = repositorySlug(remote)
      if (repository === undefined) {
        return {
          status: 'fail',
          detail: '当前远端不是 GitHub 仓库',
          reason: 'repository-forbidden',
        }
      }

      try {
        await deps.run('gh', ['api', `repos/${repository}`], { cwd: workspaceRoot })
        return { status: 'pass', detail: `可访问 ${repository}` }
      } catch (error) {
        return repositoryFailure(error)
      }
    },
  }
}

function repositoryFailure(error: unknown): ProbeOutcome {
  if (isCommandNotFound(error)) {
    return { status: 'fail', detail: '未找到 gh 可执行文件', reason: 'cli-missing' }
  }
  if (error instanceof CommandError) {
    if (isNetworkFailure(error.stderr)) {
      return { status: 'fail', detail: '网络不可达或请求超时', reason: 'repository-network' }
    }
    if (NOT_FOUND.test(error.stderr)) {
      return {
        status: 'fail',
        detail: '仓库不存在，或当前账号无权访问',
        reason: 'repository-not-found',
      }
    }
    if (AUTH_FAILURE.test(error.stderr)) {
      return { status: 'fail', detail: '令牌已失效', reason: 'cli-unauthenticated' }
    }
  }
  return { status: 'fail', detail: '没有访问权限或仓库不存在', reason: 'repository-forbidden' }
}
