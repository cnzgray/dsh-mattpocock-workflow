/**
 * 解析 `glab api` 的工单输出。输入是录制或真实的 JSON 文本，
 * 这里不发起任何请求，也不执行任何命令。
 */
import { isRecord } from '../../core/json.ts'
import type { Ticket, TicketState } from '../../core/ticket.ts'
import { TrackerError } from '../../core/tracker-error.ts'

/** 一张 GitLab 工单及其描述；描述用于 blocking link 不可用时回退。 */
export interface ParsedIssue {
  readonly ticket: Ticket
  readonly description: string
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

/**
 * 统计原生 blocking link 里未关闭的票数。
 * @param output - `/issues/:iid/links` 的响应。
 * @returns 未关闭的 `is_blocked_by` 链接数。
 * @throws {TrackerError} 输出不是 JSON。
 */
export function countNativeBlockers(output: string): number {
  const payload = parseJson(output)
  const links = Array.isArray(payload) ? payload : readLinksField(payload)
  if (links === undefined) throw invalid('工单链接不是数组')

  let count = 0
  for (const link of links) {
    if (!isRecord(link)) continue
    if (link.link_type !== 'is_blocked_by') continue
    if (link.state === 'closed') continue
    count += 1
  }
  return count
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

  return {
    ticket: {
      ref: `#${String(iid)}`,
      number: iid,
      title,
      state,
      labels: readLabels(value.labels),
      createdAt: readString(value.created_at, `第 ${String(iid)} 张票的创建时间`),
      updatedAt: readString(value.updated_at, `第 ${String(iid)} 张票的更新时间`),
      openBlockers: 0,
    },
    description: typeof value.description === 'string' ? value.description : '',
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

function readLinksField(payload: unknown): readonly unknown[] | undefined {
  if (!isRecord(payload)) return undefined
  return Array.isArray(payload.links) ? payload.links : undefined
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalid(`${field} 不是非空字符串`)
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

function invalid(message: string): TrackerError {
  return new TrackerError('fetch-failed', `工单数据格式不正确：${message}`)
}
