/**
 * GitHub 的补全候选：标签走 `gh label list`，可分配用户走
 * `gh api repos/<owner>/<name>/assignees --paginate --slurp`。
 * `--slurp` 会把每一页包进一个数组，这里展平后按 login 去重。
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
import { callGh, readRepository, repositoryLabel } from './shared.ts'

/** 补全候选读取依赖。 */
export interface GithubOptionsDeps {
  readonly run: CommandRunner
}

/**
 * 读取一个 GitHub 仓库的标签与可分配用户。
 * @param deps - 命令执行器。
 * @param workspaceRoot - 工作区根目录，用于识别仓库。
 * @returns 标签与可分配用户；两者保持后端返回的顺序并去重。
 * @throws {TrackerError} 命令失败或输出格式不合法。
 */
export async function readGithubOptions(
  deps: GithubOptionsDeps,
  workspaceRoot: string,
): Promise<TicketOptions> {
  const repository = await readRepository(deps.run, workspaceRoot)
  const repo = repositoryLabel(repository)
  const [labelsOutput, assigneesOutput] = await Promise.all([
    callGh(deps.run, workspaceRoot, [
      'label',
      'list',
      '--repo',
      repo,
      '--json',
      'name,color,description',
      '--limit',
      '1000',
    ]),
    callGh(deps.run, workspaceRoot, ['api', `repos/${repo}/assignees`, '--paginate', '--slurp']),
  ])

  return {
    labels: parseLabels(labelsOutput),
    assignees: parseAssignees(assigneesOutput),
  }
}

function parseLabels(output: string): readonly LabelOption[] {
  const payload = parseJson(output, '标签')
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
  return dedupeBy(labels, (label) => label.name)
}

function parseAssignees(output: string): readonly AssigneeOption[] {
  const payload = parseJson(output, '可分配用户')
  if (!Array.isArray(payload)) throw invalidOptions('可分配用户列表不是数组')

  // `--paginate --slurp` 输出的是“页的数组”，展平后逐页读取。
  const users = payload.flatMap((page): unknown[] =>
    Array.isArray(page) ? (page as unknown[]) : [],
  )
  const assignees: AssigneeOption[] = []
  for (const entry of users) {
    if (!isRecord(entry)) continue
    const username = readOptionalString(entry.login)
    if (username === null) continue
    // gh 的 assignees 接口没有显示名的稳定口径，统一返回 null。
    assignees.push({ username, name: null })
  }
  return dedupeBy(assignees, (assignee) => assignee.username)
}

function parseJson(output: string, field: string): unknown {
  try {
    return JSON.parse(output)
  } catch (error) {
    throw new TrackerError('fetch-failed', `GitHub 返回的${field}不是有效 JSON。`, {
      cause: error,
    })
  }
}

function invalidOptions(message: string): TrackerError {
  return new TrackerError('fetch-failed', `补全候选格式不正确：${message}`)
}
