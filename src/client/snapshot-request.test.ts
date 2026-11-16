/**
 * 后台刷新的落地规则：只有界面看得到的东西变了才改写快照。
 * 新建、改标签、改状态、关闭都算变化；只是又拉了一次不算。
 */
import { describe, expect, it } from 'vitest'

import type { WorkspaceSnapshot } from '../protocol/tracker.ts'
import { snapshotVisibleChange } from './snapshot-request.ts'
import { NOW, SNAPSHOT, TICKETS } from './task-panel-test-support.ts'

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
