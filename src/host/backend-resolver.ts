/**
 * 宿主内部的后端解析器：读 `git remote -v`，必要时读 `glab auth status`
 * 与 `tea logins list`，调 core 的纯函数选择后端，再按结果构造对应 Tracker。
 *
 * 解析结果按工作区根目录缓存：刷新不会反复探测命令行工具；解析失败时不缓存，
 * 装好工具后可以直接重试。日志里只记后端类型，不记命令输出。
 */
import { createGiteaTracker } from '../adapters/gitea/tracker.ts'
import { createGithubTracker } from '../adapters/github/tracker.ts'
import { createGitlabTracker } from '../adapters/gitlab/tracker.ts'
import { createNodeWorkspaceFiles, type WorkspaceFiles } from '../adapters/markdown/files.ts'
import { createMarkdownTracker } from '../adapters/markdown/tracker.ts'
import {
  chooseBackend,
  GITHUB_HOST,
  GITLAB_HOST,
  parseLoggedInHosts,
  parseTeaLoginHosts,
  type BackendChoice,
} from '../core/backend.ts'
import { parseRemotes, pickRemoteAddress, type RepositoryAddress } from '../core/remote.ts'
import type { CommandRunner, Tracker } from '../core/ticket.ts'
import { CommandError, TrackerError, isCommandNotFound } from '../core/tracker-error.ts'
import type { BackendKind } from '../protocol/backend.ts'

/** 一个工作区解析出的后端。 */
export interface ResolvedBackend {
  readonly kind: BackendKind
  readonly tracker: Tracker
  /** 后端判定依据；环境检查把它显示成 `remote:github` 这样的一行。 */
  readonly choice: BackendChoice
  /** 选中的远端地址；本地 Markdown 且没有可用远端时为 undefined。 */
  readonly address: RepositoryAddress | undefined
  /** 只能回退本地时，指出装上哪个 CLI 并登录后可用候选后端。 */
  readonly candidate?: BackendCandidate
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

/** 一套命令行登录状态的探测结果。 */
interface CliLoginState {
  readonly installed: boolean
  readonly hosts: readonly string[]
}

/**
 * 远端无法判定为托管后端时，差哪一步才能用上候选后端。
 * 环境检查据此点名具体工具与主机，而不是只说“不支持的远端”。
 */
export interface BackendCandidate {
  readonly kind: Exclude<BackendKind, 'markdown'>
  readonly reason: 'cli-missing' | 'cli-unauthenticated'
  readonly detail: string
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
    // GitHub 不需要探测登录；其余主机先确认 glab 是否安装、登录了哪些实例。
    const glab =
      address.host === GITHUB_HOST ? undefined : await readGlabAuth(deps.run, workspaceRoot)

    // gitlab.com 上缺 glab 时不回退：明确告诉用户该装什么。
    if (glab !== undefined && !glab.installed && address.host === GITLAB_HOST) {
      throw new TrackerError(
        'glab-missing',
        '未找到 glab 命令，请先安装 GitLab CLI（https://gitlab.com/gitlab-org/cli）。',
      )
    }

    const glabHosts = glab?.hosts ?? []

    // 主机名或 glab 登录能直接定案时不必探测 tea。
    const direct = chooseBackend(address, glabHosts)
    if (direct.kind !== 'markdown') return resolved(direct)

    // GitLab 判定完之后才探测 tea：只装了一种 CLI 的工作区不会被多叫一次。
    const tea = await readTeaLogins(deps.run, workspaceRoot)
    const choice = chooseBackend(address, glabHosts, tea.hosts)
    // 工单列表仍然回退本地；环境检查据此指出装 tea / 登录实例就能用上 Gitea。
    if (choice.source === 'unsupported-remote') {
      return resolved(choice, giteaCandidate(address.host, tea))
    }
    return resolved(choice)
  }

  return {
    kind: 'markdown',
    tracker: createMarkdownTracker({ files, now: deps.now }),
    choice: { kind: 'markdown', source: 'no-remote' },
    address: undefined,
  }

  function resolved(choice: BackendChoice, candidate?: BackendCandidate): ResolvedBackend {
    const base: ResolvedBackend = {
      kind: choice.kind,
      choice,
      address,
      tracker: createTracker(choice.kind, deps, files),
    }
    return candidate === undefined ? base : { ...base, candidate }
  }
}

function giteaCandidate(host: string, tea: CliLoginState): BackendCandidate {
  return tea.installed
    ? {
        kind: 'gitea',
        reason: 'cli-unauthenticated',
        detail: `tea 未登录 ${host}`,
      }
    : {
        kind: 'gitea',
        reason: 'cli-missing',
        detail: `未找到 tea，远端 ${host} 需要 tea 才能识别为 Gitea`,
      }
}

function createTracker(
  kind: BackendKind,
  deps: BackendResolverDeps,
  files: WorkspaceFiles,
): Tracker {
  switch (kind) {
    case 'github':
      return createGithubTracker({ run: deps.run, now: deps.now })
    case 'gitlab':
      return createGitlabTracker({ run: deps.run, now: deps.now })
    case 'gitea':
      return createGiteaTracker({ run: deps.run, now: deps.now })
    case 'markdown':
      return createMarkdownTracker({ files, now: deps.now })
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

async function readGlabAuth(run: CommandRunner, workspaceRoot: string): Promise<CliLoginState> {
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

async function readTeaLogins(run: CommandRunner, workspaceRoot: string): Promise<CliLoginState> {
  try {
    const output = await run('tea', ['logins', 'list', '--output', 'json'], {
      cwd: workspaceRoot,
    })
    return { installed: true, hosts: parseTeaLoginHosts(output.stdout) }
  } catch (error) {
    // 没装 tea 时不能匹配任何实例，但“没装”与“没登录”要给用户不同建议。
    if (isCommandNotFound(error)) return { installed: false, hosts: [] }
    // 配置读不出来按未登录处理：重新登录是可执行的下一步。
    return { installed: true, hosts: [] }
  }
}
