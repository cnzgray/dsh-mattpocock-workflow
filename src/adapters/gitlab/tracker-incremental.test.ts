import { describe, expect, it } from 'vitest'

import { gitlabIssue, includeOutput, issuesJson } from './fixtures.ts'
import { NOW, recordedRunner, trackerWith } from './tracker-test-support.ts'
import { createGitlabTracker } from './tracker.ts'

/** 增量窗口起点：2026-11-20T00:00:00Z。 */
const SINCE = Date.parse('2026-11-20T00:00:00Z')

describe('GitLab 工单增量', () => {
  it('增量查询带上 updated_after 窗口，其余过滤条件与列表一致', async () => {
    const { tracker, calls } = trackerWith()

    await tracker.fetchChanges?.('/workspace', SINCE)

    const endpoint =
      calls.find((call) => call[0] === 'glab' && (call[2] ?? '').includes('updated_after'))?.[2] ??
      ''
    expect(endpoint).toContain('state=all')
    expect(endpoint).toContain(`updated_after=${new Date(SINCE).toISOString()}`)
    expect(endpoint).toContain('order_by=updated_at')
    expect(endpoint).toContain('sort=asc')
    expect(endpoint).toContain('projects/cnzgray%2Fplatform%2Fdsh-workflow/issues')
  })

  it('另发一次不带时间窗、per_page=1 的请求取权威总数', async () => {
    const { tracker, calls } = trackerWith()

    await tracker.fetchChanges?.('/workspace', SINCE)

    const totalCall = calls.find(
      (call) => call[0] === 'glab' && !(call[3] ?? '').includes('updated_after'),
    )
    expect(totalCall?.[2]).toBe('--include')
    expect(totalCall?.[3]).toContain('state=all')
    expect(totalCall?.[3]).toContain('per_page=1')
    expect(totalCall?.[3]).toContain('page=1')
  })

  it('只取回变更过的票，不做阻塞加工', async () => {
    const { tracker } = trackerWith()

    const changes = await tracker.fetchChanges?.('/workspace', SINCE)

    expect(changes?.tickets.map((ticket) => ticket.ref)).toEqual(['#16'])
    expect(changes?.truncated).toBe(false)
    // 阻塞判定由宿主在合并后统一处理，增量保持原始票字段。
    expect(changes?.tickets[0]?.openBlockers).toBe(0)
    expect(changes?.tickets[0]?.blockedBy).toEqual([])
  })

  it('权威总数不取窗口内的计数', async () => {
    const { tracker } = trackerWith({
      changes: () => '[]',
      total: () => includeOutput(42),
    })

    const changes = await tracker.fetchChanges?.('/workspace', SINCE)

    expect(changes?.tickets).toEqual([])
    expect(changes?.total).toBe(42)
  })

  it('实例没给 X-Total 时按抓取失败处理，不编造总数', async () => {
    const { tracker } = trackerWith({ total: () => includeOutput(undefined) })

    await expect(tracker.fetchChanges?.('/workspace', SINCE)).rejects.toMatchObject({
      code: 'fetch-failed',
    })
  })

  it('增量按页读到短页为止', async () => {
    const recorded = recordedRunner({
      changes: (page) =>
        page === 1
          ? issuesJson([
              gitlabIssue({ iid: 15, title: '前置任务' }),
              gitlabIssue({ iid: 16, title: '被阻塞的任务' }),
            ])
          : issuesJson([gitlabIssue({ iid: 12, title: '又一张票' })]),
    })
    const tracker = createGitlabTracker({ run: recorded.runner, now: () => NOW, pageSize: 2 })

    const changes = await tracker.fetchChanges?.('/workspace', SINCE)

    expect(changes?.tickets.map((ticket) => ticket.ref)).toEqual(['#15', '#16', '#12'])
    expect(changes?.truncated).toBe(false)
  })

  it('整页倍数时探一页空结果确认结束，不误报截断', async () => {
    const recorded = recordedRunner({
      changes: (page) =>
        page <= 2
          ? issuesJson([
              gitlabIssue({ iid: 10 + page * 2, title: '变更一' }),
              gitlabIssue({ iid: 11 + page * 2, title: '变更二' }),
            ])
          : '[]',
    })
    const tracker = createGitlabTracker({
      run: recorded.runner,
      now: () => NOW,
      pageSize: 2,
      incrementalPageLimit: 2,
    })

    const changes = await tracker.fetchChanges?.('/workspace', SINCE)

    expect(changes?.tickets.map((ticket) => ticket.ref)).toEqual(['#12', '#13', '#14', '#15'])
    expect(changes?.truncated).toBe(false)
  })

  it('超过页数上限时标记截断，探到的票不并入结果', async () => {
    const recorded = recordedRunner({
      changes: (page) =>
        issuesJson([
          gitlabIssue({ iid: page * 2, title: '变更一' }),
          gitlabIssue({ iid: page * 2 + 1, title: '变更二' }),
        ]),
    })
    const tracker = createGitlabTracker({
      run: recorded.runner,
      now: () => NOW,
      pageSize: 2,
      incrementalPageLimit: 1,
    })

    const changes = await tracker.fetchChanges?.('/workspace', SINCE)

    expect(changes?.tickets.map((ticket) => ticket.ref)).toEqual(['#2', '#3'])
    expect(changes?.truncated).toBe(true)
  })
})
