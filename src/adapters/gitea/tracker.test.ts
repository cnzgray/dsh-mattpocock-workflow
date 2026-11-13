import { describe, expect, it } from 'vitest'

import type { CommandRunner, Tracker } from '../../core/ticket.ts'
import { CommandError } from '../../core/tracker-error.ts'
import { describeTrackerContract } from '../contract.test-suite.ts'
import {
  GITEA_DEPENDENCIES,
  GITEA_ISSUES,
  GITEA_ISSUES_OUTPUT,
  GITEA_REMOTES_OUTPUT,
  apiCall,
  failedApiCall,
  giteaIssue,
  type RecordedApiCall,
} from './fixtures.ts'
import { createGiteaTracker } from './tracker.ts'

const NOW = 1_700_000_000_000

interface RunnerOptions {
  readonly git?: () => string
  readonly issues?: (page: number) => RecordedApiCall
  readonly dependencies?: (index: number) => RecordedApiCall
}

interface RecordedRunner {
  readonly runner: CommandRunner
  readonly calls: readonly (readonly string[])[]
  readonly dependencyCalls: readonly number[]
}

function recordedRunner(options: RunnerOptions = {}): RecordedRunner {
  const calls: string[][] = []
  const dependencyCalls: number[] = []
  const runner: CommandRunner = (command, args) => {
    calls.push([command, ...args])
    if (command === 'git') {
      return Promise.resolve({
        stdout: (options.git ?? (() => GITEA_REMOTES_OUTPUT))(),
        stderr: '',
      })
    }

    const endpoint = args[2] ?? ''
    const dependency = /\/issues\/(\d+)\/dependencies/.exec(endpoint)
    if (dependency !== null) {
      const index = Number.parseInt(dependency[1] ?? '', 10)
      dependencyCalls.push(index)
      const recorded = (options.dependencies ?? ((value) => GITEA_DEPENDENCIES.get(value)))(index)
      return Promise.resolve({
        stdout: recorded?.stdout ?? '[]',
        stderr: recorded?.stderr ?? '',
      })
    }

    const page = /[?&]page=(\d+)/.exec(endpoint)
    const recorded = (options.issues ?? (() => GITEA_ISSUES_OUTPUT))(
      page === null ? 1 : Number.parseInt(page[1] ?? '1', 10),
    )
    return Promise.resolve({ stdout: recorded.stdout, stderr: recorded.stderr })
  }
  return { runner, calls, dependencyCalls }
}

function trackerWith(options: RunnerOptions = {}): {
  readonly tracker: Tracker
  readonly calls: readonly (readonly string[])[]
  readonly dependencyCalls: readonly number[]
} {
  const recorded = recordedRunner(options)
  return {
    tracker: createGiteaTracker({ run: recorded.runner, now: () => NOW }),
    calls: recorded.calls,
    dependencyCalls: recorded.dependencyCalls,
  }
}

