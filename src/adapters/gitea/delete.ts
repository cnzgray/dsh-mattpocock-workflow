/**
 * Gitea 的删除权限与删除：仓库详情里的 `permissions.admin` 决定能否删除；
 * 删除走 `tea api --include --method DELETE`，`tea` 在非 2xx 时仍以 0 退出，
 * 所以只能按解析出的 HTTP 状态判断成败（204 表示删除成功）。
 */
import { isRecord } from '../../core/json.ts'
import { requireTicketNumber } from '../../core/ticket-detail.ts'
import type { CommandRunner, TicketReference } from '../../core/ticket.ts'
import { TrackerError } from '../../core/tracker-error.ts'
import { callGiteaApi, ensureSuccess, readRepository } from './shared.ts'

/** 删除权限与删除共用的依赖。 */
export interface GiteaDeleteDeps {
  readonly run: CommandRunner
}

/**
 * 当前登录用户能否删除这个仓库的工单。
 * @param deps - 命令执行器。
 * @param workspaceRoot - 工作区根目录，用于识别仓库。
 * @returns 仓库权限为管理员时为 true。
 * @throws {TrackerError} 命令失败或输出格式不合法。
 */
export async function readGiteaDeletePermission(
  deps: GiteaDeleteDeps,
  workspaceRoot: string,
): Promise<boolean> {
  const repository = await readRepository(deps.run, workspaceRoot)
  const response = await callGiteaApi(
    deps.run,
    workspaceRoot,
    `/repos/${repository.owner}/${repository.name}`,
  )
  ensureSuccess(response, '读取 Gitea 仓库权限')

  const payload = parseJson(response.body, '仓库权限')
  if (!isRecord(payload)) throw invalidPermission('仓库权限不是对象')
  return isRecord(payload.permissions) && payload.permissions.admin === true
}

/**
 * 永久删除一张 Gitea 工单。
 * @param deps - 命令执行器。
 * @param workspaceRoot - 工作区根目录。
 * @param reference - 工单引用；必须有数字编号。
 * @throws {TrackerError} 编号不存在、没有权限或删除失败。
 */
export async function deleteGiteaTicket(
  deps: GiteaDeleteDeps,
  workspaceRoot: string,
  reference: TicketReference,
): Promise<void> {
  const number = requireTicketNumber(reference)
  const repository = await readRepository(deps.run, workspaceRoot)
  const response = await callGiteaApi(
    deps.run,
    workspaceRoot,
    `/repos/${repository.owner}/${repository.name}/issues/${String(number)}`,
    'DELETE',
  )

  if (response.status >= 200 && response.status < 300) return
  if (response.status === 404) {
    throw new TrackerError('ticket-not-found', '找不到这张工单，它可能已被删除。')
  }
  if (response.status === 403) {
    throw new TrackerError('fetch-failed', '没有删除这张工单的权限：需要 Gitea 仓库管理员。')
  }
  ensureSuccess(response, '删除 Gitea 工单')
}

function parseJson(body: string, field: string): unknown {
  try {
    return JSON.parse(body)
  } catch (error) {
    throw new TrackerError('fetch-failed', `Gitea 返回的${field}不是有效 JSON。`, {
      cause: error,
    })
  }
}

function invalidPermission(message: string): TrackerError {
  return new TrackerError('fetch-failed', `删除权限格式不正确：${message}`)
}
