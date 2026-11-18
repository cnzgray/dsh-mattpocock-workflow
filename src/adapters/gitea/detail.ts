/**
 * Gitea 工单详情与变更。
 *
 * - 详情：issue 接口取正文、标签、分配人、链接与状态；comments 接口分页取评论；
 * - 变更：标签用 `--add-labels` / `--remove-labels`；分配人用整体替换语义的
 *   `--set-assignees`（空串表示清空）；状态用关闭 / 重开命令。
 */
import { mapWithConcurrency } from '../../core/concurrency.ts'
import { isRecord } from '../../core/json.ts'
import {
  invalidDetail,
  isEmptyDiff,
  planSetChange,
  readNameList,
  readOptionalString,
  readRequiredString,
  readUserNames,
  requireTicketNumber,
  resolveTargetSet,
  sortCommentsByTime,
} from '../../core/ticket-detail.ts'
import type {
  CommandRunner,
  TicketComment,
  TicketDetail,
  TicketPatch,
  TicketReference,
  TicketState,
} from '../../core/ticket.ts'
import { TrackerError } from '../../core/tracker-error.ts'
import type { ApiResponse } from './parse.ts'
import {
  callGiteaApi,
  callTea,
  ensureSuccess,
  readRepository,
  type GiteaRepository,
} from './shared.ts'

/** 详情读取与变更共用的依赖。 */
export interface GiteaDetailDeps {
  readonly run: CommandRunner
  /** 单页大小；与列表共用同一个配置。 */
  readonly pageSize: number
  /** 按总数补齐剩余评论页时的并发上限。 */
  readonly concurrency: number
}

