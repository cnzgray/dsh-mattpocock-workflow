/**
 * GitLab 的环境探测：`glab` 是否安装、是否登录当前远端对应的实例、
 * 当前项目能否通过只读接口访问。原始输出不进入结论。
 */
import { parseLoggedInHosts } from '../../core/backend.ts'
import type { EnvCommandProbe, ProbeOutcome } from '../../core/env-check.ts'
import { normalizeHost } from '../../core/remote.ts'
import type { CommandRunner } from '../../core/ticket.ts'
import { CommandError, isCommandNotFound, isNetworkFailure } from '../../core/tracker-error.ts'
import { encodeProjectPath } from './parse.ts'

const AUTH_FAILURE = /glab auth login|not logged in|no token|token.*(?:expired|invalid)|HTTP 401/i

/** 项目不存在（GitLab 对无权限的私有项目也返回 404）。 */
const NOT_FOUND = /HTTP 404|404 Not Found|Project Not Found|project not found/i

/** GitLab 环境探测依赖。 */
export interface GitlabEnvProbeDeps {
  readonly run: CommandRunner
}

/**
 * 创建 GitLab 环境探测。
 * @param deps - 命令执行器。
 * @returns 满足 core `EnvCommandProbe` 的探测。
 */
export function createGitlabEnvProbe(deps: GitlabEnvProbeDeps): EnvCommandProbe {
  return {
    kind: 'gitlab',
    async cli(workspaceRoot) {
      try {
        const output = await deps.run('glab', ['--version'], { cwd: workspaceRoot })
        return { status: 'pass', detail: output.executable ?? 'glab' }
      } catch (error) {
        if (isCommandNotFound(error)) {
          return { status: 'fail', detail: '未找到 glab 可执行文件', reason: 'cli-missing' }
        }
        return { status: 'pass', detail: 'glab' }
      }
    },
    async auth(workspaceRoot, remote) {
      if (remote === undefined) {
        return { status: 'fail', detail: '没有可核对的 GitLab 远端', reason: 'cli-unauthenticated' }
      }

      const host = normalizeHost(remote.host)
      let output: string
      try {
        const result = await deps.run('glab', ['auth', 'status'], { cwd: workspaceRoot })
        // glab 把文本报告写在标准错误上；不同版本也可能写标准输出，两边都认。
        output = `${result.stdout}\n${result.stderr}`
      } catch (error) {
        if (isCommandNotFound(error)) {
          return { status: 'fail', detail: '未找到 glab 可执行文件', reason: 'cli-missing' }
        }
        output = error instanceof CommandError ? error.stderr : ''
      }

      const hosts = parseLoggedInHosts(output)
      if (!hosts.includes(host)) {
        return { status: 'fail', detail: `未登录 ${host}`, reason: 'cli-unauthenticated' }
      }
      return { status: 'pass', detail: `已登录 ${host}` }
    },
    async repository(workspaceRoot, remote) {
      if (remote === undefined) {
        return {
          status: 'fail',
          detail: '当前远端不是 GitLab 项目',
          reason: 'repository-forbidden',
        }
      }

      try {
        const endpoint = `projects/${encodeProjectPath(remote.path)}`
        await deps.run('glab', ['api', endpoint], { cwd: workspaceRoot })
        return { status: 'pass', detail: `可访问 ${remote.path}` }
      } catch (error) {
        return repositoryFailure(error)
      }
    },
  }
}

function repositoryFailure(error: unknown): ProbeOutcome {
  if (isCommandNotFound(error)) {
    return { status: 'fail', detail: '未找到 glab 可执行文件', reason: 'cli-missing' }
  }
  if (error instanceof CommandError) {
    if (isNetworkFailure(error.stderr)) {
      return { status: 'fail', detail: '网络不可达或请求超时', reason: 'repository-network' }
    }
    if (NOT_FOUND.test(error.stderr)) {
      return {
        status: 'fail',
        detail: '项目不存在，或当前账号无权访问',
        reason: 'repository-not-found',
      }
    }
    if (AUTH_FAILURE.test(error.stderr)) {
      return { status: 'fail', detail: '令牌已失效', reason: 'cli-unauthenticated' }
    }
  }
  return { status: 'fail', detail: '没有访问权限或仓库不存在', reason: 'repository-forbidden' }
}
