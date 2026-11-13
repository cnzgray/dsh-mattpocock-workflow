import { describe, expect, it } from 'vitest'

import type { Tracker } from '../../core/ticket.ts'
import { describeTrackerContract } from '../contract.test-suite.ts'
import type { WorkspaceFiles } from './files.ts'
import { createMarkdownTracker } from './tracker.ts'

const NOW = 1_700_000_000_000
const CREATED = Date.parse('2026-01-01T00:00:00Z')
const UPDATED = Date.parse('2026-01-02T00:00:00Z')

interface FileSpec {
  readonly content: string
  readonly createdAt?: number
  readonly updatedAt?: number
}

interface TreeSpec {
  /** 目录路径 → 子项名字；名字以 `/` 结尾表示子目录。 */
  readonly directories: Record<string, readonly string[]>
  /** 绝对路径 → 文件内容与时间戳。 */
  readonly files: Record<string, FileSpec>
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
      const file = tree.files[path]
      return file === undefined
        ? Promise.reject(new Error(`ENOENT: ${path}`))
        : Promise.resolve(file.content)
    },
    statFile(path) {
      const file = tree.files[path]
      if (file === undefined) return Promise.reject(new Error(`ENOENT: ${path}`))
      return Promise.resolve({
        createdAt: file.createdAt ?? CREATED,
        updatedAt: file.updatedAt ?? UPDATED,
      })
    },
  }
}

const TREE: TreeSpec = {
  directories: {
    '/ws/.scratch': ['login/', 'billing/', 'notes.md'],
    '/ws/.scratch/login': ['spec.md', 'map.md', 'issues/'],
    '/ws/.scratch/login/issues': ['03-session.md', '01-token.md', '02-bug.md', 'skip.txt'],
    '/ws/.scratch/billing': ['issues/'],
    '/ws/.scratch/billing/issues': ['05-refund.md'],
  },
  files: {
    '/ws/.scratch/login/spec.md': { content: '# 登录规格\n' },
    '/ws/.scratch/login/map.md': { content: '# 地图\n' },
    '/ws/.scratch/login/issues/01-token.md': {
      content: '# 令牌刷新\n\nStatus: resolved\n',
    },
    '/ws/.scratch/login/issues/02-bug.md': {
      content: '# 会话 bug\n\nStatus: ready-for-agent\nBlocked by: 01, 03\n',
    },
    '/ws/.scratch/login/issues/03-session.md': {
      content: '# 会话过期处理\n\nStatus: ready-for-agent\n',
    },
    '/ws/.scratch/billing/issues/05-refund.md': {
      content: '# 退款流程\n\nStatus: claimed\n',
    },
    '/ws/.scratch/login/issues/skip.txt': { content: '不是工单' },
  },
}

function trackerFor(tree: TreeSpec = TREE): Tracker {
  return createMarkdownTracker({ files: memoryFiles(tree), now: () => NOW })
}

describe('本地 Markdown 工单后端', () => {
  it('按 feature 与文件名顺序扫描 issues 目录，忽略 spec、map 与非 md 文件', async () => {
    const snapshot = await trackerFor().fetchSnapshot('/ws')

    expect(snapshot.repository).toBe('ws')
    expect(snapshot.fetchedAt).toBe(NOW)
    expect(snapshot.loaded).toBe(4)
    expect(snapshot.total).toBe(4)
    expect(snapshot.tickets.map((ticket) => ticket.ref)).toEqual([
      '.scratch/billing/issues/05-refund.md',
      '.scratch/login/issues/01-token.md',
      '.scratch/login/issues/02-bug.md',
      '.scratch/login/issues/03-session.md',
    ])
  })

  it('映射标题、状态、标签、时间戳与阻塞数', async () => {
    const snapshot = await trackerFor().fetchSnapshot('/ws')

    expect(snapshot.tickets[1]).toEqual({
      ref: '.scratch/login/issues/01-token.md',
      number: null,
      title: '令牌刷新',
      state: 'closed',
      labels: ['resolved'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      openBlockers: 0,
    })
    expect(snapshot.tickets.map((ticket) => ticket.openBlockers)).toEqual([0, 0, 1, 0])
  })

  it('工作区还没有 .scratch 时返回空快照', async () => {
    const snapshot = await trackerFor({ directories: {}, files: {} }).fetchSnapshot('/empty')

    expect(snapshot).toEqual({
      repository: 'empty',
      fetchedAt: NOW,
      loaded: 0,
      total: 0,
      tickets: [],
    })
  })

  it('feature 下没有 issues 目录时跳过', async () => {
    const snapshot = await trackerFor({
      directories: { '/ws/.scratch': ['draft/'] },
      files: {},
    }).fetchSnapshot('/ws')

    expect(snapshot.tickets).toEqual([])
  })

  it('读取文件失败时返回 markdown-read-failed', async () => {
    const tree = {
      ...TREE,
      failRead: ['/ws/.scratch/login/issues/01-token.md'],
    }

    await expect(trackerFor(tree).fetchSnapshot('/ws')).rejects.toMatchObject({
      code: 'markdown-read-failed',
    })
  })
})

describeTrackerContract('本地 Markdown', {
  createTracker: () => trackerFor(),
  workspaceRoot: '/ws',
  expected: {
    repository: 'ws',
    total: 4,
    refs: [
      '.scratch/billing/issues/05-refund.md',
      '.scratch/login/issues/01-token.md',
      '.scratch/login/issues/02-bug.md',
      '.scratch/login/issues/03-session.md',
    ],
    fetchedAt: NOW,
  },
  empty: {
    createTracker: () => trackerFor({ directories: {}, files: {} }),
    repository: 'ws',
    fetchedAt: NOW,
  },
  nativeBlockers: { kind: 'none', expected: [0, 0, 1, 0] },
})
