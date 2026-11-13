/**
 * GitLab 工单后端：通过注入的 {@link CommandRunner} 调用 `git` 与 `glab`。
 *
 * - 仓库标识来自 core 的远端解析，API 里用完整路径的 URL 编码形式寻址，
 *   不依赖当前目录的默认项目推断；
 * - 只读 issue 接口，merge request 不会混进来；
 * - 首屏只列票，阻塞数先按描述里的 `Blocked by:` 回退；原生阻塞数在
 *   `resolveBlockers` 补齐阶段读取，能力探测不占首屏时间；
 * - 列表响应带 `blocking_issues_count` 时直接判定实例支持原生阻塞；
 *   否则按实例主机只探测一次：一次 `/issues/:iid/links` 返回
 *   `200` + 空数组、`403`/`404` 或异常都判定为不支持，之后只用描述里的
 *   `Blocked by:` 回退，不再逐票试探；
 * - 支持的实例用一次批量 GraphQL 查询取回所有开放票的 `blockedByCount`，
 *   不逐票请求 links。
 */
import { hasDescriptionBlockers, resolveOpenBlockers } from '../../core/blocked-by.ts'
import { parseRemotes, pickRemoteAddress, type RepositoryAddress } from '../../core/remote.ts'
import type {
  BlockerTarget,
  CommandRunner,
  Ticket,
  TicketState,
  Tracker,
  TrackerSnapshot,
} from '../../core/ticket.ts'
import { CommandError, TrackerError, commandFailureDetail } from '../../core/tracker-error.ts'
import {
  encodeProjectPath,
  hasNativeBlockingLinks,
  parseBlockedByCounts,
  parseIssuesPage,
  type ParsedIssue,
} from './parse.ts'

/** GitLab 后端依赖。 */
export interface GitlabTrackerDeps {
  readonly run: CommandRunner
  readonly now: () => number
  /** 单页大小；默认 100，测试可以调小以便构造分页。 */
  readonly pageSize?: number
  /**
   * 原生阻塞能力探测缓存，键为实例主机。生产环境由后端解析器共享，
   * 同一实例上的多个工作区只探测一次；单独创建 tracker 时默认各自一份。
   */
  readonly blockerCapability?: Map<string, Promise<boolean>>
}

const DEFAULT_PAGE_SIZE = 100
/** GraphQL 的 `first` 上限；开放票更多时分批查询。 */
const BLOCKER_COUNT_BATCH = 100

/**
 * 创建 GitLab 工单后端。
 * @param deps - 命令执行器、时钟与可选的页大小、能力探测缓存。
 * @returns 满足 core `Tracker` 契约的后端。
 */
export function createGitlabTracker(deps: GitlabTrackerDeps): Tracker {
  const pageSize = normalizePositive(deps.pageSize ?? DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE)
  const blockerCapability = deps.blockerCapability ?? new Map<string, Promise<boolean>>()

  // 最近一次列表留下的探测线索，供补齐阶段选探测票；键为工作区根目录。
  const hints = new Map<string, BlockerHint>()

  return {
    async fetchSnapshot(workspaceRoot: string): Promise<TrackerSnapshot> {
      const project = await readProject(deps, workspaceRoot)
      const issues = await readIssues(deps, workspaceRoot, project.path, pageSize)
      const states = new Map<number, TicketState>()
      for (const issue of issues) {
        if (issue.ticket.number !== null) states.set(issue.ticket.number, issue.ticket.state)
      }
      hints.set(workspaceRoot, blockerHint(project, issues))

      // 首屏只等列表：阻塞数先按描述回退，原生计数留给补齐阶段。
      const tickets = issues.map((issue) => withOpenBlockers(issue, states))

      return {
        repository: project.path,
        fetchedAt: deps.now(),
        loaded: tickets.length,
        total: tickets.length,
        tickets,
      }
    },

    async resolveBlockers(workspaceRoot, targets) {
      const open = targets.filter(
        (target): target is BlockerTarget & { readonly number: number } => target.number !== null,
      )
      if (open.length === 0) return new Map()

      const hint = hints.get(workspaceRoot) ?? {
        project: await readProject(deps, workspaceRoot),
        listSupportsNative: false,
        probeTarget: null,
      }
      const supported = await ensureNativeBlockingSupport(
        deps,
        blockerCapability,
        workspaceRoot,
        hint,
        open,
      )
      if (!supported) return new Map()

      const counts = await readBlockedByCounts(deps, workspaceRoot, hint.project.path, open)
      const native = new Map<string, number>()
      for (const target of open) {
        const count = counts.get(target.number)
        if (count !== undefined) native.set(target.ref, count)
      }
      return native
    },
  }
}

/** 列表阶段为补齐阶段留下的线索：项目地址、列表是否已表明支持、优先探测哪张票。 */
interface BlockerHint {
  readonly project: RepositoryAddress
  readonly listSupportsNative: boolean
  readonly probeTarget: number | null
}

