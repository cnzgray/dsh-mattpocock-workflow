/**
 * 解析 `gh api graphql` 的工单输出。输入是录制或真实的 JSON 文本，
 * 不在这里发起任何请求。
 */
import { readAuthor, type AuthorFields } from '../../core/author.ts'
import { isRecord } from '../../core/json.ts'
import type { Ticket, TicketState } from '../../core/ticket.ts'
import { readWebUrl } from '../../core/ticket-detail.ts'
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
  /** 当前登录用户登录名；输出里没有时为 null。 */
  readonly viewer: string | null
  /** 后端是否还有下一页；拿不到分页信息时按没有下一页处理。 */
  readonly hasNextPage: boolean
  /** 下一页的游标；没有下一页时为 null。 */
  readonly endCursor: string | null
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

  return { total, tickets, viewer: readViewer(payload), ...readPageCursor(issues) }
}

/**
 * 当前登录用户：GraphQL 根字段 `viewer.login`。
 * 缺失或类型不对时按识别不出处理，不让一次身份字段异常打挂列表。
 * @param payload - `gh` 返回的完整 JSON。
 * @returns 登录名或 null。
 */
function readViewer(payload: unknown): string | null {
  if (!isRecord(payload)) return null
  const data = payload.data
  if (!isRecord(data)) return null
  const viewer = data.viewer
  if (!isRecord(viewer)) return null
  const login = viewer.login
  return typeof login === 'string' && login.length > 0 ? login : null
}

/**
 * 列表的分页游标。拿不到分页信息时按没有下一页处理：
 * 列表查询总是请求 `pageInfo`，缺失只可能是后端没给。
 * @param issues - GraphQL 的 issues 连接。
 * @returns 是否还有下一页与下一页游标。
 * @throws {TrackerError} 分页字段类型不对。
 */
function readPageCursor(issues: Record<string, unknown>): {
  readonly hasNextPage: boolean
  readonly endCursor: string | null
} {
  const pageInfo = issues.pageInfo
  if (!isRecord(pageInfo)) return { hasNextPage: false, endCursor: null }

  const hasNextPage = pageInfo.hasNextPage
  if (typeof hasNextPage !== 'boolean') {
    throw invalid('仓库的 issues.pageInfo.hasNextPage 不是布尔值')
  }
  const cursor = pageInfo.endCursor
  if (cursor !== undefined && cursor !== null && typeof cursor !== 'string') {
    throw invalid('仓库的 issues.pageInfo.endCursor 不是字符串')
  }
  return {
    hasNextPage,
    endCursor: typeof cursor === 'string' && cursor.length > 0 ? cursor : null,
  }
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
  const url = readWebUrl(value.url)

  return {
    ref: `#${String(number)}`,
    number,
    title,
    state,
    labels: readLabels(value.labels),
    author: readAuthor(value.author, AUTHOR_FIELDS),
    assignees: readAssignees(value.assignees),
    createdAt: readString(value.createdAt, `第 ${String(number)} 张票的创建时间`),
    updatedAt: readString(value.updatedAt, `第 ${String(number)} 张票的更新时间`),
    openBlockers: readOpenBlockers(value.issueDependenciesSummary),
    ...(closedAt === undefined ? {} : { closedAt }),
    ...(url === undefined ? {} : { url }),
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
 * 分配人登录名。字段缺失、不是数组、条目不是对象或登录名为空时跳过该条目；
 * 一次脏数据只按空数组处理，不让整张列表失败。
 * @param value - GraphQL 的 `assignees` 连接。
 * @returns 登录名数组。
 */
function readAssignees(value: unknown): readonly string[] {
  if (!isRecord(value)) return []
  const nodes = value.nodes
  if (!Array.isArray(nodes)) return []

  const logins: string[] = []
  for (const node of nodes) {
    if (!isRecord(node)) continue
    const login = node.login
    if (typeof login === 'string' && login.length > 0) logins.push(login)
  }
  return logins
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
