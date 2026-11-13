/**
 * 宿主内部的后端解析器：读 `git remote -v`，必要时读 `glab auth status`，
 * 调 core 的纯函数选择后端，再按结果构造对应 Tracker。
 *
 * 解析结果按工作区根目录缓存：刷新不会反复探测 `glab`；解析失败时不缓存，
 * 装好 `glab` 后可以直接重试。日志里只记后端类型，不记命令输出。
 */
import { createGithubTracker } from '../adapters/github/tracker.ts'
import { createGitlabTracker } from '../adapters/gitlab/tracker.ts'
import { createNodeWorkspaceFiles, type WorkspaceFiles } from '../adapters/markdown/files.ts'
import { createMarkdownTracker } from '../adapters/markdown/tracker.ts'
import {
  chooseBackend,
  GITHUB_HOST,
  GITLAB_HOST,
  parseLoggedInHosts,
  type BackendChoice,
} from '../core/backend.ts'
import { parseRemotes, pickRemoteAddress, type RepositoryAddress } from '../core/remote.ts'
import type { CommandRunner, Tracker } from '../core/ticket.ts'
import { CommandError, TrackerError } from '../core/tracker-error.ts'
import type { BackendKind } from '../protocol/backend.ts'

/** 一个工作区解析出的后端。 */
export interface ResolvedBackend {
  readonly kind: BackendKind
  readonly tracker: Tracker
  /** 后端判定依据；环境检查把它显示成 `remote:github` 这样的一行。 */
  readonly choice: BackendChoice
  /** 选中的远端地址；本地 Markdown 且没有可用远端时为 undefined。 */
  readonly address: RepositoryAddress | undefined
}

/** 按工作区根目录解析后端；失败时抛 {@link TrackerError}。 */
export type BackendResolver = (workspaceRoot: string) => Promise<ResolvedBackend>

/** 后端解析器依赖。 */
export interface BackendResolverDeps {
  readonly run: CommandRunner
  readonly now: () => number
  /** 本地 Markdown 的文件读取能力；正式代码默认用 `node:fs`。 */
  readonly files?: WorkspaceFiles
  /**
   * 是否按工作区缓存解析结果。快照要缓存，环境检查不要：用户刚装好 `glab`
   * 或刚加上远端时，「重新检查」必须重新探测。
   */
  readonly cache?: boolean
}

/** `glab auth status` 的探测结果。 */
interface GlabAuth {
  readonly installed: boolean
  readonly hosts: readonly string[]
}

/**
 * 创建后端解析器。默认按工作区缓存结果；`cache: false` 时每次重新探测。
 * @param deps - 命令执行器、时钟与可选的本地文件读取能力。
 * @returns 后端解析函数。
 */
export function createBackendResolver(deps: BackendResolverDeps): BackendResolver {
  const files = deps.files ?? createNodeWorkspaceFiles()
  if (deps.cache === false) return (workspaceRoot) => resolveBackend(deps, files, workspaceRoot)

  const cache = new Map<string, Promise<ResolvedBackend>>()

  return (workspaceRoot) => {
    const cached = cache.get(workspaceRoot)
    if (cached !== undefined) return cached

    const pending = resolveBackend(deps, files, workspaceRoot)
    cache.set(workspaceRoot, pending)
    // 解析失败（例如 glab 还没装）不缓存，刷新时可以重新探测。
    void pending.catch(() => {
      cache.delete(workspaceRoot)
    })
    return pending
  }
}

async function resolveBackend(
  deps: BackendResolverDeps,
  files: WorkspaceFiles,
  workspaceRoot: string,
): Promise<ResolvedBackend> {
  const address = await readAddress(deps.run, workspaceRoot)

  if (address !== undefined) {
    // GitHub 不需要探测 glab；其余主机先确认 glab 是否安装、登录了哪些实例。
    const auth =
      address.host === GITHUB_HOST ? undefined : await readGlabAuth(deps.run, workspaceRoot)

    // gitlab.com 上缺 glab 时不回退：明确告诉用户该装什么。
    if (auth !== undefined && !auth.installed && address.host === GITLAB_HOST) {
      throw new TrackerError(
        'glab-missing',
        '未找到 glab 命令，请先安装 GitLab CLI（https://gitlab.com/gitlab-org/cli）。',
      )
    }

    const choice = chooseBackend(address, auth?.hosts ?? [])
    switch (choice.kind) {
      case 'github':
        return {
          kind: 'github',
          tracker: createGithubTracker({ run: deps.run, now: deps.now }),
          choice,
          address,
        }
      case 'gitlab':
        return {
          kind: 'gitlab',
          tracker: createGitlabTracker({ run: deps.run, now: deps.now }),
          choice,
          address,
        }
      case 'markdown':
        return {
          kind: 'markdown',
          tracker: createMarkdownTracker({ files, now: deps.now }),
          choice,
          address,
        }
    }
  }

  return {
    kind: 'markdown',
    tracker: createMarkdownTracker({ files, now: deps.now }),
    choice: { kind: 'markdown', source: 'no-remote' },
    address: undefined,
  }
}

async function readAddress(
  run: CommandRunner,
  workspaceRoot: string,
): Promise<RepositoryAddress | undefined> {
  try {
    const output = (await run('git', ['remote', '-v'], { cwd: workspaceRoot })).stdout
    return pickRemoteAddress(parseRemotes(output))
  } catch {
    // 没有 git、不是仓库、读不到远端，都按“没有远端”处理，交给本地 Markdown。
    return undefined
  }
}

async function readGlabAuth(run: CommandRunner, workspaceRoot: string): Promise<GlabAuth> {
  try {
    const output = await run('glab', ['auth', 'status'], { cwd: workspaceRoot })
    // glab 把文本报告写在标准错误上；不同版本也可能写标准输出，两边都认。
    return {
      installed: true,
      hosts: parseLoggedInHosts(`${output.stdout}\n${output.stderr}`),
    }
  } catch (error) {
    if (error instanceof CommandError) {
      if (error.kind === 'not-found') return { installed: false, hosts: [] }
      // 部分主机未登录时 glab 以非零退出；标准错误里仍可能有已登录主机。
      return { installed: true, hosts: parseLoggedInHosts(error.stderr) }
    }
    return { installed: true, hosts: [] }
  }
}
