import { describe, expect, it } from 'vitest'

import { emptyMetrics } from '../protocol/snapshot-test-support.ts'
import {
  SNAPSHOT_STORE_VERSION,
  parseSnapshotStoreEntry,
  serializeSnapshotStoreEntry,
  type SnapshotStoreEntry,
} from './snapshot-store.ts'

function entry(overrides: Partial<SnapshotStoreEntry> = {}): SnapshotStoreEntry {
  return {
    version: SNAPSHOT_STORE_VERSION,
    libraryVersion: 1,
    workspaceRoot: '/workspace',
    backend: 'github',
    repository: 'cnzgray/repo',
    repositoryKey: 'github@github.com/cnzgray/repo',
    repositoryHost: 'github.com',
    viewer: 'cnzgray',
    fetchedAt: 1_000,
    loaded: 1,
    total: 1,
    hierarchy: 'native',
    metrics: emptyMetrics(),
    tickets: [
      {
        ref: '#1',
        number: 1,
        title: '一张票',
        state: 'open',
        labels: ['ready-for-agent'],
        author: { login: 'cnzgray', displayName: null, avatarUrl: null },
        assignees: ['alice'],
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

  it('工单网页地址随条目一起存取', () => {
    const base = entry()
    const ticket = base.tickets[0]
    if (ticket === undefined) throw new Error('缺少工单')
    const original = entry({
      tickets: [{ ...ticket, url: 'https://github.com/cnzgray/repo/issues/1' }],
    })

    expect(parseSnapshotStoreEntry(serializeSnapshotStoreEntry(original))).toEqual(original)
  })

  it('父子能力与父级引用随条目一起存取', () => {
    const base = entry({ hierarchy: 'convention' })
    const ticket = base.tickets[0]
    if (ticket === undefined) throw new Error('缺少工单')
    const original = entry({
      hierarchy: 'convention',
      tickets: [{ ...ticket, parent: '.scratch/login/issues/01-token.md' }],
    })

    expect(parseSnapshotStoreEntry(serializeSnapshotStoreEntry(original))).toEqual(original)
  })

  it('缺父子能力的旧版条目按没有缓存处理', () => {
    const raw = JSON.stringify({ ...entry(), hierarchy: undefined })

    expect(parseSnapshotStoreEntry(raw)).toBeUndefined()
  })

  it('父子能力取值不认识时按没有缓存处理', () => {
    const raw = JSON.stringify({ ...entry(), hierarchy: 'epic' })

    expect(parseSnapshotStoreEntry(raw)).toBeUndefined()
  })

  it('父级引用为空字符串时整份作废', () => {
    const base = entry()
    const ticket = base.tickets[0]
    if (ticket === undefined) throw new Error('缺少工单')
    const raw = JSON.stringify({ ...base, tickets: [{ ...ticket, parent: '' }] })

    expect(parseSnapshotStoreEntry(raw)).toBeUndefined()
  })

  it('版本 2 的旧缓存整体作废，重拉一次补齐父子字段', () => {
    const raw = serializeSnapshotStoreEntry(entry({ version: 2 }))

    expect(parseSnapshotStoreEntry(raw)).toBeUndefined()
  })

  it('不带网页地址的旧版条目按没有缓存处理，重拉一次补齐地址', () => {
    const raw = serializeSnapshotStoreEntry(entry({ version: 1 }))

    expect(parseSnapshotStoreEntry(raw)).toBeUndefined()
  })

  it('版本 2 的条目没有当前用户与分配人，按没有缓存处理', () => {
    const raw = serializeSnapshotStoreEntry(entry({ version: 2 }))

    expect(parseSnapshotStoreEntry(raw)).toBeUndefined()
  })

  it('当前用户为 null 的条目合法', () => {
    const original = entry({ viewer: null })

    expect(parseSnapshotStoreEntry(serializeSnapshotStoreEntry(original))).toEqual(original)
  })

  it('当前用户类型不对时整份作废', () => {
    const raw = JSON.stringify({ ...entry(), viewer: 7 })

    expect(parseSnapshotStoreEntry(raw)).toBeUndefined()
  })

  it('分配人不是字符串数组时整份作废', () => {
    const base = entry()
    const ticket = base.tickets[0]
    if (ticket === undefined) throw new Error('缺少工单')
    const raw = JSON.stringify({ ...base, tickets: [{ ...ticket, assignees: ['alice', 7] }] })

    expect(parseSnapshotStoreEntry(raw)).toBeUndefined()
  })

  it('缺少分配人字段时整份作废', () => {
    const base = entry()
    const ticket = base.tickets[0]
    if (ticket === undefined) throw new Error('缺少工单')
    const withoutAssignees: Record<string, unknown> = { ...ticket }
    delete withoutAssignees.assignees
    const raw = JSON.stringify({ ...base, tickets: [withoutAssignees] })

    expect(parseSnapshotStoreEntry(raw)).toBeUndefined()
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

  it('库版本与概览统计随条目一起存取', () => {
    const original = entry({ libraryVersion: 7, metrics: emptyMetrics({ openBacklog: 3 }) })

    expect(parseSnapshotStoreEntry(serializeSnapshotStoreEntry(original))).toEqual(original)
  })

  it('库版本不是非负整数时整份作废', () => {
    expect(
      parseSnapshotStoreEntry(JSON.stringify({ ...entry(), libraryVersion: -1 })),
    ).toBeUndefined()
    expect(
      parseSnapshotStoreEntry(JSON.stringify({ ...entry(), libraryVersion: '1' })),
    ).toBeUndefined()
  })

  it('概览统计结构不对时整份作废', () => {
    const broken = { ...entry().metrics } as Record<string, unknown>
    delete broken.openBacklog
    const raw = JSON.stringify({ ...entry(), metrics: broken })

    expect(parseSnapshotStoreEntry(raw)).toBeUndefined()
  })
})
