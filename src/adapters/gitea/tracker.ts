/**
 * Gitea 工单后端：通过注入的 {@link CommandRunner} 调用 `git` 与 `tea`。
 *
 * - 只读：用 `tea api` 读仓库 issue 列表，`type=issues` 把 pull request 挡在接口外；
 * - 分页：总条数取自 `X-Total-Count`（`tea api --include` 写到标准错误里），
 *   按页拉到拿全为止；
 * - 阻塞：首屏只按正文顶部的 `Blocked by:` 行回退，列表阶段零额外请求；
 *   原生 issue 依赖在 `resolveBlockers` 补齐阶段按开放票并发查询（默认并发 8）；
 *   仓库关闭了依赖功能（接口返回 404）时按正文解析结果定稿；
 * - 父子：Gitea 没有原生子工单，父级来自子票正文第一个非空行的 `Part of #<n>`，
 *   在列表响应里解析，不额外请求；阻塞边不参与父子；
 * - 详情与变更在 `detail.ts`，只在打开详情或提交变更时执行。
 */
import {
  remoteBlockerRefs,
  resolveOpenBlockers,
  type NativeBlockers,
} from '../../core/blocked-by.ts'
import { mapWithConcurrency } from '../../core/concurrency.ts'

import type {
  BlockerResolution,
  CommandRunner,
  TicketReference,
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
  /** 补齐阶段并发查询依赖的上限。 */
  readonly concurrency?: number
}

const DEFAULT_PAGE_SIZE = 50
/** 补齐阶段的默认并发：47 张开放票 ≈1s 内全部定稿。 */
const DEFAULT_CONCURRENCY = 8
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
  const detailDeps = { run: deps.run, pageSize, concurrency }

  return {
    async fetchSnapshot(workspaceRoot: string, windowLimit?: number): Promise<TrackerSnapshot> {
      const window = windowLimit === undefined ? undefined : Math.max(1, Math.trunc(windowLimit))
      // 身份查询与列表并行发出；失败只丢身份，不让列表失败。
      const viewerTask = readViewer(deps, workspaceRoot).catch(() => null)
      const repository = await readRepository(deps.run, workspaceRoot)
      const issues = await readIssues(deps, workspaceRoot, repository, pageSize, undefined, window)
      const viewer = await viewerTask
      const states = statesOf(issues.items)

      // 首屏只等列表：阻塞数先按正文 `Blocked by:` 行回退，
      // 原生依赖查询挪到补齐阶段，不挡住首屏。
      const tickets = issues.items.map((issue) => ({
        ...issue.ticket,
        ...resolveOpenBlockers({
          ticket: issue.ticket,
          nativeBlockers: undefined,
          text: issue.body,
          states,
        }),
      }))

      return {
        repository: `${repository.owner}/${repository.name}`,
        fetchedAt: deps.now(),
        loaded: tickets.length,
        total: Math.max(issues.total ?? tickets.length, tickets.length),
        // Gitea 没有原生子工单；父级来自子票正文首行的 `Part of #<n>` 约定。
        hierarchy: 'convention',
        tickets,
        viewer,
        ...(window === undefined ? {} : { windowLimit: window }),
      }
    },

    async fetchChanges(workspaceRoot: string, since: number): Promise<TrackerChanges> {
      return readGiteaChanges(deps, workspaceRoot, pageSize, since)
    },

    async resolveBlockers(workspaceRoot, targets): Promise<BlockerResolution> {
      return readNativeResolution(deps, workspaceRoot, targets, pageSize, concurrency)
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
 * 变更票的阻塞只给正文回退：原生依赖在补齐阶段统一读取，与首屏同一套语义。
 */
async function readGiteaChanges(
  deps: GiteaTrackerDeps,
  workspaceRoot: string,
  pageSize: number,
  since: number,
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
  const states = statesOf(issues.items)

  const tickets = issues.items.map((issue) => ({
    ...issue.ticket,
    ...resolveOpenBlockers({
      ticket: issue.ticket,
      nativeBlockers: undefined,
      text: issue.body,
      states,
    }),
  }))

  return {
    tickets,
    hierarchy: 'convention',
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

/**
 * 补齐阶段的原生阻塞读取：只查给定票，按并发上限逐票查询依赖接口。
 *
 * 依赖功能被实例或仓库关闭（404）时返回空结果，宿主对所有票保留正文回退；
 * 单票查询失败只跳过该票，不拖垮整轮补齐。
 */
async function readNativeResolution(
  deps: GiteaTrackerDeps,
  workspaceRoot: string,
  targets: readonly TicketReference[],
  pageSize: number,
  concurrency: number,
): Promise<BlockerResolution> {
  const open = targets.filter(
    (target): target is TicketReference & { readonly number: number } => target.number !== null,
  )
  if (open.length === 0) return emptyResolution()

  const repository = await readRepository(deps.run, workspaceRoot)
  const settled = await mapWithConcurrency(
    open,
    concurrency,
    async (target): Promise<SettledDependency> => {
      try {
        const blocked = await readDependencies(
          deps,
          workspaceRoot,
          repository,
          target.number,
          pageSize,
        )
        return { ref: target.ref, outcome: 'ok', blocked }
      } catch (error) {
        // 依赖功能被实例或仓库关闭（404）：整张补齐按正文解析定稿。
        if (error instanceof DependenciesUnavailable) {
          return { ref: target.ref, outcome: 'unavailable' }
        }
        // 单票查询失败（网络抖动、令牌失效）：这张票保留正文回退，不拖垮整轮补齐。
        return { ref: target.ref, outcome: 'failed' }
      }
    },
  )

  // 任一 404 都说明实例关闭了依赖功能：所有票一起退回正文解析。
  if (settled.some((entry) => entry.outcome === 'unavailable')) return emptyResolution()

  const counts = new Map<string, number>()
  const blockedBy = new Map<string, readonly string[]>()
  for (const entry of settled) {
    if (entry.outcome !== 'ok') continue
    counts.set(entry.ref, entry.blocked.open)
    if (entry.blocked.refs.length > 0) {
      blockedBy.set(entry.ref, remoteBlockerRefs(entry.blocked.refs))
    }
  }
  return { open: counts, blockedBy }
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

/** 一张开放票的原生依赖查询结果：成功（含空依赖）、功能关闭（404）或单票失败。 */
type SettledDependency =
  | { readonly ref: string; readonly outcome: 'ok'; readonly blocked: NativeBlockers }
  | { readonly ref: string; readonly outcome: 'unavailable' }
  | { readonly ref: string; readonly outcome: 'failed' }

/** 空的原生阻塞结果：后端不支持或功能关闭时用，宿主保留正文回退值。 */
function emptyResolution(): BlockerResolution {
  return { open: new Map(), blockedBy: new Map() }
}

/** 已加载工单的编号 → 状态表，供正文 `Blocked by:` 行判定未关闭数。 */
function statesOf(issues: readonly ParsedIssue[]): ReadonlyMap<number, TicketState> {
  const states = new Map<number, TicketState>()
  for (const issue of issues) {
    if (issue.ticket.number !== null) states.set(issue.ticket.number, issue.ticket.state)
  }
  return states
}

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
