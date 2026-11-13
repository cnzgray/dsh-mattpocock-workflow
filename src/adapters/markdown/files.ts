/**
 * 本地 Markdown 后端的文件系统接缝。Tracker 只依赖这个接口，
 * 测试用内存实现，正式代码在这里包一层 `node:fs`。
 */
import { readFile, readdir, stat } from 'node:fs/promises'

import { parseMarkdownTickets, type MarkdownTicketFile } from '../../core/markdown.ts'

/** 目录项类型。 */
export type DirectoryEntryKind = 'file' | 'directory'

/**
 * 把相对路径拼到工作区根目录上，去掉根目录末尾的分隔符。
 * @param base - 工作区根目录。
 * @param segments - 相对路径的各段。
 * @returns 用 `/` 连接的路径；本地工单的 `ref` 也按这个格式。
 */
export function joinPath(base: string, ...segments: readonly string[]): string {
  return [base.replace(/[\\/]+$/, ''), ...segments].join('/')
}

/** 目录项。 */
export interface DirectoryEntry {
  readonly name: string
  readonly kind: DirectoryEntryKind
}

/** 文件时间戳（毫秒）。 */
export interface FileTimestamps {
  readonly createdAt: number
  readonly updatedAt: number
}

/** 本地 Markdown 后端需要的文件读取能力。 */
export interface WorkspaceFiles {
  /** 列目录；目录不存在时返回 undefined，其他失败照常抛出。 */
  listDirectory(path: string): Promise<readonly DirectoryEntry[] | undefined>
  /** 读一个 UTF-8 文本文件。 */
  readTextFile(path: string): Promise<string>
  /** 取文件创建与修改时间。 */
  statFile(path: string): Promise<FileTimestamps>
}

/**
 * 创建基于 `node:fs` 的实现。不存在的目录返回 undefined，让后端把
 * “还没有 `.scratch/`”当成空列表，而不是错误。
 * @returns 文件读取能力。
 */
export function createNodeWorkspaceFiles(): WorkspaceFiles {
  return {
    async listDirectory(path) {
      try {
        const entries = await readdir(path, { withFileTypes: true })
        return entries.map((entry) => ({
          name: entry.name,
          kind: entry.isDirectory() ? 'directory' : 'file',
        }))
      } catch (error) {
        if (isMissingFile(error)) return undefined
        throw error
      }
    },
    async readTextFile(path) {
      return readFile(path, 'utf8')
    },
    async statFile(path) {
      const info = await stat(path)
      return {
        // 部分文件系统拿不到 birthtime，退回 mtime 比显示 1970 年更诚实。
        createdAt: info.birthtimeMs > 0 ? info.birthtimeMs : info.mtimeMs,
        updatedAt: info.mtimeMs,
      }
    },
  }
}

/**
 * 扫描 `<workspaceRoot>/.scratch/<feature>/issues/*.md`。工单列表与环境检查共用，
 * 两边对“哪里有工单文件”的认定不会分叉。
 * @param files - 文件读取能力。
 * @param workspaceRoot - 工作区根目录。
 * @returns 按 feature 与文件名排序的工单文件；`.scratch` 不存在时为 undefined。
 */
export async function readLocalTicketFiles(
  files: WorkspaceFiles,
  workspaceRoot: string,
): Promise<readonly MarkdownTicketFile[] | undefined> {
  const scratch = joinPath(workspaceRoot, '.scratch')
  const features = await files.listDirectory(scratch)
  if (features === undefined) return undefined

  const tickets: MarkdownTicketFile[] = []
  for (const feature of sortEntries(features)) {
    if (feature.kind !== 'directory') continue

    const issuesDirectory = joinPath(scratch, feature.name, 'issues')
    const entries = await files.listDirectory(issuesDirectory)
    if (entries === undefined) continue

    for (const entry of sortEntries(entries)) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.md')) continue

      const path = joinPath(issuesDirectory, entry.name)
      const [content, timestamps] = await Promise.all([
        files.readTextFile(path),
        files.statFile(path),
      ])
      tickets.push({
        path: `.scratch/${feature.name}/issues/${entry.name}`,
        feature: feature.name,
        name: entry.name,
        content,
        createdAt: new Date(timestamps.createdAt).toISOString(),
        updatedAt: new Date(timestamps.updatedAt).toISOString(),
      })
    }
  }

  return tickets
}

function sortEntries(entries: readonly DirectoryEntry[]): DirectoryEntry[] {
  return [...entries].sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  )
}

/** 一次增量扫描的结果。 */
export interface LocalTicketChanges {
  /** 窗口内变更过的工单文件：修改时间晚于窗口起点。 */
  readonly changed: readonly MarkdownTicketFile[]
  /**
   * 为判定阻塞而一并读入的兄弟工单文件。
   *
   * 它们本身没有变化，不进入结果；只是变更工单的 `Blocked by:` 行引用到它们，
   * 少了它们，变更工单的阻塞数就会与全量扫描对不上。
   */
  readonly context: readonly MarkdownTicketFile[]
}

