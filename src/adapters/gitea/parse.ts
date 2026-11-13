/**
 * 解析 `tea api --include` 的输出。`tea` 把响应头写到标准错误、响应体写到标准输出，
 * 非 2xx 也照常退出 0，所以状态码只能从标准错误里读。
 *
 * 这里不发起任何请求，也不执行任何命令。
 */
import { readAuthor, type AuthorFields } from '../../core/author.ts'
import { isRecord } from '../../core/json.ts'
import type { Ticket, TicketState } from '../../core/ticket.ts'
import { TrackerError } from '../../core/tracker-error.ts'

/** Gitea issue 的 user 字段名。 */
const AUTHOR_FIELDS: AuthorFields = {
  login: 'login',
  displayName: 'full_name',
  avatarUrl: 'avatar_url',
}

/** 一次 API 调用的结构化结果。 */
export interface ApiResponse {
  /** HTTP 状态码；没有状态行（未带 `--include`）时按 200 处理。 */
  readonly status: number
  /** `X-Total-Count` 响应头里的总条数。 */
  readonly total: number | undefined
  readonly body: string
}

/** 一张 Gitea 工单及其正文；正文用于依赖功能不可用时回退。 */
export interface ParsedIssue {
  readonly ticket: Ticket
  readonly body: string
}

const STATUS_LINE = /^HTTP\/\S+\s+(\d{3})/m
const TOTAL_LINE = /^x-total-count:\s*(\d+)\s*$/im

/**
 * 拆分一次 `tea api --include` 的输出。
 * @param stdout - 响应体。
 * @param stderr - 状态行与响应头。
 * @returns 状态码、总条数与响应体。
 */
export function parseApiResponse(stdout: string, stderr: string): ApiResponse {
  return { status: readStatus(stderr), total: readTotal(stderr), body: stdout }
}

/**
 * 解析一页 `/repos/:owner/:repo/issues` 的响应。
 * @param body - 响应体，Gitea 返回 JSON 数组。
 * @param avatarBaseUrl - 头像地址是实例内相对路径时用来补全的基准地址。
 * @returns 解析到的一页工单，带 `pull_request` 的条目会被跳过。
 * @throws {TrackerError} 输出不是 JSON 数组或字段不合法。
 */
export function parseIssuesPage(body: string, avatarBaseUrl?: string): ParsedIssue[] {
  const payload = parseJson(body)
  if (!Array.isArray(payload)) throw invalid('工单列表不是数组')

  const issues: ParsedIssue[] = []
  for (const [index, value] of payload.entries()) {
    // 请求已经带了 `type=issues`；这里再挡一次，任何版本把 PR 混进来都不影响统计。
    if (isRecord(value) && isRecord(value.pull_request)) continue
    issues.push(parseIssue(value, index, avatarBaseUrl))
  }
  return issues
}

/** 一页依赖列表的统计结果。 */
export interface DependencyPage {
  /** 这一页返回的条目数，用于判断是否还有下一页。 */
  readonly received: number
  /** 其中未关闭的票数。 */
  readonly open: number
  /** 依赖票的编号；没有编号的条目（无权限）不进入引用集合。 */
  readonly refs: readonly number[]
}

/**
 * 统计一页依赖列表。
 * @param body - `/issues/:index/dependencies` 的响应。
 * @returns 条目数、未关闭的依赖票数与依赖票编号。
 * @throws {TrackerError} 响应不是 JSON 数组。
 */
export function parseDependencies(body: string): DependencyPage {
  const payload = parseJson(body)
  if (!Array.isArray(payload)) throw invalid('工单依赖不是数组')

  let open = 0
  const refs: number[] = []
  for (const dependency of payload) {
    if (!isRecord(dependency)) continue
    const number = dependency.number
    if (typeof number === 'number' && Number.isInteger(number) && number > 0) refs.push(number)
    // 只读得到标题的依赖（无权限）没有 state，按未关闭处理。
    if (dependency.state === 'closed') continue
    open += 1
  }
  return { received: payload.length, open, refs }
}

function readStatus(stderr: string): number {
  const match = STATUS_LINE.exec(stderr)
  if (match === null) return 200
  const status = Number.parseInt(match[1] ?? '', 10)
  return Number.isInteger(status) ? status : 200
}

function readTotal(stderr: string): number | undefined {
  const match = TOTAL_LINE.exec(stderr)
  if (match === null) return undefined
  const total = Number.parseInt(match[1] ?? '', 10)
  return Number.isInteger(total) ? total : undefined
}

function parseIssue(value: unknown, index: number, avatarBaseUrl?: string): ParsedIssue {
  if (!isRecord(value)) throw invalid(`第 ${String(index + 1)} 张票不是对象`)

  const number = value.number
  if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0) {
    throw invalid(`第 ${String(index + 1)} 张票的编号不合法`)
  }

  const title = readString(value.title, `第 ${String(number)} 张票的标题`)
  const state = readState(value.state, number)
  const closedAt = readClosedAt(value.closed_at, number)

  return {
    ticket: {
      ref: `#${String(number)}`,
      number,
      title,
      state,
      labels: readLabels(value.labels),
      author: readAuthor(value.user, AUTHOR_FIELDS, avatarBaseUrl),
      createdAt: readString(value.created_at, `第 ${String(number)} 张票的创建时间`),
      updatedAt: readString(value.updated_at, `第 ${String(number)} 张票的更新时间`),
      openBlockers: 0,
      blockedBy: [],
      ...(closedAt === undefined ? {} : { closedAt }),
    },
    body: typeof value.body === 'string' ? value.body : '',
  }
}

function readState(value: unknown, number: number): TicketState {
  if (value === 'open') return 'open'
  if (value === 'closed') return 'closed'
  throw invalid(`第 ${String(number)} 张票的状态不合法`)
}

function readLabels(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((label) => {
    if (typeof label === 'string' && label.length > 0) return [label]
    if (isRecord(label) && typeof label.name === 'string' && label.name.length > 0) {
      return [label.name]
    }
    return []
  })
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalid(`${field} 不是非空字符串`)
  }
  return value
}

/**
 * 关闭时间：开放票为 null，已关闭票是 ISO 字符串。
 * @param value - API 返回的 `closed_at`。
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

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch (error) {
    throw new TrackerError('fetch-failed', 'Gitea 返回的不是有效 JSON。', { cause: error })
  }
}

function invalid(message: string): TrackerError {
  return new TrackerError('fetch-failed', `工单数据格式不正确：${message}`)
}
