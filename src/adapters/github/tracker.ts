/**
 * GitHub 工单后端：通过注入的 {@link CommandRunner} 调用 `git` 与 `gh`，
 * 把输出映射成 core 的工单模型。MVP 只读不写。
 */
import type { CommandRunner, Tracker, TrackerSnapshot } from '../../core/ticket.ts'
import { CommandError, TrackerError } from '../../core/tracker-error.ts'
import { parseIssueGraphql, type ParsedIssues } from './graphql.ts'
import {
  parseRemotes,
  pickGithubRepository,
  repositoryLabel,
  type GithubRepository,
} from './remotes.ts'

/** GitHub 后端依赖。 */
export interface GithubTrackerDeps {
  readonly run: CommandRunner
  readonly now: () => number
  /** 单次拉取的票数上限；GitHub GraphQL 的 `first` 最大为 100。 */
  readonly limit?: number
}

const DEFAULT_LIMIT = 100
const ISSUE_QUERY = `query ($owner: String!, $name: String!, $limit: Int!) {
  repository(owner: $owner, name: $name) {
    issues(first: $limit, orderBy: { field: UPDATED_AT, direction: DESC }) {
      totalCount
      nodes {
        number
        title
        state
        createdAt
        updatedAt
        labels(first: 50) { nodes { name } }
        issueDependenciesSummary { blockedBy }
      }
    }
  }
}`

/**
 * 创建 GitHub 工单后端。
 * @param deps - 命令执行器、时钟与可选的拉取上限。
 * @returns 满足 core `Tracker` 契约的后端。
 */
export function createGithubTracker(deps: GithubTrackerDeps): Tracker {
  const limit = normalizeLimit(deps.limit ?? DEFAULT_LIMIT)

  return {
    async fetchSnapshot(workspaceRoot: string): Promise<TrackerSnapshot> {
      const repository = await readRepository(deps, workspaceRoot)
      const tickets = await readTickets(deps, workspaceRoot, repository, limit)

      return {
        repository: repositoryLabel(repository),
        fetchedAt: deps.now(),
        loaded: tickets.tickets.length,
        total: tickets.total,
        tickets: tickets.tickets,
      }
    },
  }
}

async function readRepository(
  deps: GithubTrackerDeps,
  workspaceRoot: string,
): Promise<GithubRepository> {
  let output: string
  try {
    output = await deps.run('git', ['remote', '-v'], { cwd: workspaceRoot })
  } catch (error) {
    throw mapGitError(error)
  }

  const repository = pickGithubRepository(parseRemotes(output))
  if (repository === undefined) {
    throw new TrackerError('no-github-remote', '当前仓库没有 GitHub 远端。')
  }
  return repository
}

async function readTickets(
  deps: GithubTrackerDeps,
  workspaceRoot: string,
  repository: GithubRepository,
  limit: number,
): Promise<ParsedIssues> {
  const args = [
    'api',
    'graphql',
    '-f',
    `query=${ISSUE_QUERY}`,
    '-f',
    `owner=${repository.owner}`,
    '-f',
    `name=${repository.name}`,
    '-F',
    `limit=${String(limit)}`,
  ]

  let output: string
  try {
    output = await deps.run('gh', args, { cwd: workspaceRoot })
  } catch (error) {
    throw mapGhError(error)
  }

  return parseIssueGraphql(output)
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT
  return Math.max(1, Math.min(Math.trunc(limit), DEFAULT_LIMIT))
}

function mapGitError(error: unknown): TrackerError {
  if (error instanceof CommandError) {
    if (error.kind === 'not-found') {
      return new TrackerError('fetch-failed', '未找到 git 命令，无法识别仓库。', { cause: error })
    }
    if (/not a git repository/i.test(error.stderr)) {
      return new TrackerError('not-a-repo', '当前工作区不是 git 仓库。', { cause: error })
    }
    return new TrackerError('fetch-failed', `读取 git 远端失败：${detail(error)}`, {
      cause: error,
    })
  }
  return new TrackerError('fetch-failed', '读取 git 远端失败。', { cause: error })
}

function mapGhError(error: unknown): TrackerError {
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
    return new TrackerError('fetch-failed', `读取工单失败：${detail(error)}`, { cause: error })
  }
  return new TrackerError('fetch-failed', '读取工单失败。', { cause: error })
}

function isAuthenticationFailure(stderr: string): boolean {
  return /gh auth login|not logged in|authentication failed|bad credentials|HTTP 401|requires authentication/i.test(
    stderr,
  )
}

function detail(error: CommandError): string {
  const text = error.stderr.trim() || error.message
  const firstLine = text.split('\n')[0] ?? text
  return firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine
}
