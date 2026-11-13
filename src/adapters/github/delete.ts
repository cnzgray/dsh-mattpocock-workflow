/**
 * GitHub 的删除权限与删除：`gh repo view --json viewerPermission` 只有 ADMIN
 * 才允许删除；`gh issue delete --yes` 跳过交互确认。
 */
import { isRecord } from '../../core/json.ts'
import { requireTicketNumber } from '../../core/ticket-detail.ts'
import type { CommandRunner, TicketReference } from '../../core/ticket.ts'
import { CommandError, TrackerError } from '../../core/tracker-error.ts'
import { callGh, readRepository, repositoryLabel } from './shared.ts'

const NOT_FOUND = /Could not resolve to an Issue|HTTP 404|404 Not Found|Not Found/i
const NO_PERMISSION = /HTTP 403|Forbidden|Must have admin rights|permission denied/i

/** 删除权限与删除共用的依赖。 */
export interface GithubDeleteDeps {
  readonly run: CommandRunner
}

/**
 * 当前登录用户能否删除这个仓库的工单。
 * @param deps - 命令执行器。
 * @param workspaceRoot - 工作区根目录，用于识别仓库。
 * @returns 仓库权限为 ADMIN 时为 true。
 * @throws {TrackerError} 命令失败或输出格式不合法。
 */
export async function readGithubDeletePermission(
  deps: GithubDeleteDeps,
  workspaceRoot: string,
): Promise<boolean> {
  const repository = await readRepository(deps.run, workspaceRoot)
  const output = await callGh(deps.run, workspaceRoot, [
    'repo',
    'view',
    repositoryLabel(repository),
    '--json',
    'viewerPermission',
  ])

  let payload: unknown
  try {
    payload = JSON.parse(output)
  } catch (error) {
    throw new TrackerError('fetch-failed', 'GitHub 返回的仓库权限不是有效 JSON。', {
      cause: error,
    })
  }
  if (!isRecord(payload)) throw new TrackerError('fetch-failed', '仓库权限不是对象。')
  return payload.viewerPermission === 'ADMIN'
}

/**
 * 永久删除一张 GitHub 工单。
 * @param deps - 命令执行器。
 * @param workspaceRoot - 工作区根目录。
 * @param reference - 工单引用；必须有数字编号。
 * @throws {TrackerError} 编号不存在、没有权限或命令失败。
 */
export async function deleteGithubTicket(
  deps: GithubDeleteDeps,
  workspaceRoot: string,
  reference: TicketReference,
): Promise<void> {
  const number = requireTicketNumber(reference)
  const repository = await readRepository(deps.run, workspaceRoot)

  try {
    await callGh(deps.run, workspaceRoot, [
      'issue',
      'delete',
      String(number),
      '--repo',
      repositoryLabel(repository),
      '--yes',
    ])
  } catch (error) {
    throw mapDeleteError(error)
  }
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
      '没有删除这张工单的权限：需要 GitHub 仓库管理员（ADMIN）。',
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
