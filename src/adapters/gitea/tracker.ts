/**
 * Gitea 工单后端：通过注入的 {@link CommandRunner} 调用 `git` 与 `tea`。
 *
 * - 只读：用 `tea api` 读仓库 issue 列表，`type=issues` 把 pull request 挡在接口外；
 * - 分页：总条数取自 `X-Total-Count`（`tea api --include` 写到标准错误里），
 *   按页拉到拿全为止；
 * - 阻塞：优先读 Gitea 原生 issue 依赖，只查开放的工单，并发有上限；
 *   仓库关闭了依赖功能（接口返回 404）时退回正文顶部的 `Blocked by:` 行。
 */
import { resolveOpenBlockers } from '../../core/blocked-by.ts'
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
  parseApiResponse,
  parseDependencies,
  parseIssuesPage,
  type ApiResponse,
  type ParsedIssue,
} from './parse.ts'

/** Gitea 后端依赖。 */
export interface GiteaTrackerDeps {
  readonly run: CommandRunner
  readonly now: () => number
  /** 单页大小；默认 50，与 Gitea 的默认返回上限一致。 */
  readonly pageSize?: number
  /** 并发查询依赖的上限。 */
  readonly concurrency?: number
}

/** Gitea 仓库的 owner 与 name。 */
interface GiteaRepository {
  readonly owner: string
  readonly name: string
}

const DEFAULT_PAGE_SIZE = 50
const DEFAULT_CONCURRENCY = 4
const MAX_PAGES = 200
const SEGMENT = /^[A-Za-z0-9_.-]+$/
const AUTH_FAILURE =
  /tea login add|not logged in|no token|token.*(?:expired|invalid)|authentication failed|bad credentials|HTTP 401|HTTP 403|Unauthorized|Forbidden/i

/**
 * 创建 Gitea 工单后端。
 * @param deps - 命令执行器、时钟与可选的页大小、并发上限。
 * @returns 满足 core `Tracker` 契约的后端。
 */
export function createGiteaTracker(deps: GiteaTrackerDeps): Tracker {
  const pageSize = normalizePositive(deps.pageSize ?? DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE)
  const concurrency = normalizePositive(
    deps.concurrency ?? DEFAULT_CONCURRENCY,
    DEFAULT_CONCURRENCY,
  )

  return {
    async fetchSnapshot(workspaceRoot: string): Promise<TrackerSnapshot> {
      const repository = await readRepository(deps, workspaceRoot)
      const issues = await readIssues(deps, workspaceRoot, repository, pageSize)
      const states = new Map<number, TicketState>()
      for (const issue of issues.items) {
        if (issue.ticket.number !== null) states.set(issue.ticket.number, issue.ticket.state)
      }

      const native = await readNativeBlockers(
        deps,
        workspaceRoot,
        repository,
        issues.items,
        pageSize,
        concurrency,
      )
      const tickets = issues.items.map((issue) => ({
        ...issue.ticket,
        openBlockers: resolveOpenBlockers({
          ticket: issue.ticket,
          nativeBlockers: native?.get(issue.ticket.number ?? -1),
          text: issue.body,
          states,
        }),
      }))

      return {
        repository: `${repository.owner}/${repository.name}`,
        fetchedAt: deps.now(),
        loaded: tickets.length,
        total: Math.max(issues.total ?? tickets.length, tickets.length),
        tickets,
      }
    },
  }
}

async function readRepository(
  deps: GiteaTrackerDeps,
  workspaceRoot: string,
): Promise<GiteaRepository> {
  let output: string
  try {
    output = (await deps.run('git', ['remote', '-v'], { cwd: workspaceRoot })).stdout
  } catch (error) {
    throw new TrackerError('fetch-failed', '读取 git 远端失败，无法识别 Gitea 仓库。', {
      cause: error,
    })
  }

  const address = pickRemoteAddress(parseRemotes(output))
  if (address === undefined) {
    throw new TrackerError('fetch-failed', '当前仓库的 origin 不是可识别的 Gitea 远端。')
  }

  const segments = address.path.split('/')
  const owner = segments[0]
  const name = segments[1]
  // Gitea 只有 owner/name 两层，子路径不是合法仓库地址。
  if (segments.length !== 2 || owner === undefined || name === undefined) {
    throw new TrackerError('fetch-failed', 'Gitea 远端地址无法识别 owner/name。')
  }
  if (!SEGMENT.test(owner) || !SEGMENT.test(name)) {
    throw new TrackerError('fetch-failed', 'Gitea 远端地址无法识别 owner/name。')
  }

  return { owner, name }
}

