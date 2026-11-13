/**
 * GitLab 工单后端：通过注入的 {@link CommandRunner} 调用 `git` 与 `glab`。
 *
 * - 仓库标识来自 core 的远端解析，API 里用完整路径的 URL 编码形式寻址，
 *   不依赖当前目录的默认项目推断；
 * - 只读 issue 接口，merge request 不会混进来；详情、变更、补全候选与删除分别在
 *   `detail.ts`、`options.ts`、`delete.ts`，只在界面需要时执行；
 * - 首屏只列票，阻塞数先按描述里的 `Blocked by:` 回退；原生阻塞数在
 *   `resolveBlockers` 补齐阶段读取，能力探测不占首屏时间；
 * - 列表响应带 `blocking_issues_count` 时直接判定实例支持原生阻塞；
 *   否则按实例主机只探测一次：一次 `/issues/:iid/links` 返回
 *   `200` + 空数组、`403`/`404` 或异常都判定为不支持，之后只用描述里的
 *   `Blocked by:` 回退，不再逐票试探；
 * - 支持的实例用一次批量 GraphQL 查询取回所有开放票的 `blockedByCount`，
 *   不逐票请求 links；阻塞引用需要票号，只对真有未关闭阻塞的票再读一次 links。
 */
import {
  hasDescriptionBlockers,
  remoteBlockerRefs,
  resolveOpenBlockers,
} from '../../core/blocked-by.ts'
import { mapWithConcurrency } from '../../core/concurrency.ts'
import type { RepositoryAddress } from '../../core/remote.ts'
import type {
  BlockerResolution,
  CommandRunner,
  Ticket,
  TicketReference,
  TicketState,
  Tracker,
  TrackerChanges,
  TrackerSnapshot,
} from '../../core/ticket.ts'
import { TrackerError } from '../../core/tracker-error.ts'
import { deleteGitlabTicket, readGitlabDeletePermission } from './delete.ts'
import { applyGitlabChanges, readGitlabDetail } from './detail.ts'
import { readGitlabOptions } from './options.ts'
import {
  hasNativeBlockingLinks,
  parseBlockedByCounts,
  parseIssuesPage,
  parseNativeBlockers,
  type ParsedIssue,
} from './parse.ts'
import { mapGlabError, projectEndpoint, readProjectAddress } from './shared.ts'

/** GitLab 后端依赖。 */
export interface GitlabTrackerDeps {
  readonly run: CommandRunner
  readonly now: () => number
  /** 单页大小；默认 100，测试可以调小以便构造分页。 */
  readonly pageSize?: number
  /** 一次增量刷新最多翻几页；默认 5，超过即标记截断。 */
  readonly incrementalPageLimit?: number
  /**
   * 原生阻塞能力探测缓存，键为实例主机。生产环境由后端解析器共享，
   * 同一实例上的多个工作区只探测一次；单独创建 tracker 时默认各自一份。
   */
  readonly blockerCapability?: Map<string, Promise<boolean>>
  /** 补齐阻塞引用时逐票查询 blocking link 的并发上限。 */
  readonly concurrency?: number
}

const DEFAULT_PAGE_SIZE = 100
/** 增量窗口最多翻的页数；再多就标记截断，由宿主退回全量。 */
const DEFAULT_INCREMENTAL_PAGE_LIMIT = 5
/** GraphQL 的 `first` 上限；开放票更多时分批查询。 */
const BLOCKER_COUNT_BATCH = 100
const DEFAULT_CONCURRENCY = 8

/**
 * 创建 GitLab 工单后端。
 * @param deps - 命令执行器、时钟与可选的页大小、能力探测缓存。
 * @returns 满足 core `Tracker` 契约的后端。
 */
