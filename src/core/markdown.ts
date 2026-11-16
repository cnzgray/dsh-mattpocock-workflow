/**
 * 本地 Markdown 工单的解析。上游约定：
 * `.scratch/<feature>/issues/NN-<slug>.md`，`Status:` 行记录分诊状态，
 * `Blocked by: NN, NN` 行记录同一 feature 内的阻塞关系。
 *
 * 这里只做纯解析：目录扫描、读文件和时间戳由 adapters 注入。
 */
import type { Ticket, TicketState } from './ticket.ts'

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
const COMMENTS_HEADING = /^##\s+Comments\b/i
const STATUS = /^\s*Status:\s*(.+?)\s*$/i
const BLOCKED_BY = /^\s*Blocked by:\s*(.*?)\s*$/i
const PARENT = /^\s*Parent:\s*(.*?)\s*$/i
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
    const siblings = byFeature.get(file.feature)
    const blockers = blockersOf(file, siblings)
    const parent = parentOf(file, siblings)
    return {
      ref: file.path,
      number: null,
      title: titleOf(file),
      state: markdownState(file.content),
      labels: markdownLabels(file.content),
      author: null,
      assignees: [],
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      openBlockers: blockers.openBlockers,
      blockedBy: blockers.blockedBy,
      ...(parent === undefined ? {} : { parent }),
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

/**
 * 从文件名推导标题；文件里没有 `# 标题` 行时使用。
 * @param name - 文件名，例如 `03-session.md`。
 * @returns 去掉编号与扩展名的标题。
 */
export function titleFromFileName(name: string): string {
  const withoutExtension = name.replace(/\.md$/i, '')
  const withoutNumber = withoutExtension.replace(/^\d+-/, '')
  return withoutNumber.length > 0 ? withoutNumber : withoutExtension
}

/**
 * 本地工单的标签：只有 `Status:` 行的值，本地约定没有分类。
 * @param content - 文件全文。
 * @returns 零个或一个标签。
 */
export function markdownLabels(content: string): readonly string[] {
  const status = parseTicketStatus(content)
  return status === undefined ? [] : [status]
}

/**
 * 从文件内容判定开闭状态：`Status: resolved` 视为已关闭。
 * @param content - 文件全文。
 * @returns 工单状态。
 */
export function markdownState(content: string): TicketState {
  return parseTicketStatus(content) === 'resolved' ? 'closed' : 'open'
}

function titleOf(file: MarkdownTicketFile): string {
  const heading = firstHeading(file.content)
  return heading ?? titleFromFileName(file.name)
}

function firstHeading(content: string): string | undefined {
  for (const line of content.split('\n')) {
    const match = HEADING.exec(line.trimEnd())
    if (match !== null) return match[1]
  }
  return undefined
}

/**
 * 从工单文件里解析 `Status:` 行的值。
 * 环境检查用它判断一个本地工单文件是否可解析，与工单列表共用同一份规则。
 * @param content - 文件内容。
 * @returns 小写的状态值；没有可解析的状态行时为 undefined。
 */
export function parseTicketStatus(content: string): string | undefined {
  for (const line of preambleOf(content).split('\n')) {
    const match = STATUS.exec(line)
    if (match === null) continue
    const value = match[1]?.trim().split(/\s+/)[0]?.toLowerCase()
    if (value !== undefined && value.length > 0) return value
  }
  return undefined
}

function blockersOf(
  file: MarkdownTicketFile,
  siblings: ReadonlyMap<number, MarkdownTicketFile> | undefined,
): { readonly openBlockers: number; readonly blockedBy: readonly string[] } {
  const empty = { openBlockers: 0, blockedBy: [] }
  if (siblings === undefined) return empty

  const line = blockedByLine(file.content)
  if (line === undefined) return empty

  let openBlockers = 0
  const blockedBy: string[] = []
  const seen = new Set<number>()
  for (const reference of referencedNumbers(line)) {
    if (seen.has(reference)) continue
    seen.add(reference)

    const blocker = siblings.get(reference)
    if (blocker === undefined || parseTicketStatus(blocker.content) !== 'resolved')
      openBlockers += 1
    // 只有同一 feature 下能找到的票才有引用；链深度也只沿已知的票走。
    if (blocker !== undefined) blockedBy.push(blocker.path)
  }
  return { openBlockers, blockedBy }
}

function blockedByLine(content: string): string | undefined {
  for (const line of preambleOf(content).split('\n')) {
    const match = BLOCKED_BY.exec(line)
    if (match !== null) return match[1] ?? ''
  }
  return undefined
}

/**
 * 解析 `Parent: NN`：只看 `## Comments` 之前，取第一个编号，且父票必须是
 * 同一 feature 下确实存在的另一张工单。指向缺失文件、指向自己或跨 feature
 * 都按无父级处理，坏引用不让列表出错。
 * @param file - 当前工单文件。
 * @param siblings - 同一 feature 下编号到文件的映射。
 * @returns 父票的相对路径；没有可用父级时 undefined。
 */
function parentOf(
  file: MarkdownTicketFile,
  siblings: ReadonlyMap<number, MarkdownTicketFile> | undefined,
): string | undefined {
  if (siblings === undefined) return undefined

  const line = parentLine(file.content)
  if (line === undefined) return undefined

  const number = referencedNumbers(line)[0]
  if (number === undefined) return undefined

  const parent = siblings.get(number)
  if (parent === undefined || parent.path === file.path) return undefined
  return parent.path
}

function parentLine(content: string): string | undefined {
  for (const line of preambleOf(content).split('\n')) {
    const match = PARENT.exec(line)
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

/** 本地 Markdown 的详情：标题、正文与按段落拆开的评论。 */
export interface MarkdownDetail {
  readonly title: string
  /** 首个标题之后、`## Comments` 之前的原文。 */
  readonly body: string
  /** 评论段里按空行拆开的段落，保持文件顺序。 */
  readonly comments: readonly string[]
}

/**
 * 解析一张本地工单的详情。
 * 正文取首个标题之后、`## Comments` 之前的内容，保留原始 Markdown；
 * `## Comments` 之后按空行分段，每段是一条评论。
 * @param content - 文件全文。
 * @param fallbackTitle - 没有标题行时的回退标题（通常来自文件名）。
 * @returns 标题、正文与评论段落。
 */
export function parseMarkdownDetail(content: string, fallbackTitle: string): MarkdownDetail {
  const lines = content.split('\n')
  const headingIndex = lines.findIndex((line) => HEADING.test(line.trimEnd()))
  const commentsIndex = lines.findIndex((line) => COMMENTS_HEADING.test(line.trimEnd()))

  const heading =
    headingIndex === -1 ? undefined : HEADING.exec(lines[headingIndex]?.trimEnd() ?? '')
  const bodyStart = headingIndex === -1 ? 0 : headingIndex + 1
  const bodyEnd = commentsIndex === -1 ? lines.length : commentsIndex

  return {
    title: heading?.[1] ?? fallbackTitle,
    body: lines.slice(bodyStart, bodyEnd).join('\n').trim(),
    comments:
      commentsIndex === -1
        ? []
        : lines
            .slice(commentsIndex + 1)
            .join('\n')
            .split(/\n\s*\n/)
            .map((paragraph) => paragraph.trim())
            .filter((paragraph) => paragraph.length > 0),
  }
}
