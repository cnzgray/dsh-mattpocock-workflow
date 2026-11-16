/**
 * GitHub 工单后端：通过注入的 {@link CommandRunner} 调用 `git` 与 `gh`，
 * 把输出映射成 core 的工单模型。远端解析复用 core，只接受 `github.com`。
 *
 * 列表走 GraphQL 一次取全；详情与变更在 `detail.ts`，只在打开详情或提交变更时执行。
 */
import type { CommandRunner, Ticket, Tracker, TrackerSnapshot } from '../../core/ticket.ts'
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

/**
 * 工单节点字段。列表查询一次取全这一页所需的全部字段。
 */
const ISSUE_NODES = `nodes {
        number
        title
        url
        state
        createdAt
        updatedAt
        closedAt
        labels(first: 50) { nodes { name } }
        author { login avatarUrl ... on User { name } }
        assignees(first: 10) { nodes { login } }
        issueDependenciesSummary { blockedBy }
        parent { number repository { nameWithOwner } }
      }`

const ISSUE_QUERY = `query ($owner: String!, $name: String!, $limit: Int!, $after: String) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    nameWithOwner
    issues(first: $limit, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }) {
      totalCount
      pageInfo { hasNextPage endCursor }
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
    async fetchSnapshot(workspaceRoot: string, windowLimit?: number): Promise<TrackerSnapshot> {
      const window = normalizeWindow(windowLimit, limit)
      const repository = await readRepository(deps.run, workspaceRoot)
      const tickets = await readTickets(deps, workspaceRoot, repository, limit, window)

      return {
        repository: repositoryLabel(repository),
        fetchedAt: deps.now(),
        loaded: tickets.tickets.length,
        total: tickets.total,
        // GitHub 原生子工单随列表查询一并取回，不新增请求。
        hierarchy: 'native',
        tickets: tickets.tickets,
        viewer: tickets.viewer,
        // 列表按更新时间倒序覆盖最近更新的 N 张票，扩窗就是把这个 N 调大。
        windowLimit: window,
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

/**
 * 按窗口读取工单：从最近更新的票开始，用 GraphQL 游标一页页取到窗口覆盖为止。
 *
 * 窗口为 N 的结果与「按更新时间倒序取前 N 张」等价；单页上限是 GraphQL 的
 * `first` 最大值，与窗口本身无关。
 * @param deps - 后端依赖。
 * @param workspaceRoot - 工作区根目录。
 * @param repository - 仓库。
 * @param pageSize - 单页票数上限。
 * @param window - 要覆盖的票数上限。
 * @returns 总数与窗口内的工单。
 */
async function readTickets(
  deps: GithubTrackerDeps,
  workspaceRoot: string,
  repository: GithubRepository,
  pageSize: number,
  window: number,
): Promise<ParsedIssues> {
  const tickets: Ticket[] = []
  let total = 0
  let viewer: string | null = null
  let cursor: string | null = null

  for (;;) {
    const remaining = window - tickets.length
    if (remaining <= 0) break

    const page = await readTicketsPage(
      deps,
      workspaceRoot,
      repository,
      Math.min(pageSize, remaining),
      cursor,
    )
    total = page.total
    // viewer 是查询根字段，每页都相同；万一后续页缺失，保留已拿到的身份。
    viewer = page.viewer ?? viewer
    tickets.push(...page.tickets)
    if (!page.hasNextPage || page.endCursor === null || page.tickets.length === 0) break
    cursor = page.endCursor
  }

  const windowed = tickets.slice(0, window)
  return { total, tickets: windowed, viewer, hasNextPage: false, endCursor: null }
}

/**
 * 读取一页工单。
 * @param deps - 后端依赖。
 * @param workspaceRoot - 工作区根目录。
 * @param repository - 仓库。
 * @param limit - 这一页的票数上限。
 * @param after - 上一页的结束游标；第一页为 null。
 * @returns 一页工单、总数与分页信息。
 */
async function readTicketsPage(
  deps: GithubTrackerDeps,
  workspaceRoot: string,
  repository: GithubRepository,
  limit: number,
  after: string | null,
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
    ...(after === null ? [] : ['-f', `after=${after}`]),
  ]

  return parseIssueGraphql(await callGh(deps.run, workspaceRoot, args), repositoryLabel(repository))
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT
  return Math.max(1, Math.min(Math.trunc(limit), DEFAULT_LIMIT))
}

/**
 * 归一化窗口：非法值退回单页，上限为 2000 张的协议上限不在这里管——
 * 宿主负责不请求超过上限的窗口。
 * @param window - 调用方要覆盖的票数。
 * @param fallback - 省略时用的单页票数。
 * @returns 至少一张的窗口。
 */
function normalizeWindow(window: number | undefined, fallback: number): number {
  if (window === undefined || !Number.isFinite(window)) return fallback
  return Math.max(1, Math.trunc(window))
}
