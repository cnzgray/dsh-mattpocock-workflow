/**
 * 解析 `glab api` 的工单、链接探测与批量阻塞计数输出。输入是录制或真实的
 * JSON 文本，这里不发起任何请求，也不执行任何命令。
 */
import { readAuthor, type AuthorFields } from '../../core/author.ts'
import { isRecord } from '../../core/json.ts'
import type { NativeBlockers } from '../../core/blocked-by.ts'
import type { Ticket, TicketState } from '../../core/ticket.ts'
import { readWebUrl } from '../../core/ticket-detail.ts'
import { TrackerError } from '../../core/tracker-error.ts'

/** GitLab issue 的 author 字段名。 */
const AUTHOR_FIELDS: AuthorFields = {
  login: 'username',
  displayName: 'name',
  avatarUrl: 'avatar_url',
}

/** 一张 GitLab 工单及其描述；描述用于 blocking link 不可用时回退。 */
export interface ParsedIssue {
  readonly ticket: Ticket
  readonly description: string
  /**
   * 列表响应是否带 `blocking_issues_count`。Community 版没有这个字段，
   * 有它就能在发任何探测请求前判定实例支持原生阻塞关系。
   */
  readonly hasBlockingIssuesCount: boolean
}

/**
 * 解析一页 `/projects/:id/issues` 的响应。
 * @param output - `glab api` 的标准输出，GitLab 返回 JSON 数组。
 * @returns 解析到的一页工单。
 * @throws {TrackerError} 输出不是 JSON 数组或字段不合法。
 */
export function parseIssuesPage(output: string): ParsedIssue[] {
  const payload = parseJson(output)
  if (!Array.isArray(payload)) throw invalid('工单列表不是数组')

  return payload.map((value, index) => parseIssue(value, index))
}

/** `glab api --include` 的输出：响应头里的 `X-Total` 与正文。 */
export interface GlabIncludeResponse {
  /** `X-Total` 响应头；GitLab 对超大集合会省略它。 */
  readonly total: number | undefined
  readonly body: string
}

const TOTAL_HEADER = /^x-total:\s*(\d+)\s*$/im

/**
 * 拆开 `glab api --include` 的输出：状态行与响应头在正文前的空行之前。
 * 没有响应头时整段都按正文处理。
 * @param output - 命令的标准输出。
 * @returns 响应头里的总数与正文。
 */
export function parseGlabInclude(output: string): GlabIncludeResponse {
  const separator = /\r?\n\r?\n/.exec(output)
  if (separator === null) return { total: undefined, body: output }

  const headers = output.slice(0, separator.index)
  const body = output.slice(separator.index + separator[0].length)
  const match = TOTAL_HEADER.exec(headers)
  if (match === null) return { total: undefined, body }

  const total = Number.parseInt(match[1] ?? '', 10)
  return { total: Number.isInteger(total) ? total : undefined, body }
}

/**
 * 判定一次 `/issues/:iid/links` 响应是否证明实例提供原生阻塞关系。
 *
 * Community 版对该接口恒返回 `200` + 空数组，所以只看异常不够；
 * 只有出现 `is_blocked_by` 或 `blocks` 链接才算支持。`relates_to`
 * 是免费版也有的普通关联，不能作为依据。
 * @param output - `glab api .../links` 的响应。
 * @returns 实例是否提供原生阻塞关系。
 * @throws {TrackerError} 输出不是 JSON 数组。
 */
export function hasNativeBlockingLinks(output: string): boolean {
  const payload = parseJson(output)
  if (!Array.isArray(payload)) throw invalid('工单链接不是数组')

  return payload.some(
    (link) =>
      isRecord(link) &&
      typeof link.link_type === 'string' &&
      (link.link_type === 'is_blocked_by' || link.link_type === 'blocks'),
  )
}

/**
 * 解析原生 blocking link：未关闭数与全部阻塞票编号。
 * @param output - `/issues/:iid/links` 的响应。
 * @returns 未关闭的 `is_blocked_by` 链接数与编号集合（不论开闭）。
 * @throws {TrackerError} 输出不是 JSON。
 */
export function parseNativeBlockers(output: string): NativeBlockers {
  const payload = parseJson(output)
  const links = Array.isArray(payload) ? payload : readLinksField(payload)
  if (links === undefined) throw invalid('工单链接不是数组')

  let open = 0
  const refs: number[] = []
  for (const link of links) {
    if (!isRecord(link)) continue
    if (link.link_type !== 'is_blocked_by') continue

    const iid = link.iid
    if (typeof iid === 'number' && Number.isInteger(iid) && iid > 0) refs.push(iid)
    if (link.state === 'closed') continue
    open += 1
  }
  return { open, refs }
}

