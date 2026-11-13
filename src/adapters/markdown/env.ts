/**
 * 本地工单目录的环境探测：列出 `.scratch/<feature>/issues/*.md`，
 * 区分“没有目录”“没有工单文件”和“文件缺少 Status: 行”。
 *
 * 只读；扫描规则与本地 Markdown 工单后端共用 {@link readLocalTicketFiles}，
 * 环境检查说读不到的目录，工单列表也不会读到。
 */
import type { LocalIssuesFact } from '../../core/env-check.ts'
import { parseTicketStatus } from '../../core/markdown.ts'
import { readLocalTicketFiles, type WorkspaceFiles } from './files.ts'

/** 本地工单目录的探测：工作区根目录 → 探测事实。 */
export type LocalIssuesProbe = (workspaceRoot: string) => Promise<LocalIssuesFact>

/** 本地工单目录探测依赖。 */
export interface LocalIssuesProbeDeps {
  readonly files: WorkspaceFiles
}

/**
 * 创建本地工单目录探测。
 * @param deps - 工单文件读取能力。
 * @returns 探测函数；读取失败照常抛出，由环境检查翻译成探测失败。
 */
export function createLocalIssuesProbe(deps: LocalIssuesProbeDeps): LocalIssuesProbe {
  return async (workspaceRoot) => {
    const tickets = await readLocalTicketFiles(deps.files, workspaceRoot)
    if (tickets === undefined) return { status: 'no-scratch' }
    if (tickets.length === 0) return { status: 'no-files' }

    const unparsable = tickets
      .filter((ticket) => parseTicketStatus(ticket.content) === undefined)
      .map((ticket) => ticket.path)
    if (unparsable.length > 0) return { status: 'unparsable', files: unparsable }

    return { status: 'found', files: tickets.map((ticket) => ticket.path) }
  }
}
