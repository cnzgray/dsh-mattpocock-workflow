import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SNAPSHOT_STORE_VERSION, type SnapshotStoreEntry } from '../../core/snapshot-store.ts'
import {
  SNAPSHOT_STORE_MAX_ENTRIES,
  SNAPSHOT_STORE_TTL_MS,
  createNodeSnapshotStore,
} from './snapshot-store.ts'

let root = ''
let workspace = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-mattwf-store-'))
  workspace = join(root, 'workspace')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function entry(overrides: Partial<SnapshotStoreEntry> = {}): SnapshotStoreEntry {
  return {
    version: SNAPSHOT_STORE_VERSION,
    workspaceRoot: workspace,
    backend: 'github',
    repository: 'cnzgray/repo',
    repositoryKey: 'github@github.com/cnzgray/repo',
    repositoryHost: 'github.com',
    viewer: 'cnzgray',
    fetchedAt: 1_000,
    loaded: 1,
    total: 1,
    hierarchy: 'native',
    tickets: [
      {
        ref: '#1',
        number: 1,
        title: '一张票',
        state: 'open',
        labels: ['ready-for-agent'],
        author: null,
        assignees: [],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        openBlockers: 0,
      },
    ],
    ...overrides,
  }
}

function store() {
  return createNodeSnapshotStore({ root: join(root, 'cache'), env: {}, home: root, tmp: root })
}

describe('本地快照库的文件实现', () => {
  it('写入后能读回同一份条目', async () => {
    const cache = store()
    const original = entry()

    await cache.write(original)

    await expect(cache.read(workspace)).resolves.toEqual(original)
  })

  it('没有条目时读到 undefined', async () => {
    await expect(store().read(workspace)).resolves.toBeUndefined()
  })

  it('文件损坏时读到 undefined', async () => {
    const cache = store()
    await cache.write(entry())
    await writeFile(join(root, 'cache', fileName(workspace)), 'not json')

    await expect(cache.read(workspace)).resolves.toBeUndefined()
  })

  it('清空后条目全部消失并返回清掉的数量', async () => {
    const cache = store()
    await cache.write(entry())

    await expect(cache.clear()).resolves.toBe(1)
    await expect(cache.list()).resolves.toEqual([])
  })

  it('工作区目录已经不在时清掉对应条目', async () => {
    const cache = store()
    await cache.write(entry({ workspaceRoot: join(root, 'gone') }))

    await expect(cache.prune(1_000)).resolves.toBe(1)
    await expect(cache.list()).resolves.toEqual([])
  })

  it('长期未更新的条目被淘汰', async () => {
    const cache = store()
    await cache.write(entry({ fetchedAt: 1_000 }))

    const removed = await cache.prune(1_000 + SNAPSHOT_STORE_TTL_MS + 1)

    expect(removed).toBe(1)
    await expect(cache.list()).resolves.toEqual([])
  })

  it('条目数量超过上限时按最后使用时间淘汰最旧的', async () => {
    const cache = store()
    const extra = SNAPSHOT_STORE_MAX_ENTRIES + 1
    for (let index = 0; index < extra; index += 1) {
      const directory = join(root, `workspace-${String(index)}`)
      await mkdir(directory, { recursive: true })
      await cache.write(entry({ workspaceRoot: directory, fetchedAt: index }))
    }

    const removed = await cache.prune(10_000)

    expect(removed).toBe(1)
    const remaining = await cache.list()
    expect(remaining).toHaveLength(SNAPSHOT_STORE_MAX_ENTRIES)
    expect(remaining.some((item) => item.fetchedAt === 0)).toBe(false)
  })

  it('变更后缓存里那张票跟着更新', async () => {
    const cache = store()
    await cache.write(entry())

    const patched = await cache.patchTicket(workspace, '#1', { labels: ['bug'], state: 'closed' })

    expect(patched).toBe(true)
    const stored = await cache.read(workspace)
    expect(stored?.tickets[0]?.labels).toEqual(['bug'])
    expect(stored?.tickets[0]?.state).toBe('closed')
  })

  it('缓存里没有这张票时变更返回 false', async () => {
    const cache = store()
    await cache.write(entry())

    await expect(cache.patchTicket(workspace, '#99', { state: 'closed' })).resolves.toBe(false)
  })

  it('删除后那张票从缓存里消失', async () => {
    const cache = store()
    await cache.write(entry())

    await expect(cache.removeTicket(workspace, '#1')).resolves.toBe(true)
    const stored = await cache.read(workspace)
    expect(stored?.tickets).toEqual([])
  })

  it('缓存位置用符号形式给出', () => {
    const withHome = createNodeSnapshotStore({ env: { DSH_HOME: '/data/dsh' }, home: root })
    const withoutHome = createNodeSnapshotStore({ env: {}, home: root })

    expect(withHome.location()).toBe('$DSH_HOME/cache/dsh-mattpocock-workflow')
    expect(withoutHome.location()).toBe('~/.dsh/cache/dsh-mattpocock-workflow')
  })
})

/** 取出某个工作区对应的缓存文件名。 */
function fileName(workspaceRoot: string): string {
  return `${createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 16)}.json`
}
