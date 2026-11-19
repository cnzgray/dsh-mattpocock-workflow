import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SNAPSHOT_STORE_VERSION, type SnapshotStoreEntry } from '../../core/snapshot-store.ts'
import type { Ticket } from '../../core/ticket.ts'
import {
  SNAPSHOT_CHANGELOG_LIMIT,
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

function ticket(ref: string, overrides: Partial<Ticket> = {}): Ticket {
  const number = Number.parseInt(ref.slice(1), 10)
  return {
    ref,
    number: Number.isInteger(number) ? number : null,
    title: `票 ${ref}`,
    state: 'open',
    labels: [],
    author: null,
    assignees: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    openBlockers: 0,
    ...overrides,
  }
}

/** 最小可用的概览统计：存储把它当不透明 JSON 往返，字段形状随 core 校验走。 */
function metrics() {
  const value = { value: 0, gap: null }
  return {
    openBacklog: 0,
    readyCapacity: 0,
    blockedRatio: 0,
    needsTriage: 0,
    stalled: 0,
    staleCount: value,
    staleRatio: value,
    oldestUpdateDays: value,
    longestBlockerChain: value,
    openedLast30Days: value,
    closedLast30Days: value,
    netFlow: value,
    coverage: { truncated: false },
    pressure: { tier: 'light' as const, dimensions: [] },
    attention: [],
  }
}

function entry(overrides: Partial<SnapshotStoreEntry> = {}): SnapshotStoreEntry {
  return {
    version: SNAPSHOT_STORE_VERSION,
    libraryVersion: 0,
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
    metrics: metrics(),
    tickets: [ticket('#1')],
    ...overrides,
  }
}

function store() {
  return createNodeSnapshotStore({ root: join(root, 'cache'), env: {}, home: root, tmp: root })
}

/** 工作区对应的缓存目录（布局是适配器内部私事，只在本适配器的测试里用）。 */
function dirFor(workspaceRoot: string): string {
  const key = createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 16)
  return join(root, 'cache', key)
}

