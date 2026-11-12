/**
 * 本地 Markdown 后端的文件系统接缝。Tracker 只依赖这个接口，
 * 测试用内存实现，正式代码在这里包一层 `node:fs`。
 */
import { readFile, readdir, stat } from 'node:fs/promises'

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

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  )
}