function blockerHint(project: RepositoryAddress, issues: readonly ParsedIssue[]): BlockerHint {
  const open = issues.filter(
    (issue) => issue.ticket.state === 'open' && issue.ticket.number !== null,
  )
  // 优先选正文里写了 `Blocked by:` 的票：支持原生阻塞的实例上，这类票更可能已经有 blocking link。
  const described = open.find((issue) => hasDescriptionBlockers(issue.description))
  return {
    project,
    listSupportsNative: open.some((issue) => issue.hasBlockingIssuesCount),
    probeTarget: (described ?? open[0])?.ticket.number ?? null,
  }
}

async function readProject(
  deps: GitlabTrackerDeps,
  workspaceRoot: string,
): Promise<RepositoryAddress> {
  let output: string
  try {
    output = (await deps.run('git', ['remote', '-v'], { cwd: workspaceRoot })).stdout
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

async function readIssues(
  deps: GitlabTrackerDeps,
  workspaceRoot: string,
  project: string,
  pageSize: number,
): Promise<ParsedIssue[]> {
  const issues: ParsedIssue[] = []

  for (let page = 1; ; page += 1) {
    const endpoint = issuesEndpoint(project, pageSize, page)
    let output: string
    try {
      output = (await deps.run('glab', ['api', endpoint], { cwd: workspaceRoot })).stdout
    } catch (error) {
      throw mapGlabError(error)
    }

    const parsed = parseIssuesPage(output)
    issues.push(...parsed)
    if (parsed.length < pageSize) return issues
  }
}

/**
 * 保证同一实例主机只探测一次。探测结果（包括失败）都写入缓存，
 * 后续刷新直接复用，不再请求 links。
 */
async function ensureNativeBlockingSupport(
  deps: GitlabTrackerDeps,
  blockerCapability: Map<string, Promise<boolean>>,
  workspaceRoot: string,
  hint: BlockerHint,
  open: readonly (BlockerTarget & { readonly number: number })[],
): Promise<boolean> {
  const host = hint.project.host
  const cached = blockerCapability.get(host)
  if (cached !== undefined) return cached

  // 列表自带 blocking_issues_count 说明实例是 EE：无需再花一次 links 请求探测。
  if (hint.listSupportsNative) {
    const supported = Promise.resolve(true)
    blockerCapability.set(host, supported)
    return supported
  }

  const target = hint.probeTarget ?? open[0]?.number ?? null
  const pending = probeNativeBlockingSupport(deps, workspaceRoot, hint.project.path, target)
  blockerCapability.set(host, pending)
  return pending
}

/**
 * 一次探测请求。空数组、403/404 与异常都判定为不支持，不再重试，
 * 也不逐票试探。
 */
async function probeNativeBlockingSupport(
  deps: GitlabTrackerDeps,
  workspaceRoot: string,
  project: string,
  target: number | null,
): Promise<boolean> {
  if (target === null) return false

  try {
    const endpoint = `${projectEndpoint(project)}/issues/${String(target)}/links`
    const output = (await deps.run('glab', ['api', endpoint], { cwd: workspaceRoot })).stdout
    return hasNativeBlockingLinks(output)
  } catch {
    return false
  }
}

/**
 * 分批读取开放票的 `blockedByCount`。GraphQL 的 `first` 上限是 100，
 * 开放票更多时按 100 一批查询，仍然不产生逐票请求。
 */
async function readBlockedByCounts(
  deps: GitlabTrackerDeps,
  workspaceRoot: string,
  project: string,
  open: readonly (BlockerTarget & { readonly number: number })[],
): Promise<ReadonlyMap<number, number>> {
  const counts = new Map<number, number>()

  for (let start = 0; start < open.length; start += BLOCKER_COUNT_BATCH) {
    const batch = open.slice(start, start + BLOCKER_COUNT_BATCH)
    const iids = batch.map((target) => `"${String(target.number)}"`).join(', ')
    const query = `query ($project: ID!) { project(fullPath: $project) { issues(iids: [${iids}], first: ${String(batch.length)}) { nodes { iid blockedByCount } } } }`
    const output = (
      await deps.run(
        'glab',
        ['api', 'graphql', '-f', `query=${query}`, '-f', `project=${project}`],
        { cwd: workspaceRoot },
      )
    ).stdout

    for (const [iid, count] of parseBlockedByCounts(output)) counts.set(iid, count)
  }
  return counts
}

function withOpenBlockers(issue: ParsedIssue, states: ReadonlyMap<number, TicketState>): Ticket {
  return {
    ...issue.ticket,
    openBlockers: resolveOpenBlockers({
      ticket: issue.ticket,
      nativeBlockers: undefined,
      text: issue.description,
      states,
    }),
  }
}

function mapGlabError(error: unknown): TrackerError {
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

function issuesEndpoint(project: string, pageSize: number, page: number): string {
  return `${projectEndpoint(project)}/issues?state=all&per_page=${String(pageSize)}&page=${String(page)}`
}

function projectEndpoint(project: string): string {
  return `projects/${encodeProjectPath(project)}`
}

function normalizePositive(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(1, Math.trunc(value))
}
