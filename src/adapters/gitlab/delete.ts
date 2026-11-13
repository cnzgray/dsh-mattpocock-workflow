/**
 * GitLab 的删除权限与删除：项目与群组 access_level 取较大值，达到 Owner（50）
 * 才允许删除；否则再看当前用户是不是实例管理员。删除走 `glab api --method DELETE`，
 * 避免 `glab issue delete` 弹出交互确认。
 */
import { isRecord } from '../../core/json.ts'
import { requireTicketNumber } from '../../core/ticket-detail.ts'
import type { CommandRunner, TicketReference } from '../../core/ticket.ts'
import { CommandError, TrackerError } from '../../core/tracker-error.ts'
import { callGlab, callGlabApi, projectEndpoint, readProjectPath } from './shared.ts'

const OWNER_ACCESS_LEVEL = 50
const NOT_FOUND = /404 Not Found|404 page not found|Not Found/i
const NO_PERMISSION = /HTTP 403|403 Forbidden|Forbidden|permission|not allowed/i

/** 删除权限与删除共用的依赖。 */
export interface GitlabDeleteDeps {
  readonly run: CommandRunner
}

/**
 * 当前登录用户能否删除这个项目的工单。
 * @param deps - 命令执行器。
 * @param workspaceRoot - 工作区根目录，用于识别项目。
 * @returns 项目或群组权限为 Owner，或当前用户是实例管理员时为 true。
 * @throws {TrackerError} 命令失败或输出格式不合法。
 */
export async function readGitlabDeletePermission(
  deps: GitlabDeleteDeps,
  workspaceRoot: string,
): Promise<boolean> {
  const project = await readProjectPath(deps.run, workspaceRoot)
  const payload = parseJson(
    await callGlabApi(deps.run, workspaceRoot, projectEndpoint(project)),
    '项目权限',
  )
  if (!isRecord(payload)) throw invalidPermission('项目权限不是对象')

  const highest = highestAccessLevel(payload.permissions)
  if (highest !== null && highest >= OWNER_ACCESS_LEVEL) return true

  const user = parseJson(await callGlabApi(deps.run, workspaceRoot, 'user'), '当前用户')
  return isRecord(user) && user.is_admin === true
}

/**
 * 永久删除一张 GitLab 工单。
 * @param deps - 命令执行器。
 * @param workspaceRoot - 工作区根目录。
 * @param reference - 工单引用；必须有数字编号。
 * @throws {TrackerError} 编号不存在、没有权限或命令失败。
 */
export async function deleteGitlabTicket(
  deps: GitlabDeleteDeps,
  workspaceRoot: string,
  reference: TicketReference,
): Promise<void> {
  const iid = requireTicketNumber(reference)
  const project = await readProjectPath(deps.run, workspaceRoot)
  const endpoint = `${projectEndpoint(project)}/issues/${String(iid)}`

  try {
    await callGlab(deps.run, workspaceRoot, ['api', '--method', 'DELETE', endpoint])
  } catch (error) {
    throw mapDeleteError(error)
  }
}

function highestAccessLevel(permissions: unknown): number | null {
  if (!isRecord(permissions)) return null
  const project = accessLevel(permissions.project_access)
  const group = accessLevel(permissions.group_access)
  if (project === null) return group
  if (group === null) return project
  return Math.max(project, group)
}

function accessLevel(value: unknown): number | null {
  if (!isRecord(value)) return null
  const level = value.access_level
  return typeof level === 'number' && Number.isFinite(level) ? level : null
}

function mapDeleteError(error: unknown): unknown {
  const stderr = commandStderr(error)
  if (NOT_FOUND.test(stderr)) {
    return new TrackerError('ticket-not-found', '找不到这张工单，它可能已被删除。', {
      cause: error,
    })
  }
  if (NO_PERMISSION.test(stderr)) {
    return new TrackerError(
      'fetch-failed',
      '没有删除这张工单的权限：需要 GitLab 项目 Owner 或实例管理员。',
      { cause: error },
    )
  }
  return error
}

function commandStderr(error: unknown): string {
  return error instanceof TrackerError && error.cause instanceof CommandError
    ? error.cause.stderr
    : ''
}

function parseJson(body: string, field: string): unknown {
  try {
    return JSON.parse(body)
  } catch (error) {
    throw new TrackerError('fetch-failed', `GitLab 返回的${field}不是有效 JSON。`, {
      cause: error,
    })
  }
}

function invalidPermission(message: string): TrackerError {
  return new TrackerError('fetch-failed', `删除权限格式不正确：${message}`)
}
