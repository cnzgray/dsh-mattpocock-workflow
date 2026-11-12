/**
 * 本地 Markdown 工单后端：扫描 `<workspaceRoot>/.scratch/<feature>/issues/*.md`。
 * 只认一层 feature 目录，`spec.md`、`map.md` 不在 issues 目录里，自然被忽略。
 * 文件读取能力由宿主注入，测试用内存假实现。
 */
import {
  parseMarkdownTickets,
  workspaceName,
  type MarkdownTicketFile,
} from '../../core/markdown.ts'
import type { Tracker, TrackerSnapshot } from '../../core/ticket.ts'
import { TrackerError } from '../../core/tracker-error.ts'
import type { DirectoryEntry, WorkspaceFiles } from './files.ts'

/** 本地 Markdown 后端依赖。 */
export interface MarkdownTrackerDeps {
  readonly files: WorkspaceFiles
  readonly now: () => number
}

/**
 * 创建本地 Markdown 工单后端。
 * @param deps - 文件读取能力与时钟。
 * @returns 满足 core `Tracker` 契约的后端。
 */
export function createMarkdownTracker(deps: MarkdownTrackerDeps): Tracker {
  return {
    async fetchSnapshot(workspaceRoot: string): Promise<TrackerSnapshot> {
      let tickets: readonly MarkdownTicketFile[]

      try {
        tickets = await scan(deps.files, workspaceRoot)
      } catch (error) {
        throw new TrackerError(
          'markdown-read-failed',
          '读取 .scratch 里的工单失败，请检查文件读取权限。',
          { cause: error },
        )
      }

      const parsed = parseMarkdownTickets(tickets)
      return {
        repository: workspaceName(workspaceRoot),
        fetchedAt: deps.now(),
        loaded: parsed.length,
        total: parsed.length,
        tickets: parsed,
      }
    },
  }
}

async function scan(
  files: WorkspaceFiles,
  workspaceRoot: string,
): Promise<readonly MarkdownTicketFile[]> {
  const scratch = joinPath(workspaceRoot, '.scratch')
  const features = await files.listDirectory(scratch)
  if (features === undefined) return []

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

function joinPath(base: string, ...segments: readonly string[]): string {
  const root = base.replace(/[\\/]+$/, '')
  return [root, ...segments].join('/')
}
