/**
 * GitLab 的补全候选：标签走 `projects/<id>/labels`，可分配用户走
 * `projects/<id>/members/all`。两个接口都按 detail.ts 里的方式分页，
 * 成员只保留 `state === 'active'` 或没有 state 字段的条目。
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
import { callGlabApi, projectEndpoint, readProjectPath } from './shared.ts'

/** 补全候选读取依赖。 */
export interface GitlabOptionsDeps {
  readonly run: CommandRunner
  /** 单页大小；与详情、列表共用同一个配置。 */
  readonly pageSize: number
}

/**
 * 读取一个 GitLab 项目的标签与可分配用户。
 * @param deps - 命令执行器与分页大小。
 * @param workspaceRoot - 工作区根目录，用于识别项目。
 * @returns 标签与可分配用户；两者保持后端返回的顺序并去重。
 * @throws {TrackerError} 命令失败或输出格式不合法。
 */
export async function readGitlabOptions(
  deps: GitlabOptionsDeps,
  workspaceRoot: string,
): Promise<TicketOptions> {
  const project = await readProjectPath(deps.run, workspaceRoot)
  const base = projectEndpoint(project)

  return {
    labels: await readPages(deps, workspaceRoot, `${base}/labels`, parseLabels),
    assignees: await readPages(deps, workspaceRoot, `${base}/members/all`, parseMembers),
  }
}

interface OptionsPage<T> {
  readonly items: readonly T[]
  /** 接口返回的原始条数，用于判断是否还有下一页。 */
  readonly received: number
}

async function readPages<T>(
  deps: GitlabOptionsDeps,
  workspaceRoot: string,
  endpoint: string,
  parse: (body: string) => OptionsPage<T>,
): Promise<readonly T[]> {
  const items: T[] = []

  for (let page = 1; ; page += 1) {
    const url = `${endpoint}?per_page=${String(deps.pageSize)}&page=${String(page)}`
    const parsed = parse(await callGlabApi(deps.run, workspaceRoot, url))
    items.push(...parsed.items)
    // 与 notes 分页一致：按接口返回的原始条数判断是否还有下一页。
    if (parsed.received < deps.pageSize) return items
  }
}

function parseLabels(body: string): OptionsPage<LabelOption> {
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
  return { items: dedupeBy(labels, (label) => label.name), received: payload.length }
}

function parseMembers(body: string): OptionsPage<AssigneeOption> {
  const payload = parseJson(body, '可分配用户')
  if (!Array.isArray(payload)) throw invalidOptions('可分配用户列表不是数组')

  const assignees: AssigneeOption[] = []
  for (const entry of payload) {
    if (!isRecord(entry)) continue
    // 字段缺失时无法判断状态，保守地保留；明确不是 active 的成员才跳过。
    if (entry.state !== undefined && entry.state !== 'active') continue
    const username = readOptionalString(entry.username)
    if (username === null) continue
    assignees.push({ username, name: readOptionalString(entry.name) })
  }
  return { items: dedupeBy(assignees, (assignee) => assignee.username), received: payload.length }
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

function invalidOptions(message: string): TrackerError {
  return new TrackerError('fetch-failed', `补全候选格式不正确：${message}`)
}