export function createGitlabTracker(deps: GitlabTrackerDeps): Tracker {
  const pageSize = normalizePositive(deps.pageSize ?? DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE)
  const incrementalPageLimit = normalizePositive(
    deps.incrementalPageLimit ?? DEFAULT_INCREMENTAL_PAGE_LIMIT,
    DEFAULT_INCREMENTAL_PAGE_LIMIT,
  )
  const concurrency = normalizePositive(
    deps.concurrency ?? DEFAULT_CONCURRENCY,
    DEFAULT_CONCURRENCY,
  )
  const blockerCapability = deps.blockerCapability ?? new Map<string, Promise<boolean>>()
  const detailDeps = { run: deps.run, pageSize }

  // 最近一次列表留下的探测线索，供补齐阶段选探测票；键为工作区根目录。
  const hints = new Map<string, BlockerHint>()

  return {
    async fetchSnapshot(workspaceRoot: string): Promise<TrackerSnapshot> {
      const project = await readProjectAddress(deps.run, workspaceRoot)
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

    async fetchChanges(workspaceRoot: string, since: number): Promise<TrackerChanges> {
      const listing = { pageSize, pageLimit: incrementalPageLimit }
      return readGitlabChanges(deps, workspaceRoot, listing, since)
    },

    async resolveBlockers(workspaceRoot, targets) {
      const open = targets.filter(
        (target): target is TicketReference & { readonly number: number } => target.number !== null,
      )
      if (open.length === 0) return emptyResolution()

      const hint = hints.get(workspaceRoot) ?? {
        project: await readProjectAddress(deps.run, workspaceRoot),
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
      if (!supported) return emptyResolution()

      const counts = await readBlockedByCounts(deps, workspaceRoot, hint.project.path, open)
      const native = new Map<string, number>()
      for (const target of open) {
        const count = counts.get(target.number)
        if (count !== undefined) native.set(target.ref, count)
      }
      const blockedBy = await readBlockedByRefs(
        deps,
        workspaceRoot,
        hint.project.path,
        open,
        native,
        concurrency,
      )

      return { open: native, blockedBy }
    },

    fetchDetail: (workspaceRoot, reference) =>
      readGitlabDetail(detailDeps, workspaceRoot, reference),

    updateTicket: (workspaceRoot, reference, patch) =>
      applyGitlabChanges(detailDeps, workspaceRoot, reference, patch),

    fetchOptions: (workspaceRoot) => readGitlabOptions(detailDeps, workspaceRoot),

    canDeleteTickets: (workspaceRoot) => readGitlabDeletePermission(deps, workspaceRoot),

    deleteTicket: (workspaceRoot, reference) => deleteGitlabTicket(deps, workspaceRoot, reference),
  }
}

/** 空的补齐结果：后端不支持原生阻塞关系时用。 */
function emptyResolution(): BlockerResolution {
  return { open: new Map(), blockedBy: new Map() }
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

/** 列表阶段的翻页参数。 */
interface GitlabListing {
  readonly pageSize: number
  /** 增量窗口最多翻几页；再多就标记截断。 */
  readonly pageLimit: number
}

/**
 * 读取某个时刻之后变更过的工单。
 *
 * 与列表查询走同一个接口、同一套过滤条件，只多一个时间窗口；翻页按更新时间升序，
 * 到页数上限就标记截断，由宿主改用全量重拉，不把没取全的增量当成完整结果。
 */
async function readGitlabChanges(
  deps: GitlabTrackerDeps,
  workspaceRoot: string,
  listing: GitlabListing,
  since: number,
): Promise<TrackerChanges> {
  if (!Number.isFinite(since)) {
    throw new TrackerError('fetch-failed', '增量窗口的起点不是有效时间戳。')
  }

  const project = await readProjectAddress(deps.run, workspaceRoot)
  const { issues, truncated } = await readChangedIssues(
    deps,
    workspaceRoot,
    project.path,
    listing,
    new Date(since).toISOString(),
  )

  return {
    // 增量只负责取回变更过的票，阻塞判定由宿主在合并后统一处理。
    tickets: issues.map((issue) => issue.ticket),
    truncated,
  }
}

/**
 * 读取一页页的工单。
 *
 * 没有时间窗口：列表要覆盖全部工单，读到不足一页为止。
 */
async function readIssues(
  deps: GitlabTrackerDeps,
  workspaceRoot: string,
  project: string,
  pageSize: number,
): Promise<ParsedIssue[]> {
  const issues: ParsedIssue[] = []

  for (let page = 1; ; page += 1) {
    const parsed = await readIssuesPage(deps, workspaceRoot, project, pageSize, page)
    issues.push(...parsed)
    if (parsed.length < pageSize) return issues
  }
}

/**
 * 只读增量窗口：按更新时间升序翻页，最多翻 `pageLimit` 页。
 *
 * 到上限时再探一页确认是否还有内容，避免整页倍数时误报截断；
 * 探到的票不并入本次结果——本次结果已经标记为截断，宿主会全量重拉。
 */
async function readChangedIssues(
  deps: GitlabTrackerDeps,
  workspaceRoot: string,
  project: string,
  listing: GitlabListing,
  updatedAfter: string,
): Promise<{ readonly issues: ParsedIssue[]; readonly truncated: boolean }> {
  const issues: ParsedIssue[] = []

  for (let page = 1; page <= listing.pageLimit; page += 1) {
    const parsed = await readIssuesPage(
      deps,
      workspaceRoot,
      project,
      listing.pageSize,
      page,
      updatedAfter,
    )
    issues.push(...parsed)
    if (parsed.length < listing.pageSize) return { issues, truncated: false }
  }

  const probe = await readIssuesPage(
    deps,
    workspaceRoot,
    project,
    listing.pageSize,
    listing.pageLimit + 1,
    updatedAfter,
  )
  return { issues, truncated: probe.length > 0 }
}

async function readIssuesPage(
  deps: GitlabTrackerDeps,
  workspaceRoot: string,
  project: string,
  pageSize: number,
  page: number,
  updatedAfter?: string,
): Promise<ParsedIssue[]> {
  const endpoint = issuesEndpoint(project, pageSize, page, updatedAfter)
  let output: string
  try {
    output = (await deps.run('glab', ['api', endpoint], { cwd: workspaceRoot })).stdout
  } catch (error) {
    throw mapGlabError(error)
  }
  return parseIssuesPage(output)
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
  open: readonly (TicketReference & { readonly number: number })[],
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
  open: readonly (TicketReference & { readonly number: number })[],
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

/**
 * 补齐阻塞引用。批量计数只有数量、没有票号，所以对真有阻塞的票再读一次 links；
 * 没有阻塞的票不请求，避免回到逐票查询。
 * @param deps - 命令执行器与时钟。
 * @param workspaceRoot - 工作区根目录。
 * @param project - 项目路径。
 * @param open - 开放票的引用。
 * @param counts - 已读到的未关闭阻塞数（`ref → 数量`）。
 * @param concurrency - 逐票请求的并发上限。
 * @returns `ref → 阻塞票引用`。
 */
async function readBlockedByRefs(
  deps: GitlabTrackerDeps,
  workspaceRoot: string,
  project: string,
  open: readonly (TicketReference & { readonly number: number })[],
  counts: ReadonlyMap<string, number>,
  concurrency: number,
): Promise<ReadonlyMap<string, readonly string[]>> {
  const blocked = open.filter((target) => (counts.get(target.ref) ?? 0) > 0)
  if (blocked.length === 0) return new Map()

  const refs = await mapWithConcurrency(blocked, concurrency, async (target) => {
    const endpoint = `${projectEndpoint(project)}/issues/${String(target.number)}/links`
    try {
      const output = (await deps.run('glab', ['api', endpoint], { cwd: workspaceRoot })).stdout
      return [target.ref, remoteBlockerRefs(parseNativeBlockers(output).refs)] as const
    } catch {
      // 读不到引用只影响链深度，计数已经拿到，不让整次补齐失败。
      return [target.ref, [] as readonly string[]] as const
    }
  })

  return new Map(refs.filter(([, value]) => value.length > 0))
}

function withOpenBlockers(issue: ParsedIssue, states: ReadonlyMap<number, TicketState>): Ticket {
  const resolved = resolveOpenBlockers({
    ticket: issue.ticket,
    nativeBlockers: undefined,
    text: issue.description,
    states,
  })

  return {
    ...issue.ticket,
    openBlockers: resolved.openBlockers,
    blockedBy: resolved.blockedBy,
  }
}

/**
 * 工单列表接口。
 *
 * 增量查询只在同一条路径上加 `updated_after`：语义是「更新时间在该时刻之后」，
 * 边界不含，边界上的票由宿主向前重叠一段时间兜底。其余参数（状态、页大小、页码）
 * 与列表完全一致，避免增量与全量口径不同；增量另按更新时间升序翻页，
 * 截断后重新拉取的窗口从同一批票开始，不会跳过中间的票。
 */
function issuesEndpoint(
  project: string,
  pageSize: number,
  page: number,
  updatedAfter?: string,
): string {
  const query = ['state=all']
  if (updatedAfter !== undefined) {
    query.push('order_by=updated_at', 'sort=asc', `updated_after=${updatedAfter}`)
  }
  query.push(`per_page=${String(pageSize)}`, `page=${String(page)}`)
  return `${projectEndpoint(project)}/issues?${query.join('&')}`
}

function normalizePositive(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(1, Math.trunc(value))
}
