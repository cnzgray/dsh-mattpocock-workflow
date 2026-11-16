/**
 * 本地 Markdown 工单的详情：直接读 `.scratch/<feature>/issues/*.md`。
 *
 * 这是一个只读的「文件视图」：正文取标题之后、`## Comments` 之前的内容，
 * 评论段按空行分段；没有链接地址、分配人和任何写操作。
 */
import {
  markdownLabels,
  markdownState,
  parseMarkdownDetail,
  titleFromFileName,
} from '../../core/markdown.ts'
import type { TicketDetail, TicketReference } from '../../core/ticket.ts'
import { TrackerError } from '../../core/tracker-error.ts'
import { isMissingFile, joinPath, type FileTimestamps, type WorkspaceFiles } from './files.ts'

/** 本地工单引用必须是 `.scratch/<feature>/issues/<name>.md`，防止越界读文件。 */
const LOCAL_REF = /^\.scratch\/([^/]+)\/issues\/([^/]+\.md)$/i

/**
 * 引用是否指向一张本地工单。feature 段不允许是 `.` / `..`：
 * 否则 `.scratch/../issues/x.md` 会逃出 `.scratch` 目录读到别的文本文件。
 * @param ref - 相对工作区的引用。
 * @returns 合法时为 true。
 */
function isLocalRef(ref: string): boolean {
  const match = LOCAL_REF.exec(ref)
  if (match === null) return false
  const feature = match[1] ?? ''
  return feature !== '.' && feature !== '..'
}

/** 详情读取依赖。 */
export interface MarkdownDetailDeps {
  readonly files: WorkspaceFiles
}

/**
 * 读取一张本地工单的详情。
 * @param deps - 文件读取能力。
 * @param workspaceRoot - 工作区根目录。
 * @param reference - 工单引用，相对工作区的文件路径。
 * @returns 详情；评论没有作者与时间。
 * @throws {TrackerError} 引用越界或文件不存在、读不出来。
 */
export async function readMarkdownDetail(
  deps: MarkdownDetailDeps,
  workspaceRoot: string,
  reference: TicketReference,
): Promise<TicketDetail> {
  const relative = reference.ref
  if (!isLocalRef(relative)) {
    throw new TrackerError(
      'ticket-not-found',
      '找不到这张本地工单：引用不是 .scratch 下的工单路径。',
    )
  }

  const path = joinPath(workspaceRoot, relative)
  const { content, timestamps } = await readTicketFile(deps.files, path)

  const name = relative.slice(relative.lastIndexOf('/') + 1)
  const parsed = parseMarkdownDetail(content, titleFromFileName(name))

  return {
    ref: relative,
    number: null,
    title: parsed.title,
    state: markdownState(content),
    author: null,
    body: parsed.body,
    uploadsBaseUrl: null,
    labels: markdownLabels(content),
    assignees: [],
    comments: parsed.comments.map((body) => ({
      author: null,
      body,
      createdAt: null,
    })),
    url: null,
    createdAt: new Date(timestamps.createdAt).toISOString(),
    updatedAt: new Date(timestamps.updatedAt).toISOString(),
  }
}

async function readTicketFile(
  files: WorkspaceFiles,
  path: string,
): Promise<{ readonly content: string; readonly timestamps: FileTimestamps }> {
  try {
    const [content, timestamps] = await Promise.all([
      files.readTextFile(path),
      files.statFile(path),
    ])
    return { content, timestamps }
  } catch (error) {
    if (isMissingFile(error)) {
      throw new TrackerError('ticket-not-found', '找不到这张本地工单，它可能已被删除。', {
        cause: error,
      })
    }
    // 权限或 IO 失败不是「票不存在」，与列表阶段用同一个错误码。
    throw new TrackerError('markdown-read-failed', '读取本地工单文件失败，请检查文件读取权限。', {
      cause: error,
    })
  }
}
