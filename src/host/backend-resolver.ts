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
import { GITHUB_HOST, GITLAB_HOST, parseGlabAuthHosts, selectBackend } from '../core/backend.ts'
import { parseRemotes, pickRemoteAddress, type RepositoryAddress } from '../core/remote.ts'
import type { CommandRunner, Tracker } from '../core/ticket.ts'
import { CommandError, TrackerError } from '../core/tracker-error.ts'
import type { BackendKind } from '../protocol/tracker.ts'

/** 一个工作区解析出的后端。 */
export interface ResolvedBackend {
  readonly kind: BackendKind
  readonly tracker: Tracker
}

/** 按工作区根目录解析后端；失败时抛 {@link TrackerError}。 */
export type BackendResolver = (workspaceRoot: string) => Promise<ResolvedBackend>

/** 后端解析器依赖。 */
export interface BackendResolverDeps {
  readonly run: CommandRunner
  readonly now: () => number
  /** 本地 Markdown 的文件读取能力；正式代码默认用 `node:fs`。 */
  readonly files?: WorkspaceFiles
}

/** `glab auth status` 的探测结果。 */
interface GlabAuth {
  readonly installed: boolean
  readonly hosts: readonly string[]
}

/**
 * 创建按工作区缓存的后端解析器。
 * @param deps - 命令执行器、时钟与可选的本地文件读取能力。
 * @returns 后端解析函数。
 */
export function createBackendResolver(deps: BackendResolverDeps): BackendResolver {
  const files = deps.files ?? createNodeWorkspaceFiles()
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

    switch (selectBackend(address, auth?.hosts ?? [])) {
      case 'github':
        return { kind: 'github', tracker: createGithubTracker({ run: deps.run, now: deps.now }) }
      case 'gitlab':
        return { kind: 'gitlab', tracker: createGitlabTracker({ run: deps.run, now: deps.now }) }
      case 'markdown':
        break
    }
  }

  return { kind: 'markdown', tracker: createMarkdownTracker({ files, now: deps.now }) }
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
      hosts: parseGlabAuthHosts(`${output.stdout}\n${output.stderr}`),
    }
  } catch (error) {
    if (error instanceof CommandError) {
      if (error.kind === 'not-found') return { installed: false, hosts: [] }
      // 部分主机未登录时 glab 以非零退出；标准错误里仍可能有已登录主机。
      return { installed: true, hosts: parseGlabAuthHosts(error.stderr) }
    }
    return { installed: true, hosts: [] }
  }
}
