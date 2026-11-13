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
  TrackerSnapshot,
} from '../../core/ticket.ts'
import { deleteGiteaTicket, readGiteaDeletePermission } from './delete.ts'
import { applyGiteaChanges, readGiteaDetail } from './detail.ts'
import { readGiteaOptions } from './options.ts'
import { parseDependencies, parseIssuesPage, type ParsedIssue } from './parse.ts'
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
    async fetchSnapshot(workspaceRoot: string): Promise<TrackerSnapshot> {
      const repository = await readRepository(deps.run, workspaceRoot)
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
      }
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

async function readIssues(
  deps: GiteaTrackerDeps,
  workspaceRoot: string,
  repository: GiteaRepository,
  pageSize: number,
): Promise<{ readonly items: ParsedIssue[]; readonly total: number | undefined }> {
  const items: ParsedIssue[] = []
  let total: number | undefined

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await callGiteaApi(
      deps.run,
      workspaceRoot,
      issuesEndpoint(repository, pageSize, page),
    )
    ensureSuccess(response, '读取 Gitea 工单')

    const parsed = parseIssuesPage(response.body, repository.avatarBaseUrl)
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
