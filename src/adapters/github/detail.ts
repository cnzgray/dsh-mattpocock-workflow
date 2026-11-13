/**
 * GitHub 工单详情与变更：一条 `gh issue view` 取详情，`gh issue edit` 落地标签与
 * 分配人，`gh issue close` / `reopen` 落地状态。
 *
 * 补丁表达目标集合；这里用 core 的 {@link planSetChange} 与当前值算成
 * `--add-label` / `--remove-label` 这类增量参数。
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
  sortCommentsByTime,
  type SetDiff,
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
import { callGh, readRepository, repositoryLabel, type GithubRepository } from './shared.ts'

const DETAIL_FIELDS =
  'number,title,body,state,author,labels,assignees,comments,url,createdAt,updatedAt'

const NOT_FOUND = /Could not resolve to an Issue/i

/** 详情读取与变更共用的依赖。 */
export interface GithubDetailDeps {
  readonly run: CommandRunner
}

/**
 * 读取一张 GitHub 工单的详情。
 * @param deps - 命令执行器。
 * @param workspaceRoot - 工作区根目录，用于识别仓库。
 * @param reference - 工单引用；必须有数字编号。
 * @returns 详情。
 * @throws {TrackerError} 编号不存在、命令失败或输出格式不合法。
 */
export async function readGithubDetail(
  deps: GithubDetailDeps,
  workspaceRoot: string,
  reference: TicketReference,
): Promise<TicketDetail> {
  const repository = await readRepository(deps.run, workspaceRoot)
  return readDetailWithRepository(deps, workspaceRoot, repository, reference)
}

async function readDetailWithRepository(
  deps: GithubDetailDeps,
  workspaceRoot: string,
  repository: GithubRepository,
  reference: TicketReference,
): Promise<TicketDetail> {
  const number = requireTicketNumber(reference)
  const output = await callGhDetail(deps.run, workspaceRoot, [
    'issue',
    'view',
    String(number),
    '--repo',
    repositoryLabel(repository),
    '--json',
    DETAIL_FIELDS,
  ])

  return parseDetail(output, reference)
}

/**
 * 应用一次变更补丁：先读当前值算出差异，再按各自语义发命令。
 * @param deps - 命令执行器。
 * @param workspaceRoot - 工作区根目录。
 * @param reference - 工单引用；必须有数字编号。
 * @param patch - 目标集合与目标状态。
 * @throws {TrackerError} 命令失败；已成功的前置命令不会回滚。
 */
export async function applyGithubChanges(
  deps: GithubDetailDeps,
  workspaceRoot: string,
  reference: TicketReference,
  patch: TicketPatch,
): Promise<void> {
  const number = requireTicketNumber(reference)
  const repository = await readRepository(deps.run, workspaceRoot)
  const repoArgs = ['--repo', repositoryLabel(repository)]
  const current = await readDetailWithRepository(deps, workspaceRoot, repository, reference)

  if (patch.labels !== undefined) {
    const diff = planSetChange(current.labels, patch.labels)
    await editIssue(deps.run, workspaceRoot, number, repoArgs, [
      ...diff.add.flatMap((label) => ['--add-label', label]),
      ...diff.remove.flatMap((label) => ['--remove-label', label]),
    ])
  }

  const assignees = assigneeChange(current.assignees, patch)
  if (!isEmptyDiff(assignees)) {
    await editIssue(deps.run, workspaceRoot, number, repoArgs, [
      ...assignees.add.flatMap((login) => ['--add-assignee', login]),
      ...assignees.remove.flatMap((login) => ['--remove-assignee', login]),
    ])
  }

  if (patch.state !== undefined && patch.state !== current.state) {
    const command = patch.state === 'closed' ? 'close' : 'reopen'
    await callGhDetail(deps.run, workspaceRoot, ['issue', command, String(number), ...repoArgs])
  }
}

function assigneeChange(current: readonly string[], patch: TicketPatch): SetDiff {
  if (patch.assignees === undefined && patch.assignSelf !== true) {
    return { add: [], remove: [] }
  }
  // GitHub 的编辑命令原生支持 @me，不必先查当前登录用户。
  return planSetChange(current, patch.assignees, patch.assignSelf === true ? '@me' : null)
}

async function editIssue(
  run: CommandRunner,
  workspaceRoot: string,
  number: number,
  repoArgs: readonly string[],
  flags: readonly string[],
): Promise<void> {
  if (flags.length === 0) return
  await callGhDetail(run, workspaceRoot, ['issue', 'edit', String(number), ...flags, ...repoArgs])
}

async function callGhDetail(
  run: CommandRunner,
  workspaceRoot: string,
  args: readonly string[],
): Promise<string> {
  try {
    return await callGh(run, workspaceRoot, args)
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

function parseDetail(output: string, reference: TicketReference): TicketDetail {
  let payload: unknown
  try {
    payload = JSON.parse(output)
  } catch (error) {
    throw new TrackerError('fetch-failed', 'GitHub 返回的工单详情不是有效 JSON。', {
      cause: error,
    })
  }
  if (!isRecord(payload)) throw invalidDetail('工单详情不是对象')

  return {
    ref: reference.ref,
    number: readNumber(payload.number),
    title: readRequiredString(payload.title, '标题'),
    state: readState(payload.state),
    author: isRecord(payload.author) ? readOptionalString(payload.author.login) : null,
    body: typeof payload.body === 'string' ? payload.body : '',
    labels: readNameList(payload.labels),
    assignees: readUserNames(payload.assignees, 'login'),
    comments: readComments(payload.comments),
    url: readOptionalString(payload.url),
    createdAt: readRequiredString(payload.createdAt, '创建时间'),
    updatedAt: readRequiredString(payload.updatedAt, '更新时间'),
  }
}

function readState(value: unknown): TicketState {
  if (value === 'OPEN') return 'open'
  if (value === 'CLOSED') return 'closed'
  throw invalidDetail('状态不是 OPEN 或 CLOSED')
}

function readComments(value: unknown): readonly TicketComment[] {
  if (!Array.isArray(value)) return []

  const comments: TicketComment[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const body = typeof entry.body === 'string' ? entry.body : ''
    if (body.length === 0) continue
    comments.push({
      author: isRecord(entry.author) ? readOptionalString(entry.author.login) : null,
      body,
      createdAt: readOptionalString(entry.createdAt),
    })
  }

  return sortCommentsByTime(comments)
}

function readNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw invalidDetail('编号不是正整数')
  }
  return value
}
