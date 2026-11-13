/**
 * 解析 `gh api graphql` 的工单输出。输入是录制或真实的 JSON 文本，
 * 不在这里发起任何请求。
 */
import { readAuthor, type AuthorFields } from '../../core/author.ts'
import { isRecord } from '../../core/json.ts'
import type { Ticket, TicketState } from '../../core/ticket.ts'
import { TrackerError } from '../../core/tracker-error.ts'

/** GitHub GraphQL 用户对象里的字段名。 */
const AUTHOR_FIELDS: AuthorFields = {
  login: 'login',
  displayName: 'name',
  avatarUrl: 'avatarUrl',
}

/** 一次 GraphQL 解析的结果。 */
export interface ParsedIssues {
  readonly total: number
  readonly tickets: readonly Ticket[]
}

/** 一次增量 GraphQL 解析的结果。 */
export interface ParsedChanges {
  readonly tickets: readonly Ticket[]
  /**
   * 是否被单页上限截断。为 true 时这份增量不完整，
   * 宿主要退回全量重拉，不能拿它当完整结果。
   */
  readonly truncated: boolean
  /** 仓库总票数；后端给不出时缺席，宿主沿用上次的总数。 */
  readonly total?: number
}

/**
 * 从 GraphQL 响应里取出总数与工单。
 * @param output - `gh api graphql` 的标准输出。
 * @returns 仓库总数与实际解析到的工单。
 * @throws {TrackerError} 输出不是 JSON、仓库不存在或工单字段不合法。
 */
export function parseIssueGraphql(output: string): ParsedIssues {
  const payload = parseJson(output, 'gh 返回的不是有效 JSON')
  const repository = readRepository(payload)
  const issues = readIssues(repository)

  const nodes = issues.nodes
  if (!Array.isArray(nodes)) throw invalid('仓库的 issues.nodes 不是数组')

  const tickets = nodes.map((node, index) => parseIssueNode(node, index))
  const total = issues.totalCount
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) {
    throw invalid('仓库的 issues.totalCount 不是非负整数')
  }

  return { total, tickets }
}

/**
 * 解析增量 GraphQL 响应。
 *
 * 与列表解析共用同一份字段定义：增量与全量必须覆盖同一批工单，
 * 只有时间窗口不同，否则合并出来的结果不可能与全量重拉一致。
 * @param output - `gh api graphql` 的标准输出。
 * @returns 变更过的工单、是否被截断与仓库总票数。
 * @throws {TrackerError} 输出不是 JSON、仓库不存在或工单字段不合法。
 */
export function parseIssueChangesGraphql(output: string): ParsedChanges {
  const payload = parseJson(output, 'gh 返回的不是有效 JSON')
  const repository = readRepository(payload)
  const issues = readIssues(repository)

  const nodes = issues.nodes
  if (!Array.isArray(nodes)) throw invalid('仓库的 issues.nodes 不是数组')

  const tickets = nodes.map((node, index) => parseIssueNode(node, index))
  const total = readRepositoryTotal(repository)

  return {
    tickets,
    truncated: readHasNextPage(issues),
    ...(total === undefined ? {} : { total }),
  }
}

/**
 * 增量结果是否被单页上限截断。
 *
 * 用 GitHub 自己给的 `hasNextPage` 判断，不用「返回条数 == 上限」那种猜法：
 * 最后一页可能刚好是满页，猜法会误报成截断，让宿主白跑一次全量重拉。
 * 拿不到分页信息时按「可能不完整」处理：宿主退回全量重拉总比漏票好。
 */
function readHasNextPage(issues: Record<string, unknown>): boolean {
  const pageInfo = issues.pageInfo
  if (!isRecord(pageInfo)) return true

  const hasNextPage = pageInfo.hasNextPage
  if (typeof hasNextPage !== 'boolean') {
    throw invalid('仓库的 issues.pageInfo.hasNextPage 不是布尔值')
  }
  return hasNextPage
}

/**
 * 仓库总票数。
 *
 * 增量查询里 `issues.totalCount` 会跟着 `filterBy` 一起过滤，
 * 那是「这次窗口内变更了多少张票」，不是仓库的票数；
 * 仓库总数另取一份未过滤的连接，用它更新宿主显示的总数。
 */