describe('本地快照库的文件实现', () => {
  it('写入后能读回同一份条目，库版本从 1 开始', async () => {
    const cache = store()
    const original = entry()

    const version = await cache.write(original)

    expect(version).toBe(1)
    await expect(cache.read(workspace)).resolves.toEqual({ ...original, libraryVersion: 1 })
  })

  it('库版本单调自增', async () => {
    const cache = store()

    await cache.write(entry())
    await cache.write(entry({ fetchedAt: 2_000 }))

    await expect(cache.version(workspace)).resolves.toBe(2)
  })

  it('没有条目时读到 undefined、版本为 null', async () => {
    const cache = store()
    await expect(cache.read(workspace)).resolves.toBeUndefined()
    await expect(cache.version(workspace)).resolves.toBeNull()
  })

  it('meta 损坏时按没有缓存处理，不影响其它工作区', async () => {
    const cache = store()
    await cache.write(entry())
    const other = join(root, 'other-workspace')
    await mkdir(other, { recursive: true })
    await cache.write(entry({ workspaceRoot: other, repository: 'cnzgray/other' }))

    await writeFile(join(dirFor(workspace), 'meta.json'), 'not json')

    await expect(cache.read(workspace)).resolves.toBeUndefined()
    await expect(cache.version(workspace)).resolves.toBeNull()
    await expect(cache.read(other)).resolves.toMatchObject({ repository: 'cnzgray/other' })
  })

  it('个别票文件缺失时整份读降级为没有缓存，下一次全量写自愈', async () => {
    const cache = store()
    await cache.write(entry())

    const files = await readdir(join(dirFor(workspace), 'tickets'))
    expect(files).toHaveLength(1)
    await rm(join(dirFor(workspace), 'tickets', files[0] ?? ''), { force: true })

    await expect(cache.read(workspace)).resolves.toBeUndefined()

    // 下一次全量写重新铺票文件，读恢复。
    await cache.write(entry({ fetchedAt: 2_000 }))
    await expect(cache.read(workspace)).resolves.toMatchObject({ fetchedAt: 2_000 })
  })

  it('按版本区间读净变化集：变更行取最终状态，删除行进墓碑', async () => {
    const cache = store()
    await cache.write(entry({ tickets: [ticket('#1'), ticket('#2')] }))
    await cache.write(
      entry({ tickets: [ticket('#1'), ticket('#2', { title: '改过' }), ticket('#3')] }),
    )
    await cache.write(entry({ tickets: [ticket('#2', { title: '改过' }), ticket('#3')] }))

    const all = await cache.changesSince(workspace, 0)
    expect(all?.version).toBe(3)
    expect(all?.tickets.map((item) => [item.ref, item.title])).toEqual([
      ['#2', '改过'],
      ['#3', '票 #3'],
    ])
    expect(all?.removed).toEqual(['#1'])

    const sinceTwo = await cache.changesSince(workspace, 2)
    expect(sinceTwo?.tickets).toEqual([])
    expect(sinceTwo?.removed).toEqual(['#1'])

    // 起点等于当前版本：空变化集。
    await expect(cache.changesSince(workspace, 3)).resolves.toEqual({
      version: 3,
      tickets: [],
      removed: [],
    })
  })

  it('变化日志只保留最近一批，更旧的起点读不到时返回 undefined', async () => {
    const cache = store()
    for (let index = 1; index <= SNAPSHOT_CHANGELOG_LIMIT + 2; index += 1) {
      await cache.write(entry({ tickets: [ticket(`#${String(index)}`)], fetchedAt: 1_000 + index }))
    }

    // 起点 0 比日志覆盖还旧：净变化算不全，回退整份。
    await expect(cache.changesSince(workspace, 0)).resolves.toBeUndefined()
    // 覆盖范围内的起点仍可读。
    const recent = await cache.changesSince(workspace, SNAPSHOT_CHANGELOG_LIMIT + 1)
    expect(recent?.tickets.map((item) => item.ref)).toEqual([
      `#${String(SNAPSHOT_CHANGELOG_LIMIT + 2)}`,
    ])
  })

  it('先墓碑后同引用回归时，净变化以最终状态为准', async () => {
    const cache = store()
    await cache.write(entry({ tickets: [ticket('#1')] }))
    // v2：#1 删除。
    await cache.write(entry({ tickets: [] }))
    // v3：#1 重新出现。
    await cache.write(entry({ tickets: [ticket('#1', { title: '回来了' })] }))

    const changes = await cache.changesSince(workspace, 1)
    expect(changes?.tickets.map((item) => item.title)).toEqual(['回来了'])
    expect(changes?.removed).toEqual([])
  })

  it('票文件缺失时按版本读变化集返回 undefined（调用方回退整份）', async () => {
    const cache = store()
    await cache.write(entry({ tickets: [ticket('#1'), ticket('#2')] }))
    await cache.write(entry({ tickets: [ticket('#1'), ticket('#2', { title: '改过' })] }))
    const files = await readdir(join(dirFor(workspace), 'tickets'))
    // 两个票文件：一个稳定（#1）、一个是 #2 的最新内容。
    for (const file of files) {
      const raw = await readFile(join(dirFor(workspace), 'tickets', file), 'utf8')
      if (!raw.includes('改过')) continue
      await rm(join(dirFor(workspace), 'tickets', file), { force: true })
    }

    await expect(cache.changesSince(workspace, 1)).resolves.toBeUndefined()
  })

  it('崩溃停在 meta 之前时不留可见半批，孤儿票文件下次全量写清理', async () => {
    const cache = store()
    await cache.write(entry({ tickets: [ticket('#1')] }))
    await cache.write(entry({ tickets: [ticket('#1'), ticket('#2')] }))

    // 模拟崩溃在提交点前：meta 消失，票文件与日志残留。
    await rm(join(dirFor(workspace), 'meta.json'))
    await expect(cache.read(workspace)).resolves.toBeUndefined()

    await cache.write(entry({ tickets: [ticket('#3')] }))
    const stored = await cache.read(workspace)
    expect(stored?.tickets.map((item) => item.ref)).toEqual(['#3'])
    // 孤儿（#1、#2 的票文件）已被清扫，磁盘只剩当前清单引用的文件。
    const remaining = await readdir(join(dirFor(workspace), 'tickets'))
    expect(remaining).toHaveLength(1)
  })

  it('墓碑清单记录最近一次提交删掉的票', async () => {
    const cache = store()
    await cache.write(entry({ tickets: [ticket('#1'), ticket('#2')] }))
    await cache.write(entry({ tickets: [ticket('#1')] }))

    const tombstones = JSON.parse(
      await readFile(join(dirFor(workspace), 'tombstones.json'), 'utf8'),
    ) as unknown
    expect(tombstones).toEqual(['#2'])
  })

  it('清空后条目全部消失并返回清掉的数量', async () => {
    const cache = store()
    await cache.write(entry())

    await expect(cache.clear()).resolves.toBe(1)
    await expect(cache.list()).resolves.toEqual([])
  })

  it('变化日志损坏时按版本读变化集返回 undefined（回退整份）', async () => {
    const cache = store()
    await cache.write(entry({ tickets: [ticket('#1'), ticket('#2')] }))
    await cache.write(entry({ tickets: [ticket('#1'), ticket('#2', { title: '改过' })] }))
    await writeFile(join(dirFor(workspace), 'log.json'), 'not json')

    await expect(cache.changesSince(workspace, 1)).resolves.toBeUndefined()

    // 下一次写入重建日志，读恢复。
    await cache.write(entry({ fetchedAt: 2_000 }))
    await expect(cache.changesSince(workspace, 2)).resolves.toMatchObject({ version: 3 })
  })

  it('prune 清掉旧版布局残留的按工作区 JSON 文件', async () => {
    const cache = store()
    await mkdir(workspace, { recursive: true })
    await cache.write(entry())
    const legacy = join(root, 'cache', 'legacy-leftover.json')
    await writeFile(legacy, '{}')

    await expect(cache.prune(1_000)).resolves.toBe(1)
    await expect(readFile(legacy, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
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

  it('变更后缓存里那张票跟着更新，库版本前进', async () => {
    const cache = store()
    await cache.write(entry())

    const patched = await cache.patchTicket(workspace, '#1', { labels: ['bug'], state: 'closed' })

    expect(patched).toBe(true)
    const stored = await cache.read(workspace)
    expect(stored?.tickets[0]?.labels).toEqual(['bug'])
    expect(stored?.tickets[0]?.state).toBe('closed')
    expect(stored?.libraryVersion).toBe(2)
  })

  it('缓存里没有这张票时变更返回 false', async () => {
    const cache = store()
    await cache.write(entry())

    await expect(cache.patchTicket(workspace, '#99', { state: 'closed' })).resolves.toBe(false)
  })

  it('删除后那张票从缓存里消失并记墓碑，库版本前进', async () => {
    const cache = store()
    await cache.write(entry())

    await expect(cache.removeTicket(workspace, '#1')).resolves.toBe(true)
    const stored = await cache.read(workspace)
    expect(stored?.tickets).toEqual([])
    expect(stored?.libraryVersion).toBe(2)
    const changes = await cache.changesSince(workspace, 1)
    expect(changes?.removed).toEqual(['#1'])
  })

  it('缓存位置用符号形式给出', () => {
    const withHome = createNodeSnapshotStore({ env: { DSH_HOME: '/data/dsh' }, home: root })
    const withoutHome = createNodeSnapshotStore({ env: {}, home: root })

    expect(withHome.location()).toBe('$DSH_HOME/cache/dsh-mattpocock-workflow')
    expect(withoutHome.location()).toBe('~/.dsh/cache/dsh-mattpocock-workflow')
  })
})
