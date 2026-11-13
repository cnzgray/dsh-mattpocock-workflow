/**
 * Gitea 的环境探测：`tea` 是否安装、是否登录当前远端实例、
 * 当前仓库能否通过只读接口访问。原始输出不进入结论。
 *
 * 登录列表的调用方式与解析复用后端判定那一份；仓库访问与工单后端一样
 * 走 `tea api --include`，状态码从标准错误里读。
 */
import { parseTeaLoginHosts } from '../../core/backend.ts'
import type { EnvCommandProbe, ProbeOutcome } from '../../core/env-check.ts'
import { normalizeHost, repositorySlug } from '../../core/remote.ts'
import type { CommandRunner } from '../../core/ticket.ts'
import { CommandError, isCommandNotFound, isNetworkFailure } from '../../core/tracker-error.ts'
import { parseApiResponse, type ApiResponse } from './parse.ts'

/** 仓库不存在（Gitea 对无权限的私有仓库也返回 404）。 */
const NOT_FOUND = /HTTP 404|404 Not Found|Not Found|repository not found/i

/** 无访问权限。 */
const FORBIDDEN = /HTTP 403|403 Forbidden|Forbidden|permission denied/i

/** 三条探测共用的未安装结论。 */
const TEA_MISSING = '未找到 tea 可执行文件'

/** 未登录或令牌失效。 */
const AUTH_FAILURE =
  /tea login add|not logged in|no token|token.*(?:expired|invalid)|authentication failed|bad credentials|HTTP 401|Unauthorized/i

/** Gitea 环境探测依赖。 */
export interface GiteaEnvProbeDeps {
  readonly run: CommandRunner
}

/**
 * 创建 Gitea 环境探测。
 * @param deps - 命令执行器。
 * @returns 满足 core `EnvCommandProbe` 的探测。
 */
export function createGiteaEnvProbe(deps: GiteaEnvProbeDeps): EnvCommandProbe {
  return {
    kind: 'gitea',
    async cli(workspaceRoot) {
      try {
        const output = await deps.run('tea', ['--version'], { cwd: workspaceRoot })
        return { status: 'pass', detail: output.executable ?? 'tea' }
      } catch (error) {
        if (isCommandNotFound(error)) {
          return { status: 'fail', detail: TEA_MISSING, reason: 'cli-missing' }
        }
        // 版本命令失败但可执行文件存在，仍算已安装。
        return { status: 'pass', detail: 'tea' }
      }
    },
    async auth(workspaceRoot, remote) {
      if (remote === undefined) {
        return { status: 'fail', detail: '没有可核对的 Gitea 远端', reason: 'cli-unauthenticated' }
      }

      const host = normalizeHost(remote.host)
      let output: string
      try {
        const result = await deps.run('tea', ['logins', 'list', '--output', 'json'], {
          cwd: workspaceRoot,
        })
        output = result.stdout
      } catch (error) {
        if (isCommandNotFound(error)) {
          return { status: 'fail', detail: TEA_MISSING, reason: 'cli-missing' }
        }
        // 配置读不出来时按未登录处理：重新登录是可执行的下一步。
        return { status: 'fail', detail: `未登录 ${host}`, reason: 'cli-unauthenticated' }
      }

      if (!parseTeaLoginHosts(output).includes(host)) {
        return { status: 'fail', detail: `未登录 ${host}`, reason: 'cli-unauthenticated' }
      }
      return { status: 'pass', detail: `已登录 ${host}` }
    },
    async repository(workspaceRoot, remote) {
      const repository = repositorySlug(remote)
      if (repository === undefined) {
        return {
          status: 'fail',
          detail: '当前远端不是 Gitea 仓库（需要 owner/repo 两段路径）',
          reason: 'repository-forbidden',
        }
      }

      try {
        const output = await deps.run('tea', ['api', '--include', `/repos/${repository}`], {
          cwd: workspaceRoot,
        })
        return repositoryResponse(parseApiResponse(output.stdout, output.stderr), repository)
      } catch (error) {
        return repositoryFailure(error)
      }
    },
  }
}

function repositoryResponse(response: ApiResponse, repository: string): ProbeOutcome {
  if (response.status < 400) return { status: 'pass', detail: `可访问 ${repository}` }
  if (response.status === 401) {
    return { status: 'fail', detail: '令牌已失效，请重新登录', reason: 'cli-unauthenticated' }
  }
  if (response.status === 403) {
    return { status: 'fail', detail: `无权访问 ${repository}`, reason: 'repository-forbidden' }
  }
  if (response.status === 404) {
    return { status: 'fail', detail: `仓库不存在：${repository}`, reason: 'repository-not-found' }
  }
  return {
    status: 'fail',
    detail: `Gitea 返回 HTTP ${String(response.status)}`,
    reason: 'repository-forbidden',
  }
}

function repositoryFailure(error: unknown): ProbeOutcome {
  if (isCommandNotFound(error)) {
    return { status: 'fail', detail: TEA_MISSING, reason: 'cli-missing' }
  }
  if (error instanceof CommandError) {
    if (isNetworkFailure(error.stderr)) {
      return { status: 'fail', detail: '网络不可达或请求超时', reason: 'repository-network' }
    }
    if (AUTH_FAILURE.test(error.stderr)) {
      return { status: 'fail', detail: '令牌已失效，请重新登录', reason: 'cli-unauthenticated' }
    }
    if (NOT_FOUND.test(error.stderr)) {
      return {
        status: 'fail',
        detail: '仓库不存在，或当前账号无权访问',
        reason: 'repository-not-found',
      }
    }
    if (FORBIDDEN.test(error.stderr)) {
      return { status: 'fail', detail: '没有访问权限', reason: 'repository-forbidden' }
    }
  }
  return { status: 'fail', detail: '没有访问权限或仓库不存在', reason: 'repository-forbidden' }
}