function readRepositoryTotal(repository: Record<string, unknown>): number | undefined {
  const totals = repository.repositoryTotal
  if (!isRecord(totals)) return undefined

  const total = totals.totalCount
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) return undefined
  return total
}

function parseIssueNode(value: unknown, index: number): Ticket {
  if (!isRecord(value)) throw invalid(`第 ${String(index + 1)} 张票不是对象`)

  const number = value.number
  if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0) {
    throw invalid(`第 ${String(index + 1)} 张票的编号不合法`)
  }

  const title = readString(value.title, `第 ${String(number)} 张票的标题`)
  const state = readState(value.state, number)
  const closedAt = readClosedAt(value.closedAt, number)

  return {
    ref: `#${String(number)}`,
    number,
    title,
    state,
    labels: readLabels(value.labels),
    author: readAuthor(value.author, AUTHOR_FIELDS),
    createdAt: readString(value.createdAt, `第 ${String(number)} 张票的创建时间`),
    updatedAt: readString(value.updatedAt, `第 ${String(number)} 张票的更新时间`),
    openBlockers: readOpenBlockers(value.issueDependenciesSummary),
    ...(closedAt === undefined ? {} : { closedAt }),
  }
}

function readRepository(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) throw invalid('gh 输出的顶层不是对象')
  const data = payload.data
  if (!isRecord(data)) throw invalid('gh 输出缺少 data')
  const repository = data.repository
  if (!isRecord(repository)) {
    throw new TrackerError('fetch-failed', 'GitHub 上找不到这个仓库，或当前账号没有访问权限。')
  }
  return repository
}

function readIssues(repository: Record<string, unknown>): Record<string, unknown> {
  const issues = repository.issues
  if (!isRecord(issues)) throw invalid('仓库缺少 issues 字段')
  return issues
}

function readState(value: unknown, number: number): TicketState {
  const normalized = typeof value === 'string' ? value.toLowerCase() : value
  if (normalized === 'open') return 'open'
  if (normalized === 'closed') return 'closed'
  throw invalid(`第 ${String(number)} 张票的状态不合法`)
}

function readLabels(value: unknown): readonly string[] {
  if (!isRecord(value)) return []
  const nodes = value.nodes
  if (!Array.isArray(nodes)) return []

  const labels: string[] = []
  for (const node of nodes) {
    if (!isRecord(node)) continue
    const name = node.name
    if (typeof name === 'string' && name.length > 0) labels.push(name)
  }
  return labels
}

/**
 * `issueDependenciesSummary.blockedBy` 是未关闭阻塞票的数量，0 表示可以开工。
 * 字段缺失时按 0 处理：没有依赖的票在 GitHub 上就是不带汇总。
 */
function readOpenBlockers(value: unknown): number {
  if (value === undefined || value === null) return 0
  if (!isRecord(value)) throw invalid('issueDependenciesSummary 不是对象')
  const blockedBy = value.blockedBy
  if (blockedBy === undefined || blockedBy === null) return 0
  if (typeof blockedBy !== 'number' || !Number.isFinite(blockedBy) || blockedBy < 0) {
    throw invalid('issueDependenciesSummary.blockedBy 不是非负数')
  }
  return blockedBy
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalid(`${field} 不是非空字符串`)
  }
  return value
}

/**
 * 关闭时间：开放票为 null，已关闭票是 ISO 字符串。
 * @param value - GraphQL 返回的 `closedAt`。
 * @param number - 工单编号，用于错误信息。
 * @returns 关闭时间；开放票缺席。
 */
function readClosedAt(value: unknown, number: number): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.length === 0) {
    throw invalid(`第 ${String(number)} 张票的关闭时间不合法`)
  }
  return value
}

function parseJson(output: string, message: string): unknown {
  try {
    return JSON.parse(output)
  } catch (error) {
    throw new TrackerError('fetch-failed', message, { cause: error })
  }
}

function invalid(message: string): TrackerError {
  return new TrackerError('fetch-failed', `工单数据格式不正确：${message}`)
}
