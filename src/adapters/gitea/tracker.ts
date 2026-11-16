/**
 * Gitea 工单后端：通过注入的 {@link CommandRunner} 调用 `git` 与 `tea`。
 *
 * - 只读：用 `tea api` 读仓库 issue 列表，`type=issues` 把 pull request 挡在接口外；
 * - 分页：总条数取自 `X-Total-Count`（`tea api --include` 写到标准错误里），
 *   按页拉到拿全为止；
 * - 阻塞：优先读 Gitea 原生 issue 依赖，只查开放的工单，并发有上限；
 *   仓库关闭了依赖功能（接口返回 404）时退回正文顶部的 `Blocked by:` 行；
 * - 详情与变更在 `detail.ts`，只在打开详情或提交变更时执行。
 */
import { resolveOpenBlockers, type NativeBlockers } from '../../core/blocked-by.ts'
import { mapWithConcurrency } from '../../core/concurrency.ts'

import type {
  CommandRunner,
  Ticket,
  TicketState,
  Tracker,
  TrackerChanges,
  TrackerSnapshot,
} from '../../core/ticket.ts'
import { TrackerError } from '../../core/tracker-error.ts'
import { deleteGiteaTicket, readGiteaDeletePermission } from './delete.ts'
import { applyGiteaChanges, readGiteaDetail } from './detail.ts'
import { readGiteaOptions } from './options.ts'
import { parseDependencies, parseIssuesPage, parseViewer, type ParsedIssue } from './parse.ts'
import { callGiteaApi, ensureSuccess, readRepository, type GiteaRepository } from './shared.ts'

/** Gitea 后端依赖。 */
export interface GiteaTrackerDeps {
  readonly run: CommandRunner
  readonly now: () => number
  /** 单页大小；默认 50，与 Gitea 的默认返回上限一致。 */
  readonly pageSize?: number
  /** 并发查询依赖的上限。 */
  readonly concurrency?: number
}

const DEFAULT_PAGE_SIZE = 50
const DEFAULT_CONCURRENCY = 4
const MAX_PAGES = 200

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
  const detailDeps = { run: deps.run, pageSize }

  return {
    async fetchSnapshot(workspaceRoot: string, windowLimit?: number): Promise<TrackerSnapshot> {
      const window = windowLimit === undefined ? undefined : Math.max(1, Math.trunc(windowLimit))
      // 身份查询与列表并行发出；失败只丢身份，不让列表失败。
      const viewerTask = readViewer(deps, workspaceRoot).catch(() => null)
      const repository = await readRepository(deps.run, workspaceRoot)
      const issues = await readIssues(deps, workspaceRoot, repository, pageSize, undefined, window)
      const viewer = await viewerTask
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
        ...resolveOpenBlockers({
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
        viewer,
        ...(window === undefined ? {} : { windowLimit: window }),
      }
    },

    async fetchChanges(workspaceRoot: string, since: number): Promise<TrackerChanges> {
      return readGiteaChanges(deps, workspaceRoot, pageSize, since, concurrency)
    },

    fetchDetail: (workspaceRoot, reference) =>
      readGiteaDetail(detailDeps, workspaceRoot, reference),

    updateTicket: (workspaceRoot, reference, patch) =>
      applyGiteaChanges(detailDeps, workspaceRoot, reference, patch),

    fetchOptions: (workspaceRoot) => readGiteaOptions(deps, workspaceRoot),

    canDeleteTickets: (workspaceRoot) => readGiteaDeletePermission(deps, workspaceRoot),

    deleteTicket: (workspaceRoot, reference) => deleteGiteaTicket(deps, workspaceRoot, reference),
  }
}

/**
 * 读取同一过滤条件下的权威总数。
 *
 * 增量响应自己的 `X-Total-Count` 只数窗口内的票，不能拿来对账；
 * 这里用同一接口、同一状态与类型过滤，去掉时间窗，只取一条并读总条数。
 */
async function readGiteaTotal(
  deps: GiteaTrackerDeps,
  workspaceRoot: string,
  repository: GiteaRepository,
): Promise<number> {
  const response = await callGiteaApi(deps.run, workspaceRoot, issuesEndpoint(repository, 1, 1))
  ensureSuccess(response, '读取 Gitea 工单总数')
  if (response.total === undefined) {
    throw new TrackerError('fetch-failed', '读取 Gitea 工单总数失败：响应缺少 X-Total-Count。')
  }
  return response.total
}

/**
 * 读取某个时刻之后变更过的工单。
 *
 * 与列表查询走同一个接口、同一套过滤条件，只多一个时间窗口。
 */
async function readGiteaChanges(
  deps: GiteaTrackerDeps,
  workspaceRoot: string,
  pageSize: number,
  since: number,
  concurrency: number,
): Promise<TrackerChanges> {
  if (!Number.isFinite(since)) {
    throw new TrackerError('fetch-failed', '增量窗口的起点不是有效时间戳。')
  }

  // 增量也刷新身份：切换 CLI 账号后下一次刷新就按新身份匹配。
  // 查询失败时省略这个字段，宿主沿用基准数据里的身份；成功但没有身份时为 null。
  const viewerTask = readViewer(deps, workspaceRoot).then(
    (viewer) => viewer,
    () => undefined,
  )
  const repository = await readRepository(deps.run, workspaceRoot)
  const total = await readGiteaTotal(deps, workspaceRoot, repository)
  const issues = await readIssues(deps, workspaceRoot, repository, pageSize, since)
  const viewer = await viewerTask

  const states = new Map<number, TicketState>()
  for (const issue of issues.items) {
    if (issue.ticket.number !== null) states.set(issue.ticket.number, issue.ticket.state)
  }

  // Gitea 的阻塞数是在列表阶段就地解析的，没有单独的补齐能力；
  // 增量里也要给变更过的票补上，否则合并后这些票会显示成没有阻塞。
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
    ...resolveOpenBlockers({
      ticket: issue.ticket,
      nativeBlockers: native?.get(issue.ticket.number ?? -1),
      text: issue.body,
      states,
    }),
  }))

  return {
    tickets,
    truncated: issues.truncated,
    total,
    ...(viewer === undefined ? {} : { viewer }),
  }
}

