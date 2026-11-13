/**
 * GitHub 工单后端：通过注入的 {@link CommandRunner} 调用 `git` 与 `gh`，
 * 把输出映射成 core 的工单模型。远端解析复用 core，只接受 `github.com`。
 *
 * 列表走 GraphQL 一次取全；详情与变更在 `detail.ts`，只在打开详情或提交变更时执行。
 */
import type { CommandRunner, Tracker, TrackerChanges, TrackerSnapshot } from '../../core/ticket.ts'
import { TrackerError } from '../../core/tracker-error.ts'
import { deleteGithubTicket, readGithubDeletePermission } from './delete.ts'
import { applyGithubChanges, readGithubDetail } from './detail.ts'
import {
  parseIssueChangesGraphql,
  parseIssueGraphql,
  type ParsedChanges,
  type ParsedIssues,
} from './graphql.ts'
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

/**
 * 工单节点字段。列表与增量查询共用一份：
 * 增量必须覆盖与全量相同的工单字段，只有时间窗口不同。
 */
const ISSUE_NODES = `nodes {
        number
        title
        state
        createdAt
        updatedAt
        closedAt
        labels(first: 50) { nodes { name } }
        author { login avatarUrl ... on User { name } }
        issueDependenciesSummary { blockedBy }
      }`

const ISSUE_QUERY = `query ($owner: String!, $name: String!, $limit: Int!) {
  repository(owner: $owner, name: $name) {
    issues(first: $limit, orderBy: { field: UPDATED_AT, direction: DESC }) {
      totalCount
      ${ISSUE_NODES}
    }
  }
}`

/**
 * 增量查询：在列表查询上加更新时间过滤。
 *
 * `IssueFilters.since` 的语义是「更新时间在该时刻或之后」，边界含在内；
 * 远端时钟偏移与最终一致性仍可能让边界上的票漏掉，所以宿主会向前重叠一段时间。
 * `repositoryTotal` 是另一份未过滤的连接：带过滤的 `totalCount` 只是
 * 「这次变更了多少张票」，不能当仓库总数用。
 */
const CHANGES_QUERY = `query ($owner: String!, $name: String!, $limit: Int!, $since: DateTime!) {
  repository(owner: $owner, name: $name) {
    repositoryTotal: issues(first: 1) { totalCount }
    issues(first: $limit, orderBy: { field: UPDATED_AT, direction: DESC }, filterBy: { since: $since }) {
      pageInfo { hasNextPage }
      ${ISSUE_NODES}
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
        // GitHub 的列表一次只取一页，这份快照只覆盖最近更新的 N 张票。
        windowLimit: limit,
      }
    },

    async fetchChanges(workspaceRoot: string, since: number): Promise<TrackerChanges> {
      const repository = await readRepository(deps.run, workspaceRoot)
      const changes = await readChanges(deps, workspaceRoot, repository, limit, since)

      return {
        tickets: changes.tickets,
        truncated: changes.truncated,
        ...(changes.total === undefined ? {} : { total: changes.total }),
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

/**
 * 读取某个时刻之后变更过的工单。
 *
 * 与列表查询共用同一份 GraphQL 字段与过滤条件（工单连接本身已经排除 PR），
 * 只多一个更新时间窗口；窗口起点是毫秒时间戳，转成 GitHub 认的 ISO 8601。
 */
async function readChanges(
  deps: GithubTrackerDeps,
  workspaceRoot: string,
  repository: GithubRepository,
  limit: number,
  since: number,
): Promise<ParsedChanges> {
  if (!Number.isFinite(since)) {
    throw new TrackerError('fetch-failed', '增量窗口的起点不是有效时间戳。')
  }

  const args = [
    'api',
    'graphql',
    '-f',
    `query=${CHANGES_QUERY}`,
    '-f',
    `owner=${repository.owner}`,
    '-f',
    `name=${repository.name}`,
    '-F',
    `limit=${String(limit)}`,
    '-f',
    `since=${new Date(since).toISOString()}`,
  ]

  return parseIssueChangesGraphql(await callGh(deps.run, workspaceRoot, args))
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT
  return Math.max(1, Math.min(Math.trunc(limit), DEFAULT_LIMIT))
}