/**
 * 扫描 `<workspaceRoot>/.scratch/<feature>/issues/*.md`，只取窗口内动过的工单。
 *
 * 先用 `statFile` 看修改时间，只有动过的文件才读内容：本地工单越攒越多时，
 * 增量刷新不该把整棵目录树重新读一遍。
 * @param files - 文件读取能力。
 * @param workspaceRoot - 工作区根目录。
 * @param since - 窗口起点（毫秒时间戳）。
 * @returns 变更过的工单文件与补读的兄弟文件；`.scratch` 不存在时为 undefined。
 */
export async function readChangedTicketFiles(
  files: WorkspaceFiles,
  workspaceRoot: string,
  since: number,
): Promise<LocalTicketChanges | undefined> {
  const scratch = joinPath(workspaceRoot, '.scratch')
  const features = await files.listDirectory(scratch)
  if (features === undefined) return undefined

  const changed: MarkdownTicketFile[] = []
  const context: MarkdownTicketFile[] = []

  for (const feature of sortEntries(features)) {
    if (feature.kind !== 'directory') continue

    const issuesDirectory = joinPath(scratch, feature.name, 'issues')
    const entries = await files.listDirectory(issuesDirectory)
    if (entries === undefined) continue

    const candidates = sortEntries(entries).filter(
      (entry) => entry.kind === 'file' && entry.name.endsWith('.md'),
    )
    if (candidates.length === 0) continue

    const moved: MarkdownTicketFile[] = []
    const untouched: { readonly entry: DirectoryEntry; readonly timestamps: FileTimestamps }[] = []
    for (const entry of candidates) {
      const path = joinPath(issuesDirectory, entry.name)
      const timestamps = await files.statFile(path)
      if (timestamps.updatedAt > since) {
        moved.push(await readTicketFile(files, feature.name, entry.name, path, timestamps))
      } else {
        untouched.push({ entry, timestamps })
      }
    }
    if (moved.length === 0) continue

    changed.push(...moved)

    // 阻塞数要用到被引用的兄弟工单：先用占位内容解析一次，
    // 拿到变更工单引用了哪些兄弟文件，再只补读被引用的那几个。
    for (const sibling of referencedSiblings(moved, untouched, feature.name)) {
      const path = joinPath(issuesDirectory, sibling.entry.name)
      context.push(
        await readTicketFile(files, feature.name, sibling.entry.name, path, sibling.timestamps),
      )
    }
  }

  return { changed, context }
}

/**
 * 找出变更工单引用到的兄弟文件。
 *
 * 先用占位内容解析一次：core 的阻塞判定只会把「同一 feature 下确实存在的兄弟工单」
 * 放进 `blockedBy`，所以这份占位解析能给出要补读的文件，
 * 适配器不必把 `Blocked by:` 的解析规则再写一遍。
 * @param moved - 变更过的工单文件。
 * @param untouched - 同一 feature 下没动过的工单文件与它们的时间戳。
 * @param feature - feature 目录名。
 * @returns 被引用到的兄弟文件。
 */
function referencedSiblings(
  moved: readonly MarkdownTicketFile[],
  untouched: readonly { readonly entry: DirectoryEntry; readonly timestamps: FileTimestamps }[],
  feature: string,
): readonly { readonly entry: DirectoryEntry; readonly timestamps: FileTimestamps }[] {
  const movedPaths = new Set(moved.map((file) => file.path))
  const placeholders = untouched.map(({ entry }) => ({
    path: `.scratch/${feature}/issues/${entry.name}`,
    feature,
    name: entry.name,
    content: '',
    createdAt: '',
    updatedAt: '',
  }))

  const probe = parseMarkdownTickets([...moved, ...placeholders])
  const referenced = new Set<string>()
  for (const ticket of probe) {
    if (!movedPaths.has(ticket.ref)) continue
    for (const ref of ticket.blockedBy ?? []) referenced.add(ref)
  }

  return untouched.filter(({ entry }) => referenced.has(`.scratch/${feature}/issues/${entry.name}`))
}

/**
 * 读一个工单文件的内容与时间戳。
 * @param files - 文件读取能力。
 * @param feature - feature 目录名。
 * @param name - 文件名。
 * @param path - 文件的绝对路径。
 * @param timestamps - 文件的创建与修改时间。
 * @returns 工单文件。
 */
async function readTicketFile(
  files: WorkspaceFiles,
  feature: string,
  name: string,
  path: string,
  timestamps: FileTimestamps,
): Promise<MarkdownTicketFile> {
  const content = await files.readTextFile(path)
  return {
    path: `.scratch/${feature}/issues/${name}`,
    feature,
    name,
    content,
    createdAt: new Date(timestamps.createdAt).toISOString(),
    updatedAt: new Date(timestamps.updatedAt).toISOString(),
  }
}

/**
 * 判断文件系统错误是否只是「文件/目录不存在」。
 * @param error - 任意错误。
 * @returns ENOENT 或 ENOTDIR 时为 true。
 */
export function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  )
}