/**
 * 当前登录用户：`tea api /user` 的 `login`。
 * @param deps - 后端依赖。
 * @param workspaceRoot - 工作区根目录。
 * @returns 登录名或 null。
 * @throws {TrackerError} 命令失败、响应非 2xx 或响应体不是 JSON。
 */
async function readViewer(deps: GiteaTrackerDeps, workspaceRoot: string): Promise<string | null> {
  const response = await callGiteaApi(deps.run, workspaceRoot, '/user')
  ensureSuccess(response, '读取 Gitea 当前用户')
  return parseViewer(response.body)
}

/**
 * 读取一页页的工单。
 *
 * `since` 给了就只取该时刻之后更新过的票：同一路径、同样的过滤条件，
 * 只多一个时间窗口，这样增量与全量覆盖的是同一批工单。
 * `window` 给了就按更新时间倒序读到窗口覆盖为止；省略表示读到拿全。
 */
async function readIssues(
  deps: GiteaTrackerDeps,
  workspaceRoot: string,
  repository: GiteaRepository,
  pageSize: number,
  since?: number,
  window?: number,
): Promise<{
  readonly items: ParsedIssue[]
  readonly total: number | undefined
  readonly truncated: boolean
}> {
  const items: ParsedIssue[] = []
  let total: number | undefined
  let truncated = false

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await callGiteaApi(
      deps.run,
      workspaceRoot,
      issuesEndpoint(repository, pageSize, page, since),
    )
    ensureSuccess(response, '读取 Gitea 工单')

    const parsed = parseIssuesPage(response.body, repository.avatarBaseUrl)
    items.push(...parsed)
    total ??= response.total

    // 窗口只覆盖最近更新的若干张票，够数就停，不再往下翻。
    if (window !== undefined && items.length >= window) break
    // 有总条数就按条数收口；没有时只能一直翻到空页，宁可多一次请求，也不提前截断。
    if (total !== undefined && items.length >= total) break
    if (parsed.length === 0) break
    // 翻到页数上限还没拿完：这份列表不完整，调用方要知道自己拿到的是半份。
    if (page === MAX_PAGES) truncated = true
  }

  return {
    items: window === undefined ? items : items.slice(0, window),
    total,
    truncated,
  }
}

async function readNativeBlockers(
  deps: GiteaTrackerDeps,
  workspaceRoot: string,
  repository: GiteaRepository,
  issues: readonly ParsedIssue[],
  pageSize: number,
  concurrency: number,
): Promise<ReadonlyMap<number, NativeBlockers> | undefined> {
  const open = issues.filter(
    (issue): issue is ParsedIssue & { readonly ticket: Ticket & { readonly number: number } } =>
      issue.ticket.state === 'open' && issue.ticket.number !== null,
  )
  if (open.length === 0) return new Map()

  try {
    const counts = await mapWithConcurrency(open, concurrency, async (issue) => ({
      number: issue.ticket.number,
      blockedBy: await readDependencies(
        deps,
        workspaceRoot,
        repository,
        issue.ticket.number,
        pageSize,
      ),
    }))

    return new Map(counts.map((entry) => [entry.number, entry.blockedBy]))
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
): Promise<NativeBlockers> {
  let open = 0
  let received = 0
  let total: number | undefined
  const refs: number[] = []

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await callGiteaApi(
      deps.run,
      workspaceRoot,
      dependenciesEndpoint(repository, index, pageSize, page),
    )
    // 依赖功能被实例或仓库关闭时，Gitea 对依赖接口返回 404。
    if (response.status === 404) throw new DependenciesUnavailable()
    ensureSuccess(response, '读取 Gitea 工单依赖')

    const parsed = parseDependencies(response.body)
    open += parsed.open
    received += parsed.received
    refs.push(...parsed.refs)
    total ??= response.total

    if (total !== undefined && received >= total) break
    if (parsed.received === 0) break
  }

  return { open, refs }
}

/** 依赖功能未启用。只用于在读取阶段区分 404，不向外暴露。 */
class DependenciesUnavailable extends Error {}

/**
 * 工单列表接口。
 *
 * 增量查询只在同一条路径上加 `since`：语义是「只显示该时刻之后更新过的条目」，
 * 边界上的票由宿主向前重叠一段时间兜底。
 * 其余参数（状态、排除 PR、页码、页大小）与列表完全一致，避免增量与全量口径不同。
 */
function issuesEndpoint(
  repository: GiteaRepository,
  pageSize: number,
  page: number,
  since?: number,
): string {
  const window = since === undefined ? '' : `&since=${new Date(since).toISOString()}`
  return `/repos/${repository.owner}/${repository.name}/issues?state=all&type=issues&sort=recentupdate&page=${String(page)}&limit=${String(pageSize)}${window}`
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
