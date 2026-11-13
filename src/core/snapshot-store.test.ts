import { describe, expect, it } from 'vitest'

import {
  SNAPSHOT_STORE_VERSION,
  parseSnapshotStoreEntry,
  serializeSnapshotStoreEntry,
  type SnapshotStoreEntry,
} from './snapshot-store.ts'

function entry(overrides: Partial<SnapshotStoreEntry> = {}): SnapshotStoreEntry {
  return {
    version: SNAPSHOT_STORE_VERSION,
    workspaceRoot: '/workspace',
    backend: 'github',
    repository: 'cnzgray/repo',
    repositoryKey: 'github@github.com/cnzgray/repo',
    repositoryHost: 'github.com',
    fetchedAt: 1_000,
    loaded: 1,
    total: 1,
    tickets: [
      {
        ref: '#1',
        number: 1,
        title: '一张票',
        state: 'open',
        labels: ['ready-for-agent'],
        author: { login: 'cnzgray', displayName: null, avatarUrl: null },
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        openBlockers: 0,
      },
    ],
    ...overrides,
  }
}

describe('本地快照库条目', () => {
  it('序列化后再解析得到同一份条目', () => {
    const original = entry()

    expect(parseSnapshotStoreEntry(serializeSnapshotStoreEntry(original))).toEqual(original)
  })

  it('格式版本不符时按没有缓存处理', () => {
    const raw = serializeSnapshotStoreEntry(entry({ version: 99 }))

    expect(parseSnapshotStoreEntry(raw)).toBeUndefined()
  })

  it('内容不是 JSON 时按没有缓存处理', () => {
    expect(parseSnapshotStoreEntry('not json')).toBeUndefined()
  })

  it('工单字段不合法时整份作废', () => {
    const raw = JSON.stringify({ ...entry(), tickets: [{ ref: '#1' }] })

    expect(parseSnapshotStoreEntry(raw)).toBeUndefined()
  })

  it('后端类型不认识时按没有缓存处理', () => {
    const raw = JSON.stringify({ ...entry(), backend: 'bitbucket' })

    expect(parseSnapshotStoreEntry(raw)).toBeUndefined()
  })

  it('缺少仓库身份时按没有缓存处理', () => {
    const raw = JSON.stringify({ ...entry(), repositoryKey: undefined })

    expect(parseSnapshotStoreEntry(raw)).toBeUndefined()
  })
})