/**
 * 从批量 GraphQL 响应里读取每张票的未关闭阻塞数。
 *
 * `blockedByCount` 只统计未关闭的阻塞票；字段为 null 或缺失时跳过该票，
 * 让调用方退回描述里的 `Blocked by:`。
 * @param output - `glab api graphql` 的响应。
 * @returns 工单编号 → 未关闭阻塞数。
 * @throws {TrackerError} 响应带 GraphQL 错误或字段不合法。
 */
export function parseBlockedByCounts(output: string): ReadonlyMap<number, number> {
  const payload = parseJson(output)
  if (!isRecord(payload)) throw invalid('阻塞计数响应不是对象')

  const errors: unknown = payload.errors
  if (Array.isArray(errors) && errors.length > 0) {
    const first: unknown = errors[0]
    const message =
      isRecord(first) && typeof first.message === 'string' ? first.message : '未知 GraphQL 错误'
    throw invalid(`阻塞计数查询失败：${message}`)
  }

  const data = payload.data
  if (!isRecord(data)) throw invalid('阻塞计数响应缺少 data')
  const project = data.project
  if (!isRecord(project)) throw invalid('阻塞计数响应缺少 project')
  const issues = project.issues
  if (!isRecord(issues)) throw invalid('阻塞计数响应缺少 project.issues')
  const nodes = issues.nodes
  if (!Array.isArray(nodes)) throw invalid('阻塞计数响应的 nodes 不是数组')

  const counts = new Map<number, number>()
  for (const node of nodes) {
    if (!isRecord(node)) throw invalid('阻塞计数节点不是对象')

    const iid = readIid(node.iid)
    const count = node.blockedByCount
    if (count === undefined || count === null) continue
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
      throw invalid(`第 ${String(iid)} 张票的 blockedByCount 不是非负整数`)
    }
    counts.set(iid, count)
  }
  return counts
}

/**
 * 把 `group/sub/project` 编码成 GitLab API 的单个路径段。
 * @param path - 远端解析出的项目路径。
 * @returns URL 编码后的路径。
 */
export function encodeProjectPath(path: string): string {
  return encodeURIComponent(path)
}

function parseIssue(value: unknown, index: number): ParsedIssue {
  if (!isRecord(value)) throw invalid(`第 ${String(index + 1)} 张票不是对象`)

  const iid = value.iid
  if (typeof iid !== 'number' || !Number.isInteger(iid) || iid <= 0) {
    throw invalid(`第 ${String(index + 1)} 张票的编号不合法`)
  }

  const title = readString(value.title, `第 ${String(iid)} 张票的标题`)
  const state = readState(value.state, iid)
  const closedAt = readClosedAt(value.closed_at, iid)
  const url = readWebUrl(value.web_url)

  return {
    ticket: {
      ref: `#${String(iid)}`,
      number: iid,
      title,
      state,
      labels: readLabels(value.labels),
      author: readAuthor(value.author, AUTHOR_FIELDS),
      createdAt: readString(value.created_at, `第 ${String(iid)} 张票的创建时间`),
      updatedAt: readString(value.updated_at, `第 ${String(iid)} 张票的更新时间`),
      openBlockers: 0,
      blockedBy: [],
      ...(closedAt === undefined ? {} : { closedAt }),
      ...(url === undefined ? {} : { url }),
    },
    description: typeof value.description === 'string' ? value.description : '',
    hasBlockingIssuesCount: Object.hasOwn(value, 'blocking_issues_count'),
  }
}

function readState(value: unknown, iid: number): TicketState {
  if (value === 'opened') return 'open'
  if (value === 'closed') return 'closed'
  throw invalid(`第 ${String(iid)} 张票的状态不合法`)
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

function readIid(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const iid = Number.parseInt(value, 10)
    if (Number.isInteger(iid) && iid > 0) return iid
  }
  throw invalid('阻塞计数里的工单编号不合法')
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
 * @param iid - 工单编号，用于错误信息。
 * @returns 关闭时间；开放票缺席。
 */
function readClosedAt(value: unknown, iid: number): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.length === 0) {
    throw invalid(`第 ${String(iid)} 张票的关闭时间不合法`)
  }
  return value
}

function parseJson(output: string): unknown {
  try {
    return JSON.parse(output)
  } catch (error) {
    throw new TrackerError('fetch-failed', 'GitLab 返回的不是有效 JSON。', { cause: error })
  }
}

/**
 * 读取链接响应里的 `links` 数组；旧版接口直接返回数组。
 * @param payload - 已解析的 JSON。
 * @returns 链接数组；响应形状不认识时为 undefined。
 */
function readLinksField(payload: unknown): readonly unknown[] | undefined {
  if (!isRecord(payload)) return undefined
  return Array.isArray(payload.links) ? payload.links : undefined
}

function invalid(message: string): TrackerError {
  return new TrackerError('fetch-failed', `工单数据格式不正确：${message}`)
}
