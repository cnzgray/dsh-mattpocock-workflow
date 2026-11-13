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
import type { Tracker, TrackerChanges, TrackerSnapshot } from '../../core/ticket.ts'
import { TrackerError } from '../../core/tracker-error.ts'
import { readMarkdownDetail } from './detail.ts'
import {
  readChangedTicketFiles,
  readLocalTicketFiles,
  type LocalTicketChanges,
  type WorkspaceFiles,
} from './files.ts'

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
        tickets = (await readLocalTicketFiles(deps.files, workspaceRoot)) ?? []
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

    async fetchChanges(workspaceRoot: string, since: number): Promise<TrackerChanges> {
      let files: LocalTicketChanges | undefined

      try {
        files = await readChangedTicketFiles(deps.files, workspaceRoot, since)
      } catch (error) {
        throw new TrackerError(
          'markdown-read-failed',
          '读取 .scratch 里的工单失败，请检查文件读取权限。',
          { cause: error },
        )
      }

      if (files === undefined) return { tickets: [], truncated: false }

      // 补读的兄弟文件只为判定阻塞，结果里只留窗口内动过的票。
      const parsed = parseMarkdownTickets([...files.changed, ...files.context])
      const moved = new Set(files.changed.map((file) => file.path))

      return {
        tickets: parsed.filter((ticket) => moved.has(ticket.ref)),
        // 本地目录扫描没有上限，一次就能看全。
        truncated: false,
      }
    },

    // 本地 Markdown 只提供只读详情：没有链接、分配人与任何写操作。
    fetchDetail: (workspaceRoot, reference) => readMarkdownDetail(deps, workspaceRoot, reference),
  }
}
