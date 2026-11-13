/**
 * GitLab 工单后端：通过注入的 {@link CommandRunner} 调用 `git` 与 `glab`。
 *
 * - 仓库标识来自 core 的远端解析，API 里用完整路径的 URL 编码形式寻址，
 *   不依赖当前目录的默认项目推断；
 * - 只读 issue 接口，merge request 不会混进来；
 * - 阻塞优先用原生 blocking link，接口报告功能不可用或无权限时
 *   退回描述顶部的 `Blocked by:` 行。
 */
import { countDescriptionBlockers } from '../../core/blocked-by.ts'
import { mapWithConcurrency } from '../../core/concurrency.ts'
import { parseRemotes, pickRemoteAddress } from '../../core/remote.ts'
import type {
  CommandRunner,
  Ticket,
  TicketState,
  Tracker,
  TrackerSnapshot,
} from '../../core/ticket.ts'
import { CommandError, TrackerError, commandFailureDetail } from '../../core/tracker-error.ts'
import {
  countNativeBlockers,
  encodeProjectPath,
  parseIssuesPage,
  type ParsedIssue,
} from './parse.ts'

/** GitLab 后端依赖。 */
export interface GitlabTrackerDeps {
  readonly run: CommandRunner
  readonly now: () => number
  /** 单页大小；默认 100，测试可以调小以便构造分页。 */
  readonly pageSize?: number
  /** 并发查询 blocking link 的上限。 */
  readonly concurrency?: number
}

const DEFAULT_PAGE_SIZE = 100
const DEFAULT_CONCURRENCY = 4

/**
 * 创建 GitLab 工单后端。
 * @param deps - 命令执行器、时钟与可选的页大小、并发上限。
 * @returns 满足 core `Tracker` 契约的后端。
 */
export function createGitlabTracker(deps: GitlabTrackerDeps): Tracker {
  const pageSize = normalizePositive(deps.pageSize ?? DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE)
  const concurrency = normalizePositive(
    deps.concurrency ?? DEFAULT_CONCURRENCY,
    DEFAULT_CONCURRENCY,
  )

  return {
    async fetchSnapshot(workspaceRoot: string): Promise<TrackerSnapshot> {
      const project = await readProjectPath(deps, workspaceRoot)
      const issues = await readIssues(deps, workspaceRoot, project, pageSize)
      const states = new Map<number, TicketState>()
      for (const issue of issues) {
        if (issue.ticket.number !== null) states.set(issue.ticket.number, issue.ticket.state)
      }

      const native = await readNativeBlockers(deps, workspaceRoot, project, issues, concurrency)
      const tickets = issues.map((issue) => withBlockers(issue, native, states))

      return {
        repository: project,
        fetchedAt: deps.now(),
        loaded: tickets.length,
        total: tickets.length,
        tickets,
      }
    },
  }
}

async function readProjectPath(deps: GitlabTrackerDeps, workspaceRoot: string): Promise<string> {
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
  return address.path
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

async function readNativeBlockers(
  deps: GitlabTrackerDeps,
  workspaceRoot: string,
  project: string,
  issues: readonly ParsedIssue[],
  concurrency: number,
): Promise<ReadonlyMap<number, number> | undefined> {
  const open = issues.filter(
    (issue): issue is ParsedIssue & { readonly ticket: Ticket & { readonly number: number } } =>
      issue.ticket.state === 'open' && issue.ticket.number !== null,
  )
  if (open.length === 0) return new Map()

  try {
    const counts = await mapWithConcurrency(open, concurrency, async (issue) => {
      const endpoint = `${projectEndpoint(project)}/issues/${String(issue.ticket.number)}/links`
      const output = (await deps.run('glab', ['api', endpoint], { cwd: workspaceRoot })).stdout
      return { iid: issue.ticket.number, openBlockers: countNativeBlockers(output) }
    })

    return new Map(counts.map((entry) => [entry.iid, entry.openBlockers]))
  } catch (error) {
    if (isBlockingUnavailable(error)) return undefined
    throw mapGlabError(error)
  }
}

function withBlockers(
  issue: ParsedIssue,
  native: ReadonlyMap<number, number> | undefined,
  states: ReadonlyMap<number, TicketState>,
): Ticket {
  const number = issue.ticket.number
  if (issue.ticket.state !== 'open' || number === null) {
    return { ...issue.ticket, openBlockers: 0 }
  }

  // GitLab 免费套餐没有原生 blocking link：links 接口照常返回空数组，
  // 而不是报错。原生链接为空时仍要读描述顶部的 `Blocked by:` 行。
  const fromLinks = native?.get(number)
  const openBlockers =
    fromLinks !== undefined && fromLinks > 0
      ? fromLinks
      : countDescriptionBlockers(issue.description, states)

  return { ...issue.ticket, openBlockers }
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

function isBlockingUnavailable(error: unknown): boolean {
  if (!(error instanceof CommandError)) return false
  return /HTTP 403|403 Forbidden|HTTP 404|404 Not Found|not available|not supported|premium|blocking|blocked_by/i.test(
    error.stderr,
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