describe('Gitea 工单后端', () => {
  it('读取 owner/name 与工单', async () => {
    const { tracker } = trackerWith()

    const snapshot = await tracker.fetchSnapshot('/workspace')

    expect(snapshot.repository).toBe('cnzgray/dsh-workflow')
    expect(snapshot.loaded).toBe(3)
    expect(snapshot.total).toBe(3)
    expect(snapshot.fetchedAt).toBe(NOW)
    expect(snapshot.tickets.map((ticket) => [ticket.ref, ticket.number, ticket.state])).toEqual([
      ['#15', 15, 'open'],
      ['#16', 16, 'open'],
      ['#9', 9, 'closed'],
    ])
  })

  it('超过一页时按页循环到拿全', async () => {
    const recorded = recordedRunner({
      issues: (page) =>
        page === 1
          ? apiCall(GITEA_ISSUES.slice(0, 2), GITEA_ISSUES.length)
          : page === 2
            ? apiCall(GITEA_ISSUES.slice(2), GITEA_ISSUES.length)
            : apiCall([], GITEA_ISSUES.length),
    })
    const tracker = createGiteaTracker({ run: recorded.runner, now: () => NOW, pageSize: 2 })

    const snapshot = await tracker.fetchSnapshot('/workspace')

    expect(snapshot.tickets.map((ticket) => ticket.ref)).toEqual(['#15', '#16', '#9'])
    expect(snapshot.total).toBe(3)
  })

  it('依赖列表只统计未关闭的票，且只查询开放工单', async () => {
    const { tracker, dependencyCalls } = trackerWith()

    const snapshot = await tracker.fetchSnapshot('/workspace')

    expect(snapshot.tickets.map((ticket) => ticket.openBlockers)).toEqual([0, 1, 0])
    expect(new Set(dependencyCalls)).toEqual(new Set([15, 16]))
  })

  it('依赖接口返回 404 时退回正文顶部的 Blocked by 行', async () => {
    const { tracker } = trackerWith({
      issues: () =>
        apiCall(
          [
            giteaIssue({ number: 15, title: '前置任务', labels: ['ready-for-agent'] }),
            giteaIssue({
              number: 16,
              title: '被阻塞的任务',
              labels: ['ready-for-agent'],
              body: '# 被阻塞的任务\n\nBlocked by: #15, #9, #99\n',
            }),
            giteaIssue({
              number: 9,
              title: '整理术语表',
              state: 'closed',
              labels: ['needs-triage'],
            }),
          ],
          3,
        ),
      dependencies: () => failedApiCall(404, 'Not Found'),
    })

    const snapshot = await tracker.fetchSnapshot('/workspace')

    expect(snapshot.tickets.map((ticket) => ticket.openBlockers)).toEqual([0, 2, 0])
  })

  it('依赖列表为空时仍读正文顶部的 Blocked by 行', async () => {
    const { tracker } = trackerWith({
      issues: () =>
        apiCall(
          [
            giteaIssue({ number: 15, title: '前置任务', labels: ['ready-for-agent'] }),
            giteaIssue({
              number: 16,
              title: '被阻塞的任务',
              labels: ['ready-for-agent'],
              body: 'Blocked by: #15\n',
            }),
          ],
          2,
        ),
      dependencies: () => apiCall([]),
    })

    const snapshot = await tracker.fetchSnapshot('/workspace')

    expect(snapshot.tickets.map((ticket) => ticket.openBlockers)).toEqual([0, 1])
  })

  it('带 pull_request 的条目不会混进工单列表', async () => {
    const { tracker } = trackerWith({
      issues: () =>
        apiCall(
          [
            giteaIssue({ number: 15, title: '真正的工单' }),
            giteaIssue({ number: 21, title: '一个合并请求', pullRequest: true }),
          ],
          1,
        ),
      dependencies: () => apiCall([]),
    })

    const snapshot = await tracker.fetchSnapshot('/workspace')

    expect(snapshot.tickets.map((ticket) => ticket.ref)).toEqual(['#15'])
    expect(snapshot.loaded).toBe(1)
    expect(snapshot.total).toBe(1)
  })

  it('只读 issue 接口，不请求 pull request', async () => {
    const { tracker, calls } = trackerWith()

    await tracker.fetchSnapshot('/workspace')

    const endpoints = calls.filter((call) => call[0] === 'tea').map((call) => call[3] ?? '')
    expect(endpoints.length).toBeGreaterThan(0)
    for (const endpoint of endpoints) {
      expect(endpoint).not.toContain('/pulls')
      expect(endpoint).toContain('/issues')
    }
  })

  it('tea 不存在时返回 tea-missing', async () => {
    const { tracker } = trackerWith({
      issues: () => {
        throw new CommandError('not-found', '找不到 tea')
      },
    })

    await expect(tracker.fetchSnapshot('/workspace')).rejects.toMatchObject({
      code: 'tea-missing',
    })
  })

  it('令牌失效时返回 tea-unauthenticated', async () => {
    const { tracker } = trackerWith({
      issues: () => failedApiCall(401, 'token is expired'),
    })

    await expect(tracker.fetchSnapshot('/workspace')).rejects.toMatchObject({
      code: 'tea-unauthenticated',
    })
  })

  it('依赖接口返回 401 时返回 tea-unauthenticated', async () => {
    const { tracker } = trackerWith({
      dependencies: () => failedApiCall(401, 'token is expired'),
    })

    await expect(tracker.fetchSnapshot('/workspace')).rejects.toMatchObject({
      code: 'tea-unauthenticated',
    })
  })

  it('其他失败返回 fetch-failed', async () => {
    const { tracker } = trackerWith({
      issues: () => failedApiCall(500, 'Internal Server Error'),
    })

    await expect(tracker.fetchSnapshot('/workspace')).rejects.toMatchObject({
      code: 'fetch-failed',
    })
  })

  it('工单输出损坏时返回 TrackerError', async () => {
    const { tracker } = trackerWith({
      issues: () => ({ stdout: 'not json', stderr: '' }),
    })

    await expect(tracker.fetchSnapshot('/workspace')).rejects.toMatchObject({
      code: 'fetch-failed',
    })
  })
})

describeTrackerContract('Gitea', {
  createTracker: () => createGiteaTracker({ run: recordedRunner().runner, now: () => NOW }),
  workspaceRoot: '/workspace',
  expected: {
    repository: 'cnzgray/dsh-workflow',
    total: 3,
    refs: ['#15', '#16', '#9'],
    fetchedAt: NOW,
  },
})
