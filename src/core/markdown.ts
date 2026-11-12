/**
 * 本地 Markdown 工单的解析。上游约定：
 * `.scratch/<feature>/issues/NN-<slug>.md`，`Status:` 行记录分诊状态，
 * `Blocked by: NN, NN` 行记录同一 feature 内的阻塞关系。
 *
 * 这里只做纯解析：目录扫描、读文件和时间戳由 adapters 注入。
 */
import type { Ticket } from './ticket.ts'

/** 一张已读入内存的本地工单文件。 */
export interface MarkdownTicketFile {
  /** 相对工作区的路径，例如 `.scratch/login/issues/03-session.md`。 */
  readonly path: string
  /** 所属 feature 目录名，例如 `login`。 */
  readonly feature: string
  /** 文件名，例如 `03-session.md`。 */
  readonly name: string
  readonly content: string
  /** 文件创建时间的 ISO 字符串。 */
  readonly createdAt: string
  /** 文件修改时间的 ISO 字符串。 */
  readonly updatedAt: string
}

const HEADING = /^#\s+(.+?)\s*$/
const STATUS = /^\s*Status:\s*(.+?)\s*$/i
const BLOCKED_BY = /^\s*Blocked by:\s*(.*?)\s*$/i
const FILE_NUMBER = /^(\d+)(?:-|\.md$)/
const REFERENCE = /\d+/g

/**
 * 把一组本地工单文件映射成 core 的工单模型，保持输入顺序。
 * @param files - 已读入的文件，顺序由 adapter 按文件名排好。
 * @returns 判定前的工单列表。
 */
export function parseMarkdownTickets(files: readonly MarkdownTicketFile[]): Ticket[] {
  const byFeature = new Map<string, Map<number, MarkdownTicketFile>>()
  for (const file of files) {
    const number = fileNumber(file.name)
    if (number === undefined) continue
    const numbers = byFeature.get(file.feature) ?? new Map<number, MarkdownTicketFile>()
    numbers.set(number, file)
    byFeature.set(file.feature, numbers)
  }

  return files.map((file) => {
    const status = statusOf(file.content)
    return {
      ref: file.path,
      number: null,
      title: titleOf(file),
      state: status === 'resolved' ? 'closed' : 'open',
      labels: status === undefined ? [] : [status],
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      openBlockers: countOpenBlockers(file, byFeature.get(file.feature)),
    }
  })
}

/**
 * 工作区的显示名（本地 Markdown 快照里的 `repository`）。
 * @param workspaceRoot - 工作区根目录。
 * @returns 目录名；根目录没有名字时返回原值。
 */
export function workspaceName(workspaceRoot: string): string {
  const trimmed = workspaceRoot.replace(/[\\/]+$/, '')
  if (trimmed.length === 0) return workspaceRoot
  const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (separator === -1) return trimmed
  return trimmed.slice(separator + 1)
}

function titleOf(file: MarkdownTicketFile): string {
  const heading = firstHeading(file.content)
  if (heading !== undefined) return heading

  const withoutExtension = file.name.replace(/\.md$/i, '')
  const withoutNumber = withoutExtension.replace(/^\d+-/, '')
  return withoutNumber.length > 0 ? withoutNumber : withoutExtension
}

function firstHeading(content: string): string | undefined {
  for (const line of content.split('\n')) {
    const match = HEADING.exec(line.trimEnd())
    if (match !== null) return match[1]
  }
  return undefined
}

function statusOf(content: string): string | undefined {
  for (const line of preambleOf(content).split('\n')) {
    const match = STATUS.exec(line)
    if (match === null) continue
    const value = match[1]?.trim().split(/\s+/)[0]?.toLowerCase()
    if (value !== undefined && value.length > 0) return value
  }
  return undefined
}

function countOpenBlockers(
  file: MarkdownTicketFile,
  siblings: ReadonlyMap<number, MarkdownTicketFile> | undefined,
): number {
  if (siblings === undefined) return 0

  const line = blockedByLine(file.content)
  if (line === undefined) return 0

  let count = 0
  for (const reference of referencedNumbers(line)) {
    const blocker = siblings.get(reference)
    if (blocker === undefined || statusOf(blocker.content) !== 'resolved') count += 1
  }
  return count
}

function blockedByLine(content: string): string | undefined {
  for (const line of preambleOf(content).split('\n')) {
    const match = BLOCKED_BY.exec(line)
    if (match !== null) return match[1] ?? ''
  }
  return undefined
}

/**
 * 只看 `## Comments` 之前的内容：上游把评论追加在这个标题下，
 * 评论里引用的 `Status:` / `Blocked by:` 不能改变这张票的判定。
 */
function preambleOf(content: string): string {
  const heading = /^##\s+Comments\b/im.exec(content)
  return heading === null ? content : content.slice(0, heading.index)
}

function referencedNumbers(line: string): number[] {
  const numbers: number[] = []
  for (const match of line.matchAll(REFERENCE)) {
    const value = Number.parseInt(match[0], 10)
    if (Number.isInteger(value)) numbers.push(value)
  }
  return numbers
}

function fileNumber(name: string): number | undefined {
  const match = FILE_NUMBER.exec(name)
  if (match === null) return undefined
  const value = Number.parseInt(match[1] ?? '', 10)
  return Number.isInteger(value) ? value : undefined
}
