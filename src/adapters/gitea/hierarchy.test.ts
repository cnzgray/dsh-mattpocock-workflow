import { describe, expect, it } from 'vitest'

import { GITEA_ISSUES, apiCall, failedApiCall, giteaIssue } from './fixtures.ts'
import { SINCE, trackerWith } from './tracker-test-support.ts'

describe('Gitea 正文约定的父子关系', () => {
  it('没有任何 Part of 行时仍声明正文约定的父子能力', async () => {
    const { tracker } = trackerWith({
      issues: () => apiCall([giteaIssue({ number: 15, title: '平铺的票', body: '## 目标\n' })], 1),
      dependencies: () => apiCall([]),
    })

    const snapshot = await tracker.fetchSnapshot('/workspace')

    expect(snapshot.hierarchy).toBe('convention')
    expect(snapshot.tickets[0]?.parent).toBeUndefined()
  })

  it('父级从列表响应里读出，不额外请求接口', async () => {
    const withParent = trackerWith()
    const withoutParent = trackerWith({
      issues: () =>
        apiCall(
          GITEA_ISSUES.map((issue) => ({ ...issue, body: '' })),
          GITEA_ISSUES.length,
        ),
    })

    const snapshot = await withParent.tracker.fetchSnapshot('/workspace')
    await withoutParent.tracker.fetchSnapshot('/workspace')

    expect(snapshot.tickets.map((ticket) => ticket.parent)).toEqual([undefined, '#15', undefined])
    expect(withParent.calls).toEqual(withoutParent.calls)
  })

  it('增量结果里的变更票保留父级引用', async () => {
    const { tracker } = trackerWith()

    const changes = await tracker.fetchChanges?.('/workspace', SINCE)

    expect(changes?.hierarchy).toBe('convention')
    expect(changes?.tickets.map((ticket) => [ticket.ref, ticket.parent])).toEqual([['#16', '#15']])
  })

  it('同时有父 spec 与 Blocked by 行的票仍按阻塞票判定', async () => {
    const { tracker } = trackerWith({
      issues: () =>
        apiCall(
          [
            giteaIssue({ number: 15, title: '来源 spec' }),
            giteaIssue({ number: 17, title: '前置 ticket', body: 'Part of #15\n' }),
            giteaIssue({
              number: 16,
              title: '后续 ticket',
              body: 'Part of #15\n\nBlocked by: #17\n',
            }),
          ],
          3,
        ),
      dependencies: () => failedApiCall(404, 'Not Found'),
    })

    const snapshot = await tracker.fetchSnapshot('/workspace')

    expect(
      snapshot.tickets.map((ticket) => [ticket.ref, ticket.parent, ticket.openBlockers]),
    ).toEqual([
      ['#15', undefined, 0],
      ['#17', '#15', 0],
      ['#16', '#15', 1],
    ])
  })
})
