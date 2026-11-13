/**
 * GitHub 工单后端：通过注入的 {@link CommandRunner} 调用 `git` 与 `gh`，
 * 把输出映射成 core 的工单模型。远端解析复用 core，只接受 `github.com`。
 *
 * 列表走 GraphQL 一次取全；详情与变更在 `detail.ts`，只在打开详情或提交变更时执行。
 */
import type { CommandRunner, Tracker, TrackerSnapshot } from '../../core/ticket.ts'
import { deleteGithubTicket, readGithubDeletePermission } from './delete.ts'
import { applyGithubChanges, readGithubDetail } from './detail.ts'
import { parseIssueGraphql, type ParsedIssues } from './graphql.ts'
import { readGithubOptions } from './options.ts'
import { callGh, readRepository, repositoryLabel, type GithubRepository } from './shared.ts'

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
        closedAt
        labels(first: 50) { nodes { name } }
        author { login avatarUrl ... on User { name } }
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
      const repository = await readRepository(deps.run, workspaceRoot)
      const tickets = await readTickets(deps, workspaceRoot, repository, limit)

      return {
        repository: repositoryLabel(repository),
        fetchedAt: deps.now(),
        loaded: tickets.tickets.length,
        total: tickets.total,
        tickets: tickets.tickets,
      }
    },

    fetchDetail: (workspaceRoot, reference) => readGithubDetail(deps, workspaceRoot, reference),

    updateTicket: (workspaceRoot, reference, patch) =>
      applyGithubChanges(deps, workspaceRoot, reference, patch),

    fetchOptions: (workspaceRoot) => readGithubOptions(deps, workspaceRoot),

    canDeleteTickets: (workspaceRoot) => readGithubDeletePermission(deps, workspaceRoot),

    deleteTicket: (workspaceRoot, reference) => deleteGithubTicket(deps, workspaceRoot, reference),
  }
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

  return parseIssueGraphql(await callGh(deps.run, workspaceRoot, args))
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT
  return Math.max(1, Math.min(Math.trunc(limit), DEFAULT_LIMIT))
}