async function readIssues(
  deps: GiteaTrackerDeps,
  workspaceRoot: string,
  repository: GiteaRepository,
  pageSize: number,
): Promise<{ readonly items: ParsedIssue[]; readonly total: number | undefined }> {
  const items: ParsedIssue[] = []
  let total: number | undefined

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await callApi(deps, workspaceRoot, issuesEndpoint(repository, pageSize, page))
    ensureSuccess(response, '读取 Gitea 工单')

    const parsed = parseIssuesPage(response.body)
    items.push(...parsed)
    total ??= response.total

    // 有总条数就按条数收口；没有时只能一直翻到空页，宁可多一次请求，也不提前截断。
    if (total !== undefined && items.length >= total) break
    if (parsed.length === 0) break
  }

  return { items, total }
}

async function readNativeBlockers(
  deps: GiteaTrackerDeps,
  workspaceRoot: string,
  repository: GiteaRepository,
  issues: readonly ParsedIssue[],
  pageSize: number,
  concurrency: number,
): Promise<ReadonlyMap<number, number> | undefined> {
  const open = issues.filter(
    (issue): issue is ParsedIssue & { readonly ticket: Ticket & { readonly number: number } } =>
      issue.ticket.state === 'open' && issue.ticket.number !== null,
  )
  if (open.length === 0) return new Map()

  try {
    const counts = await mapWithConcurrency(open, concurrency, async (issue) => ({
      number: issue.ticket.number,
      openBlockers: await readDependencies(
        deps,
        workspaceRoot,
        repository,
        issue.ticket.number,
        pageSize,
      ),
    }))

    return new Map(counts.map((entry) => [entry.number, entry.openBlockers]))
  } catch (error) {
    if (error instanceof DependenciesUnavailable) return undefined
    throw error
  }
}

async function readDependencies(
  deps: GiteaTrackerDeps,
  workspaceRoot: string,
  repository: GiteaRepository,
  index: number,
  pageSize: number,
): Promise<number> {
  let open = 0
  let received = 0
  let total: number | undefined

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await callApi(
      deps,
      workspaceRoot,
      dependenciesEndpoint(repository, index, pageSize, page),
    )
    // 依赖功能被实例或仓库关闭时，Gitea 对依赖接口返回 404。
    if (response.status === 404) throw new DependenciesUnavailable()
    ensureSuccess(response, '读取 Gitea 工单依赖')

    const parsed = parseDependencies(response.body)
    open += parsed.open
    received += parsed.received
    total ??= response.total

    if (total !== undefined && received >= total) break
    if (parsed.received === 0) break
  }

  return open
}

/** 依赖功能未启用。只用于在读取阶段区分 404，不向外暴露。 */
class DependenciesUnavailable extends Error {}

async function callApi(
  deps: GiteaTrackerDeps,
  workspaceRoot: string,
  endpoint: string,
): Promise<ApiResponse> {
  let stdout: string
  let stderr: string
  try {
    const output = await deps.run('tea', ['api', '--include', endpoint], { cwd: workspaceRoot })
    stdout = output.stdout
    stderr = output.stderr
  } catch (error) {
    throw mapTeaError(error)
  }
  return parseApiResponse(stdout, stderr)
}

function ensureSuccess(response: ApiResponse, action: string): void {
  if (response.status < 400) return
  if (response.status === 401 || response.status === 403) {
    throw new TrackerError(
      'tea-unauthenticated',
      'tea 未登录该实例或令牌已失效，请运行 tea login add。',
    )
  }
  throw new TrackerError(
    'fetch-failed',
    `${action}失败：Gitea 返回 HTTP ${String(response.status)}。`,
  )
}

function mapTeaError(error: unknown): TrackerError {
  if (error instanceof CommandError) {
    if (error.kind === 'not-found') {
      return new TrackerError(
        'tea-missing',
        '未找到 tea 命令，请先安装 Gitea CLI（https://gitea.com/gitea/tea）。',
        { cause: error },
      )
    }
    if (AUTH_FAILURE.test(error.stderr)) {
      return new TrackerError(
        'tea-unauthenticated',
        'tea 未登录该实例或令牌已失效，请运行 tea login add。',
        { cause: error },
      )
    }
    return new TrackerError('fetch-failed', `读取 Gitea 工单失败：${commandFailureDetail(error)}`, {
      cause: error,
    })
  }
  return new TrackerError('fetch-failed', '读取 Gitea 工单失败。', { cause: error })
}

function issuesEndpoint(repository: GiteaRepository, pageSize: number, page: number): string {
  return `/repos/${repository.owner}/${repository.name}/issues?state=all&type=issues&page=${String(page)}&limit=${String(pageSize)}`
}

function dependenciesEndpoint(
  repository: GiteaRepository,
  index: number,
  pageSize: number,
  page: number,
): string {
  return `/repos/${repository.owner}/${repository.name}/issues/${String(index)}/dependencies?page=${String(page)}&limit=${String(pageSize)}`
}

function normalizePositive(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(1, Math.trunc(value))
}