/** issue 接口里详情与变更都要用到的字段。 */
interface GiteaIssue {
  readonly title: string
  readonly state: TicketState
  readonly author: string | null
  readonly body: string
  readonly labels: readonly string[]
  readonly assignees: readonly string[]
  readonly url: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * 读取一张 Gitea 工单的详情。
 * @param deps - 命令执行器与分页大小。
 * @param workspaceRoot - 工作区根目录。
 * @param reference - 工单引用；必须有数字编号。
 * @returns 详情与按时间升序的评论。
 * @throws {TrackerError} 编号不存在、命令失败或输出格式不合法。
 */
export async function readGiteaDetail(
  deps: GiteaDetailDeps,
  workspaceRoot: string,
  reference: TicketReference,
): Promise<TicketDetail> {
  const number = requireTicketNumber(reference)
  const repository = await readRepository(deps.run, workspaceRoot)
  const issue = await readIssue(deps, workspaceRoot, repository, number)
  const comments = await readComments(deps, workspaceRoot, repository, number)

  return {
    ref: reference.ref,
    number,
    title: issue.title,
    state: issue.state,
    author: issue.author,
    body: issue.body,
    uploadsBaseUrl: null,
    labels: issue.labels,
    assignees: issue.assignees,
    comments,
    url: issue.url,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
  }
}

/**
 * 应用一次变更补丁。
 * @param deps - 命令执行器与分页大小。
 * @param workspaceRoot - 工作区根目录。
 * @param reference - 工单引用；必须有数字编号。
 * @param patch - 目标集合与目标状态。
 * @throws {TrackerError} 命令失败；已成功的前置命令不会回滚。
 */
export async function applyGiteaChanges(
  deps: GiteaDetailDeps,
  workspaceRoot: string,
  reference: TicketReference,
  patch: TicketPatch,
): Promise<void> {
  const number = requireTicketNumber(reference)
  const repository = await readRepository(deps.run, workspaceRoot)
  const current = await readIssue(deps, workspaceRoot, repository, number)

  if (patch.labels !== undefined) {
    const diff = planSetChange(current.labels, patch.labels)
    if (!isEmptyDiff(diff)) {
      await callTea(deps.run, workspaceRoot, [
        'issues',
        'edit',
        String(number),
        ...(diff.add.length === 0 ? [] : ['--add-labels', diff.add.join(',')]),
        ...(diff.remove.length === 0 ? [] : ['--remove-labels', diff.remove.join(',')]),
      ])
    }
  }

  if (patch.assignees !== undefined || patch.assignSelf === true) {
    const self = patch.assignSelf === true ? await readCurrentLogin(deps.run, workspaceRoot) : null
    const target = resolveTargetSet(current.assignees, patch.assignees, self)
    await callTea(deps.run, workspaceRoot, [
      'issues',
      'edit',
      String(number),
      '--set-assignees',
      target.join(','),
    ])
  }

  if (patch.state !== undefined && patch.state !== current.state) {
    await callTea(deps.run, workspaceRoot, [
      'issues',
      patch.state === 'closed' ? 'close' : 'reopen',
      String(number),
    ])
  }
}

async function readIssue(
  deps: GiteaDetailDeps,
  workspaceRoot: string,
  repository: GiteaRepository,
  number: number,
): Promise<GiteaIssue> {
  const response = await callGiteaApi(
    deps.run,
    workspaceRoot,
    `/repos/${repository.owner}/${repository.name}/issues/${String(number)}`,
  )
  ensureDetailSuccess(response, '读取 Gitea 工单详情')
  return parseIssue(response.body)
}

/**
 * 评论分页的硬上界。
 *
 * 总数已知时页数由总数决定，这个上限仍生效：超过 200 页（默认 50 条一页即
 * 1 万条评论）的部分不再读取。总数未知时它兜住「服务端既不给总数、又反复
 * 返回同一批满页评论」的部署，避免详情读取永远不返回。
 */
const MAX_COMMENT_PAGES = 200

/** 一页评论与其响应头里的权威总数。 */
interface CommentsPage {
  readonly entries: readonly ParsedComment[]
  readonly total: number | undefined
}

async function readComments(
  deps: GiteaDetailDeps,
  workspaceRoot: string,
  repository: GiteaRepository,
  number: number,
): Promise<readonly TicketComment[]> {
  // 按 id 去重：有的 Gitea 部署忽略 page / limit，每页都返回全部评论，
  // 只按「本页条数」收口会无限重读同一批。
  const collected = new Map<string, TicketComment>()

  const absorb = (entries: readonly ParsedComment[]): number => {
    let added = 0
    for (const entry of entries) {
      const key = commentKey(entry)
      if (collected.has(key)) continue
      collected.set(key, entry.comment)
      added += 1
    }
    return added
  }

  const finish = (): readonly TicketComment[] => sortCommentsByTime([...collected.values()])

  // 前两页顺序读：只有第二页确实带来新评论，才敢按总数把剩余页并发补齐。
  // 忽略分页的部署在这里就被收口，不会把每页都返回全部评论的接口放大成并发请求。
  const first = await readCommentsPage(deps, workspaceRoot, repository, number, 1)
  absorb(first.entries)
  if (first.total !== undefined && collected.size >= first.total) return finish()
  if (first.entries.length < deps.pageSize) return finish()

  const second = await readCommentsPage(deps, workspaceRoot, repository, number, 2)
  if (absorb(second.entries) === 0) return finish()

  const total = first.total
  if (total === undefined) {
    // 拿不到权威总数，只能按短页与「本页没有新增」继续顺序探测。
    for (let page = 3; page <= MAX_COMMENT_PAGES; page += 1) {
      const next = await readCommentsPage(deps, workspaceRoot, repository, number, page)
      const added = absorb(next.entries)
      if (added === 0) break
      if (next.total !== undefined && collected.size >= next.total) break
      if (next.entries.length < deps.pageSize) break
    }
    return finish()
  }

  // 总数已知：页数固定，剩余页并发补齐；顺序由最后的时间排序恢复。
  const lastPage = Math.min(Math.ceil(total / deps.pageSize), MAX_COMMENT_PAGES)
  const rest = Array.from({ length: Math.max(0, lastPage - 2) }, (_, index) => index + 3)
  const pages = await mapWithConcurrency(rest, deps.concurrency, (page) =>
    readCommentsPage(deps, workspaceRoot, repository, number, page),
  )
  for (const page of pages) absorb(page.entries)
  return finish()
}

async function readCommentsPage(
  deps: GiteaDetailDeps,
  workspaceRoot: string,
  repository: GiteaRepository,
  number: number,
  page: number,
): Promise<CommentsPage> {
  const endpoint = `/repos/${repository.owner}/${repository.name}/issues/${String(number)}/comments?page=${String(page)}&limit=${String(deps.pageSize)}`
  const response = await callGiteaApi(deps.run, workspaceRoot, endpoint)
  ensureDetailSuccess(response, '读取 Gitea 工单评论')
  return { entries: parseCommentsPage(response.body), total: response.total }
}

/**
 * 去重键：服务端 id 是评论的稳定身份。正文可能被编辑，不放进键里——
 * 翻页期间改了正文不应该让同一条评论出现两次。没有 id 的部署退回内容。
 */
function commentKey(entry: ParsedComment): string {
  if (entry.id !== null) return `id\u0000${String(entry.id)}`
  return [
    'content',
    entry.comment.createdAt ?? '',
    entry.comment.author ?? '',
    entry.comment.body,
  ].join('\u0000')
}

async function readCurrentLogin(run: CommandRunner, workspaceRoot: string): Promise<string> {
  const response = await callGiteaApi(run, workspaceRoot, '/user')
  ensureDetailSuccess(response, '读取 Gitea 当前用户')
  const payload = parseJson(response.body)
  if (!isRecord(payload)) throw invalidDetail('当前用户不是对象')
  const login = payload.login
  if (typeof login !== 'string' || login.length === 0) {
    throw invalidDetail('当前用户缺少 login')
  }
  return login
}

/** 404 是「这张票不存在」，与普通的执行失败分开。 */
function ensureDetailSuccess(response: ApiResponse, action: string): void {
  if (response.status === 404) {
    throw new TrackerError('ticket-not-found', '找不到这张工单，它可能已被删除。')
  }
  ensureSuccess(response, action)
}

/** 一条评论及其服务端 id；id 缺失时去重退回内容。 */
interface ParsedComment {
  readonly id: number | null
  readonly comment: TicketComment
}

function parseIssue(body: string): GiteaIssue {
  const payload = parseJson(body)
  if (!isRecord(payload)) throw invalidDetail('工单详情不是对象')

  return {
    title: readRequiredString(payload.title, '标题'),
    state: readState(payload.state),
    author: isRecord(payload.user) ? readOptionalString(payload.user.login) : null,
    body: typeof payload.body === 'string' ? payload.body : '',
    labels: readNameList(payload.labels),
    assignees: readUserNames(payload.assignees, 'login'),
    url: readOptionalString(payload.html_url),
    createdAt: readRequiredString(payload.created_at, '创建时间'),
    updatedAt: readRequiredString(payload.updated_at, '更新时间'),
  }
}

function parseCommentsPage(body: string): readonly ParsedComment[] {
  const payload = parseJson(body)
  if (!Array.isArray(payload)) throw invalidDetail('评论列表不是数组')

  const comments: ParsedComment[] = []
  for (const entry of payload) {
    if (!isRecord(entry)) continue
    const text = typeof entry.body === 'string' ? entry.body : ''
    if (text.length === 0) continue
    comments.push({
      id: typeof entry.id === 'number' ? entry.id : null,
      comment: {
        author: isRecord(entry.user) ? readOptionalString(entry.user.login) : null,
        body: text,
        createdAt: readOptionalString(entry.created_at),
      },
    })
  }
  return comments
}

function readState(value: unknown): TicketState {
  if (value === 'open') return 'open'
  if (value === 'closed') return 'closed'
  throw invalidDetail('状态不是 open 或 closed')
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch (error) {
    throw new TrackerError('fetch-failed', 'Gitea 返回的不是有效 JSON。', { cause: error })
  }
}
