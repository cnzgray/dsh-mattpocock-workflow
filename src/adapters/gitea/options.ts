/**
 * Gitea 的补全候选：标签走 `/repos/{owner}/{repo}/labels`，可分配用户走
 * `/repos/{owner}/{repo}/assignees`。Gitea 标签接口每页最多 50 条，
 * 分页按 `X-Total-Count` 或实际条数收口。
 */
import { isRecord } from '../../core/json.ts'
import { dedupeBy, normalizeLabelColor, readOptionalString } from '../../core/ticket-detail.ts'
import type {
  AssigneeOption,
  CommandRunner,
  LabelOption,
  TicketOptions,
} from '../../core/ticket.ts'
import { TrackerError } from '../../core/tracker-error.ts'
import { callGiteaApi, ensureSuccess, readRepository, type GiteaRepository } from './shared.ts'

const LABEL_PAGE_SIZE = 50
const MAX_PAGES = 200

/** 补全候选读取依赖。 */
export interface GiteaOptionsDeps {
  readonly run: CommandRunner
}

/**
 * 读取一个 Gitea 仓库的标签与可分配用户。
 * @param deps - 命令执行器。
 * @param workspaceRoot - 工作区根目录，用于识别仓库。
 * @returns 标签与可分配用户；两者保持后端返回的顺序并去重。
 * @throws {TrackerError} 命令失败或输出格式不合法。
 */
export async function readGiteaOptions(
  deps: GiteaOptionsDeps,
  workspaceRoot: string,
): Promise<TicketOptions> {
  const repository = await readRepository(deps.run, workspaceRoot)

  return {
    labels: await readLabels(deps, workspaceRoot, repository),
    assignees: await readAssignees(deps, workspaceRoot, repository),
  }
}

async function readLabels(
  deps: GiteaOptionsDeps,
  workspaceRoot: string,
  repository: GiteaRepository,
): Promise<readonly LabelOption[]> {
  const labels: LabelOption[] = []
  let total: number | undefined

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const endpoint = `/repos/${repository.owner}/${repository.name}/labels?limit=${String(LABEL_PAGE_SIZE)}&page=${String(page)}`
    const response = await callGiteaApi(deps.run, workspaceRoot, endpoint)
    ensureSuccess(response, '读取 Gitea 标签')

    const parsed = parseLabels(response.body)
    labels.push(...parsed)
    total ??= response.total

    // 有总条数就按条数收口；没有时翻到短页为止。
    if (total !== undefined) {
      if (labels.length >= total) break
    } else if (parsed.length < LABEL_PAGE_SIZE) {
      break
    }
    // 总条数偏大但没有更多数据时不再空翻。
    if (parsed.length === 0) break
  }

  return dedupeBy(labels, (label) => label.name)
}

async function readAssignees(
  deps: GiteaOptionsDeps,
  workspaceRoot: string,
  repository: GiteaRepository,
): Promise<readonly AssigneeOption[]> {
  const response = await callGiteaApi(
    deps.run,
    workspaceRoot,
    `/repos/${repository.owner}/${repository.name}/assignees`,
  )
  ensureSuccess(response, '读取 Gitea 可分配用户')

  const payload = parseJson(response.body, '可分配用户')
  if (!Array.isArray(payload)) throw invalidOptions('可分配用户列表不是数组')

  const assignees: AssigneeOption[] = []
  for (const entry of payload) {
    if (!isRecord(entry)) continue
    const username = readOptionalString(entry.login)
    if (username === null) continue
    assignees.push({ username, name: readOptionalString(entry.full_name) })
  }
  return dedupeBy(assignees, (assignee) => assignee.username)
}

function parseLabels(body: string): readonly LabelOption[] {
  const payload = parseJson(body, '标签')
  if (!Array.isArray(payload)) throw invalidOptions('标签列表不是数组')

  const labels: LabelOption[] = []
  for (const entry of payload) {
    if (!isRecord(entry)) continue
    const name = readOptionalString(entry.name)
    if (name === null) continue
    labels.push({
      name,
      color: normalizeLabelColor(entry.color),
      description: readOptionalString(entry.description),
    })
  }
  return labels
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

function invalidOptions(message: string): TrackerError {
  return new TrackerError('fetch-failed', `补全候选格式不正确：${message}`)
}
