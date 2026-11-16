/**
 * GitLab 工单详情与变更。
 *
 * - 详情：issue 接口取正文、标签、分配人、链接与状态；notes 接口分页取评论，
 *   system note（改标签、改状态这类事件）不算评论，直接跳过；
 * - 变更：标签用 `--label` / `--unlabel` 增量；分配人按整体替换语义给出完整名单，
 *   清空时用 `!` 前缀逐个移除；状态用关闭 / 重开命令。
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
import { CommandError, TrackerError } from '../../core/tracker-error.ts'
import { callGlab, callGlabApi, projectEndpoint, readProjectPath } from './shared.ts'

const NOT_FOUND = /404 Not Found|404 page not found|Not Found/i

/** 详情读取与变更共用的依赖。 */
export interface GitlabDetailDeps {
  readonly run: CommandRunner
  /** notes 接口的分页大小；与列表共用同一个配置。 */
  readonly pageSize: number
}

/** issue 接口里详情与变更都要用到的字段。 */
interface GitlabIssue {
  readonly title: string
  readonly state: TicketState
  readonly author: string | null
  readonly body: string
  readonly labels: readonly string[]
  readonly assignees: readonly string[]
  readonly url: string | null
  /** 项目数字 id：正文里的上传附件地址按它补全成 `/-/project/<id>/uploads/...`。 */
  readonly projectId: number | null
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * 读取一张 GitLab 工单的详情。
 * @param deps - 命令执行器与分页大小。
 * @param workspaceRoot - 工作区根目录。
 * @param reference - 工单引用；必须有数字编号。
 * @returns 详情与按时间升序的评论。
 * @throws {TrackerError} 编号不存在、命令失败或输出格式不合法。
 */
export async function readGitlabDetail(
  deps: GitlabDetailDeps,
  workspaceRoot: string,
  reference: TicketReference,
): Promise<TicketDetail> {
  const iid = requireTicketNumber(reference)
  const project = await readProjectPath(deps.run, workspaceRoot)
  const issue = await readIssue(deps, workspaceRoot, project, iid)
  const comments = await readNotes(deps, workspaceRoot, project, iid)

  return {
    ref: reference.ref,
    number: iid,
    title: issue.title,
    state: issue.state,
    author: issue.author,
    body: issue.body,
    uploadsBaseUrl: projectUploadsBase(issue.url, issue.projectId),
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
export async function applyGitlabChanges(
  deps: GitlabDetailDeps,
  workspaceRoot: string,
  reference: TicketReference,
  patch: TicketPatch,
): Promise<void> {
  const iid = requireTicketNumber(reference)
  const project = await readProjectPath(deps.run, workspaceRoot)
  const current = await readIssue(deps, workspaceRoot, project, iid)

  if (patch.labels !== undefined) {
    const diff = planSetChange(current.labels, patch.labels)
    if (!isEmptyDiff(diff)) {
      await callGlab(deps.run, workspaceRoot, [
        'issue',
        'update',
        String(iid),
        ...(diff.add.length === 0 ? [] : ['--label', diff.add.join(',')]),
        ...(diff.remove.length === 0 ? [] : ['--unlabel', diff.remove.join(',')]),
      ])
    }
  }

  if (patch.assignees !== undefined || patch.assignSelf === true) {
    const self =
      patch.assignSelf === true ? await readCurrentUsername(deps.run, workspaceRoot) : null
    await updateAssignees(deps, workspaceRoot, iid, current.assignees, patch, self)
  }

  if (patch.state !== undefined && patch.state !== current.state) {
    await callGlab(deps.run, workspaceRoot, [
      'issue',
      patch.state === 'closed' ? 'close' : 'reopen',
      String(iid),
    ])
  }
}

async function updateAssignees(
  deps: GitlabDetailDeps,
  workspaceRoot: string,
  iid: number,
  current: readonly string[],
  patch: TicketPatch,
  self: string | null,
): Promise<void> {
  const target = resolveTargetSet(current, patch.assignees, self)

  // 有目标名单就用整体替换语义；目标为空时逐个加 `!` 前缀移除，这是 glab 文档里的取消分配方式。
  const assigneeArgs =
    target.length > 0
      ? ['--assignee', target.join(',')]
      : current.flatMap((username) => ['--assignee', `!${username}`])
  if (assigneeArgs.length === 0) return

  await callGlab(deps.run, workspaceRoot, ['issue', 'update', String(iid), ...assigneeArgs])
}

async function readIssue(
  deps: GitlabDetailDeps,
  workspaceRoot: string,
  project: string,
  iid: number,
): Promise<GitlabIssue> {
  const endpoint = `${projectEndpoint(project)}/issues/${String(iid)}`
  return parseIssue(await callGlabForDetail(deps.run, workspaceRoot, endpoint))
}

async function readNotes(
  deps: GitlabDetailDeps,
  workspaceRoot: string,
  project: string,
  iid: number,
): Promise<readonly TicketComment[]> {
  const comments: TicketComment[] = []

  for (let page = 1; ; page += 1) {
    const endpoint = `${projectEndpoint(project)}/issues/${String(iid)}/notes?per_page=${String(deps.pageSize)}&page=${String(page)}`
    const parsed = parseNotesPage(await callGlabForDetail(deps.run, workspaceRoot, endpoint))
    comments.push(...parsed.comments)
    // 分页按接口返回的条数判断：system note 被过滤后仍要按原始条数决定是否继续翻页。
    if (parsed.received < deps.pageSize) break
  }

  return sortCommentsByTime(comments)
}

async function readCurrentUsername(run: CommandRunner, workspaceRoot: string): Promise<string> {
  const payload = parseJson(await callGlabApi(run, workspaceRoot, 'user'))
  if (!isRecord(payload)) throw invalidDetail('当前用户不是对象')
  const username = payload.username
  if (typeof username !== 'string' || username.length === 0) {
    throw invalidDetail('当前用户缺少 username')
  }
  return username
}

async function callGlabForDetail(
  run: CommandRunner,
  workspaceRoot: string,
  endpoint: string,
): Promise<string> {
  try {
    return await callGlabApi(run, workspaceRoot, endpoint)
  } catch (error) {
    if (
      error instanceof TrackerError &&
      error.cause instanceof CommandError &&
      NOT_FOUND.test(error.cause.stderr)
    ) {
      throw new TrackerError('ticket-not-found', '找不到这张工单，它可能已被删除。', {
        cause: error,
      })
    }
    throw error
  }
}

function parseIssue(output: string): GitlabIssue {
  const payload = parseJson(output)
  if (!isRecord(payload)) throw invalidDetail('工单详情不是对象')

  return {
    title: readRequiredString(payload.title, '标题'),
    state: readState(payload.state),
    author: isRecord(payload.author) ? readOptionalString(payload.author.username) : null,
    body: typeof payload.description === 'string' ? payload.description : '',
    labels: readNameList(payload.labels),
    assignees: readUserNames(payload.assignees, 'username'),
    url: readOptionalString(payload.web_url),
    // 上传附件的补全依赖项目 id；缺失时不猜，正文原样返回。
    projectId:
      typeof payload.project_id === 'number' &&
      Number.isInteger(payload.project_id) &&
      payload.project_id > 0
        ? payload.project_id
        : null,
    createdAt: readRequiredString(payload.created_at, '创建时间'),
    updatedAt: readRequiredString(payload.updated_at, '更新时间'),
  }
}

/**
 * 正文里 `/uploads/` 附件的补全前缀：`<实例源>/-/project/<id>/uploads/`。
 * GitLab 把拖进正文的附件写成根相对路径 `/uploads/<secret>/<filename>`，网页端按项目
 * id 补成上面的绝对地址；面板不在 GitLab 的源上，不补全会落到面板自己的 origin 上。
 * 网页地址不可解析、缺项目 id 或不是 http(s) 时返回 null，界面保持原样。
 * @param url - issue 的网页地址。
 * @param projectId - 项目数字 id。
 * @returns 补全前缀或 null。
 */
function projectUploadsBase(url: string | null, projectId: number | null): string | null {
  if (url === null || projectId === null) return null
  let origin: string
  try {
    origin = new URL(url).origin
  } catch {
    return null
  }
  // 非 http(s) 协议没有源，补出来反而是坏地址。
  if (origin === 'null') return null
  return `${origin}/-/project/${String(projectId)}/uploads/`
}

function parseNotesPage(output: string): {
  readonly comments: readonly TicketComment[]
  /** 接口返回的原始条数，system note 也算；用于判断是否还有下一页。 */
  readonly received: number
} {
  const payload = parseJson(output)
  if (!Array.isArray(payload)) throw invalidDetail('评论列表不是数组')

  const comments: TicketComment[] = []
  for (const note of payload) {
    if (!isRecord(note)) continue
    // system note 是“改了标签 / 关了工单”这类事件，不是讨论内容。
    if (note.system === true) continue
    const body = typeof note.body === 'string' ? note.body : ''
    if (body.length === 0) continue
    comments.push({
      author: isRecord(note.author) ? readOptionalString(note.author.username) : null,
      body,
      createdAt: readOptionalString(note.created_at),
    })
  }
  return { comments, received: payload.length }
}

function readState(value: unknown): TicketState {
  if (value === 'opened') return 'open'
  if (value === 'closed') return 'closed'
  throw invalidDetail('状态不是 opened 或 closed')
}

function parseJson(output: string): unknown {
  try {
    return JSON.parse(output)
  } catch (error) {
    throw new TrackerError('fetch-failed', 'GitLab 返回的不是有效 JSON。', { cause: error })
  }
}
