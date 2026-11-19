/**
 * 后台刷新的落地规则：只有界面看得到的东西变了才改写快照。
 * 新建、改标签、改状态、关闭都算变化；只是又拉了一次不算。
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { emptyMetrics } from '../protocol/snapshot-test-support.ts'
import type { SnapshotChanges, WorkspaceSnapshot } from '../protocol/tracker.ts'
import { useSnapshotRequest, snapshotVisibleChange } from './snapshot-request.ts'
import { clientWith, fullRefresh, NOW, SNAPSHOT, TICKETS } from './task-panel-test-support.ts'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function ticketByRef(ref: string): WorkspaceSnapshot['tickets'][number] {
  const ticket = SNAPSHOT.tickets.find((item) => item.ref === ref)
  if (ticket === undefined) throw new Error(`缺少夹具里的 ${ref}`)
  return ticket
}

describe('后台刷新的可见变化', () => {
  it('没有旧数据时一律落地', () => {
    expect(snapshotVisibleChange(null, SNAPSHOT)).toBe(true)
  })

  it('只是又拉了一次、数据本身没变时不落地', () => {
    const refetched: WorkspaceSnapshot = { ...SNAPSHOT, fetchedAt: NOW + 60_000 }

    expect(snapshotVisibleChange(SNAPSHOT, refetched)).toBe(false)
  })

  it('父子能力变化算界面变化，后台刷新会落地', () => {
    expect(
      snapshotVisibleChange(SNAPSHOT, { ...SNAPSHOT, hierarchy: 'none', fetchedAt: NOW + 60_000 }),
    ).toBe(true)
  })

  it('阻塞是否定稿不算界面变化：它随后会被补齐结果覆盖', () => {
    const provisional: WorkspaceSnapshot = {
      ...SNAPSHOT,
      blockersFinalized: false,
      fetchedAt: NOW + 60_000,
    }

    expect(snapshotVisibleChange(SNAPSHOT, provisional)).toBe(false)
  })

  it('新建工单算变化', () => {
    const created: WorkspaceSnapshot = {
      ...SNAPSHOT,
      tickets: [
        ...TICKETS,
        {
          ...ticketByRef('#1'),
          ref: '#6',
          number: 6,
          title: 'Foxtrot',
          status: 'open',
          skillAction: 'triage',
          skillActionReason: 'untriaged',
        },
      ],
      loaded: TICKETS.length + 1,
      total: 31,
    }

    expect(snapshotVisibleChange(SNAPSHOT, created)).toBe(true)
  })

  it('改标签导致判定变化时落地', () => {
    const retriaged: WorkspaceSnapshot = {
      ...SNAPSHOT,
      tickets: SNAPSHOT.tickets.map((ticket) =>
        ticket.ref === '#4'
          ? {
              ...ticket,
              labels: ['bug', 'ready-for-agent'],
              category: 'bug',
              status: 'ready',
              skillAction: 'implement',
              skillActionReason: 'ready-for-agent',
            }
          : ticket,
      ),
    }

    expect(snapshotVisibleChange(SNAPSHOT, retriaged)).toBe(true)
  })

  it('关闭工单算变化', () => {
    const closed: WorkspaceSnapshot = {
      ...SNAPSHOT,
      tickets: SNAPSHOT.tickets.map((ticket) =>
        ticket.ref === '#5'
          ? { ...ticket, state: 'closed', status: 'closed', skillAction: 'none' }
          : ticket,
      ),
    }

    expect(snapshotVisibleChange(SNAPSHOT, closed)).toBe(true)
  })

  it('当前登录用户变了也落地，人员筛选按新身份生效', () => {
    expect(snapshotVisibleChange(SNAPSHOT, { ...SNAPSHOT, viewer: 'other-user' })).toBe(true)
  })

  it('数据来源、陈旧标记与失败原因变了也落地', () => {
    expect(snapshotVisibleChange(SNAPSHOT, { ...SNAPSHOT, source: 'cache' })).toBe(true)
    expect(snapshotVisibleChange(SNAPSHOT, { ...SNAPSHOT, stale: true })).toBe(true)
    expect(
      snapshotVisibleChange(SNAPSHOT, {
        ...SNAPSHOT,
        refreshError: { code: 'fetch-failed', message: '网络断了' },
      }),
    ).toBe(true)
  })
})

describe('版本化刷新回包的落地', () => {
  /** 等首屏落地。 */
  async function ready(client: Parameters<typeof useSnapshotRequest>[0]) {
    const hook = renderHook(() => useSnapshotRequest(client, '/repo'))
    await waitFor(() => {
      expect(hook.result.current.snapshot).not.toBeNull()
    })
    return hook
  }

  it('数据没变（not-modified）时标成已核验的最新：清掉陈旧提示，数据时间推进到核对时刻', async () => {
    const stale: WorkspaceSnapshot = {
      ...SNAPSHOT,
      source: 'cache',
      stale: true,
      refreshError: { code: 'fetch-failed', message: '上一轮刷新失败' },
    }
    const client = clientWith({
      get: () => Promise.resolve({ ok: true, result: stale }),
      refresh: () =>
        Promise.resolve({ ok: true, result: { kind: 'not-modified', version: 1, checkedAt: NOW } }),
    })
    const hook = await ready(client)

    act(() => {
      hook.result.current.refresh()
    })
    await waitFor(() => {
      expect(hook.result.current.snapshot?.stale).toBe(false)
    })

    const snapshot = hook.result.current.snapshot
    // 数据本身一行没动；陈旧标记、失败原因与本地缓存徽标清掉，时间推进到核对时刻。
    expect(snapshot?.tickets).toBe(stale.tickets)
    expect(snapshot?.source).toBe('live')
    expect(snapshot?.fetchedAt).toBe(NOW)
    expect(snapshot?.refreshError).toBeNull()
  })

  it('刷新带上当前库版本', async () => {
    const versions: (number | undefined)[] = []
    const client = clientWith({
      get: () => Promise.resolve({ ok: true, result: SNAPSHOT }),
      refresh: (_root, options) => {
        versions.push(options?.ifVersion)
        return Promise.resolve({
          ok: true,
          result: { kind: 'not-modified', version: 1, checkedAt: NOW },
        })
      },
    })
    const hook = await ready(client)

    act(() => {
      hook.result.current.refresh()
    })
    await waitFor(() => {
      expect(versions).toEqual([1])
    })
  })

  it('变化行并入当前快照，墓碑引用从列表剔除', async () => {
    const changed: WorkspaceSnapshot['tickets'][number] = {
      ...ticketByRef('#2'),
      title: 'Bravo 改过标题',
    }
    const changes: SnapshotChanges = {
      kind: 'changes',
      version: 2,
      fetchedAt: NOW - 1_000,
      tickets: [changed],
      removed: ['#1'],
      metrics: emptyMetrics({ openBacklog: 3 }),
      viewer: 'cnzgray',
      total: 30,
      loaded: 4,
      windowLimit: 100,
      blockersFinalized: true,
    }
    const client = clientWith({
      get: () => Promise.resolve({ ok: true, result: SNAPSHOT }),
      refresh: () => Promise.resolve({ ok: true, result: changes }),
    })
    const hook = await ready(client)

    act(() => {
      hook.result.current.refresh()
    })
    await waitFor(() => {
      expect(hook.result.current.snapshot?.libraryVersion).toBe(2)
    })

    const snapshot = hook.result.current.snapshot
    expect(snapshot?.tickets.map((item) => item.ref)).toEqual(['#2', '#3', '#4', '#5'])
    expect(snapshot?.tickets[0]?.title).toBe('Bravo 改过标题')
    expect(snapshot?.metrics.openBacklog).toBe(3)
    expect(snapshot?.fetchedAt).toBe(NOW - 1_000)
    expect(snapshot?.source).toBe('live')
  })

  it('首屏补齐失败留下未定稿数据，not-modified 刷新仍再补齐并落地定稿结果', async () => {
    const provisional: WorkspaceSnapshot = { ...SNAPSHOT, blockersFinalized: false }
    const finalized: WorkspaceSnapshot = { ...SNAPSHOT, blockersFinalized: true }
    let failures = 1
    const resolveCalls: string[] = []
    const client = clientWith({
      get: () => Promise.resolve({ ok: true, result: provisional }),
      refresh: () =>
        Promise.resolve({ ok: true, result: { kind: 'not-modified', version: 1, checkedAt: NOW } }),
      resolveBlockers: (root) => {
        resolveCalls.push(root)
        if (failures > 0) {
          failures -= 1
          return Promise.resolve({
            ok: false,
            error: { code: 'fetch-failed', message: '补齐失败' },
          })
        }
        return Promise.resolve({ ok: true, result: finalized })
      },
    })
    const hook = await ready(client)
    expect(hook.result.current.snapshot?.blockersFinalized).toBe(false)

    act(() => {
      hook.result.current.refresh()
    })
    await waitFor(() => {
      expect(resolveCalls).toEqual(['/repo', '/repo'])
    })
    await waitFor(() => {
      expect(hook.result.current.snapshot?.blockersFinalized).toBe(true)
    })
  })

  it('整份回包走原有落地路径', async () => {
    const refreshed: WorkspaceSnapshot = {
      ...SNAPSHOT,
      libraryVersion: 2,
      tickets: TICKETS.filter((item) => item.ref !== '#1'),
      loaded: 4,
    }
    const client = clientWith({
      get: () => Promise.resolve({ ok: true, result: SNAPSHOT }),
      refresh: () => Promise.resolve(fullRefresh(refreshed)),
    })
    const hook = await ready(client)

    act(() => {
      hook.result.current.refresh()
    })
    await waitFor(() => {
      expect(hook.result.current.snapshot?.libraryVersion).toBe(2)
    })
    expect(hook.result.current.snapshot?.tickets.map((item) => item.ref)).toEqual([
      '#2',
      '#3',
      '#4',
      '#5',
    ])
  })
})
