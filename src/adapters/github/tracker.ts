/**
 * GitHub 工单后端：通过注入的 {@link CommandRunner} 调用 `git` 与 `gh`，
 * 把输出映射成 core 的工单模型。远端解析复用 core，只接受 `github.com`。只读不写。
 */
import { GITHUB_HOST } from '../../core/backend.ts'
import { parseRemotes, pickRemoteAddress } from '../../core/remote.ts'
import type { CommandRunner, Tracker, TrackerSnapshot } from '../../core/ticket.ts'
import { CommandError, TrackerError, commandFailureDetail } from '../../core/tracker-error.ts'
import { parseIssueGraphql, type ParsedIssues } from './graphql.ts'

/** GitHub 后端依赖。 */
export interface GithubTrackerDeps {
  readonly run: CommandRunner
  readonly now: () => number
  /** 单次拉取的票数上限；GitHub GraphQL 的 `first` 最大为 100。 */
  readonly limit?: number
}

/** GitHub 仓库的 owner 与 name。 */
interface GithubRepository {
  readonly owner: string
  readonly name: string
}

const SEGMENT = /^[A-Za-z0-9_.-]+$/
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
    output = (await deps.run('git', ['remote', '-v'], { cwd: workspaceRoot })).stdout
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
    output = (await deps.run('gh', args, { cwd: workspaceRoot })).stdout
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
    return new TrackerError('fetch-failed', `读取 git 远端失败：${commandFailureDetail(error)}`, {
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

function repositoryLabel(repository: GithubRepository): string {
  return `${repository.owner}/${repository.name}`
}
