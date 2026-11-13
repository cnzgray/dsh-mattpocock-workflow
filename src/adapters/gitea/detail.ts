/**
 * Gitea 工单详情与变更。
 *
 * - 详情：issue 接口取正文、标签、分配人、链接与状态；comments 接口分页取评论；
 * - 变更：标签用 `--add-labels` / `--remove-labels`；分配人用整体替换语义的
 *   `--set-assignees`（空串表示清空）；状态用关闭 / 重开命令。
 */
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

async function readComments(
  deps: GiteaDetailDeps,
  workspaceRoot: string,
  repository: GiteaRepository,
  number: number,
): Promise<readonly TicketComment[]> {
  const comments: TicketComment[] = []

  for (let page = 1; ; page += 1) {
    const endpoint = `/repos/${repository.owner}/${repository.name}/issues/${String(number)}/comments?page=${String(page)}&limit=${String(deps.pageSize)}`
    const response = await callGiteaApi(deps.run, workspaceRoot, endpoint)
    ensureDetailSuccess(response, '读取 Gitea 工单评论')
    const parsed = parseCommentsPage(response.body)
    comments.push(...parsed)
    if (parsed.length < deps.pageSize) break
  }

  return sortCommentsByTime(comments)
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

function parseCommentsPage(body: string): readonly TicketComment[] {
  const payload = parseJson(body)
  if (!Array.isArray(payload)) throw invalidDetail('评论列表不是数组')

  const comments: TicketComment[] = []
  for (const entry of payload) {
    if (!isRecord(entry)) continue
    const text = typeof entry.body === 'string' ? entry.body : ''
    if (text.length === 0) continue
    comments.push({
      author: isRecord(entry.user) ? readOptionalString(entry.user.login) : null,
      body: text,
      createdAt: readOptionalString(entry.created_at),
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
