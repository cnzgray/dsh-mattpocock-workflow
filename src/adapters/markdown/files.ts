/**
 * 本地 Markdown 后端的文件系统接缝。Tracker 只依赖这个接口，
 * 测试用内存实现，正式代码在这里包一层 `node:fs`。
 */
import { readFile, readdir, stat } from 'node:fs/promises'

import type { MarkdownTicketFile } from '../../core/markdown.ts'

/** 目录项类型。 */
export type DirectoryEntryKind = 'file' | 'directory'

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
        if (isMissing(error)) return undefined
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

function joinPath(base: string, ...segments: readonly string[]): string {
  const root = base.replace(/[\\/]+$/, '')
  return [root, ...segments].join('/')
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  )
}
