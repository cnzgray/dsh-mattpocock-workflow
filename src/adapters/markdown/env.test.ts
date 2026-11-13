import { describe, expect, it } from 'vitest'

import { createLocalIssuesProbe } from './env.ts'
import type { WorkspaceFiles } from './files.ts'

const CREATED = Date.parse('2026-01-01T00:00:00Z')
const UPDATED = Date.parse('2026-01-02T00:00:00Z')

interface TreeSpec {
  /** 目录路径 → 子项名字；名字以 `/` 结尾表示子目录。 */
  readonly directories: Record<string, readonly string[]>
  /** 绝对路径 → 文件内容。 */
  readonly files: Record<string, string>
  readonly failRead?: readonly string[]
}

function memoryFiles(tree: TreeSpec): WorkspaceFiles {
  return {
    listDirectory(path) {
      const names = tree.directories[path]
      if (names === undefined) return Promise.resolve(undefined)
      return Promise.resolve(
        names.map((name) => ({
          name: name.replace(/\/$/, ''),
          kind: name.endsWith('/') ? 'directory' : 'file',
        })),
      )
    },
    readTextFile(path) {
      if (tree.failRead?.includes(path) === true) {
        return Promise.reject(new Error('permission denied'))
      }
      const content = tree.files[path]
      return content === undefined
        ? Promise.reject(new Error(`ENOENT: ${path}`))
        : Promise.resolve(content)
    },
    statFile(path) {
      if (tree.files[path] === undefined) {
        return Promise.reject(new Error(`ENOENT: ${path}`))
      }
      return Promise.resolve({ createdAt: CREATED, updatedAt: UPDATED })
    },
  }
}

const TREE: TreeSpec = {
  directories: {
    '/ws/.scratch': ['billing/', 'login/', 'notes.md'],
    '/ws/.scratch/billing': ['issues/'],
    '/ws/.scratch/billing/issues': ['05-refund.md'],
    '/ws/.scratch/login': ['spec.md', 'issues/'],
    '/ws/.scratch/login/issues': ['03-session.md', '01-token.md', 'skip.txt'],
  },
  files: {
    '/ws/.scratch/billing/issues/05-refund.md': '# 退款流程\n\nStatus: claimed\n',
    '/ws/.scratch/login/spec.md': '# 登录规格\n',
    '/ws/.scratch/login/issues/01-token.md': '# 令牌刷新\n\nStatus: resolved\n',
    '/ws/.scratch/login/issues/03-session.md': '# 会话过期\n\nStatus: ready-for-agent\n',
    '/ws/.scratch/login/issues/skip.txt': '不是工单',
  },
}

describe('本地工单目录探测', () => {
  it('按 feature 与文件名顺序列出 issues 下的工单文件', async () => {
    const probe = createLocalIssuesProbe({ files: memoryFiles(TREE) })

    await expect(probe('/ws')).resolves.toEqual({
      status: 'found',
      files: [
        '.scratch/billing/issues/05-refund.md',
        '.scratch/login/issues/01-token.md',
        '.scratch/login/issues/03-session.md',
      ],
    })
  })

  it('工作区没有 .scratch 目录时报告缺失', async () => {
    const probe = createLocalIssuesProbe({ files: memoryFiles({ directories: {}, files: {} }) })

    await expect(probe('/ws')).resolves.toEqual({ status: 'no-scratch' })
  })

  it('.scratch 存在但没有 issues 下的 md 文件时报告为空', async () => {
    const probe = createLocalIssuesProbe({
      files: memoryFiles({
        directories: {
          '/ws/.scratch': ['login/'],
          '/ws/.scratch/login': ['issues/', 'spec.md'],
          '/ws/.scratch/login/issues': ['notes.txt'],
        },
        files: { '/ws/.scratch/login/issues/notes.txt': '不是工单' },
      }),
    })

    await expect(probe('/ws')).resolves.toEqual({ status: 'no-files' })
  })

  it('工单文件缺少 Status: 行时点名该文件', async () => {
    const probe = createLocalIssuesProbe({
      files: memoryFiles({
        directories: {
          '/ws/.scratch': ['login/'],
          '/ws/.scratch/login': ['issues/'],
          '/ws/.scratch/login/issues': ['01-token.md', '02-broken.md'],
        },
        files: {
          '/ws/.scratch/login/issues/01-token.md': '# 令牌刷新\n\nStatus: resolved\n',
          '/ws/.scratch/login/issues/02-broken.md': '# 写错的工单\n\n状态: open\n',
        },
      }),
    })

    await expect(probe('/ws')).resolves.toEqual({
      status: 'unparsable',
      files: ['.scratch/login/issues/02-broken.md'],
    })
  })

  it('读文件失败照常抛出，由环境检查翻译成探测失败', async () => {
    const probe = createLocalIssuesProbe({
      files: memoryFiles({ ...TREE, failRead: ['/ws/.scratch/login/issues/01-token.md'] }),
    })

    await expect(probe('/ws')).rejects.toThrow('permission denied')
  })
})
