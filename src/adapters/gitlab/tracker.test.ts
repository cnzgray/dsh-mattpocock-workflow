import { describe, expect, it } from 'vitest'

import type { CommandRunner, Tracker } from '../../core/ticket.ts'
import { CommandError } from '../../core/tracker-error.ts'
import { describeTrackerContract } from '../contract.test-suite.ts'
import {
  GITLAB_ISSUES,
  GITLAB_ISSUES_OUTPUT,
  GITLAB_LINKS,
  GITLAB_REMOTES_OUTPUT,
  gitlabIssue,
  issuesJson,
} from './fixtures.ts'
import { createGitlabTracker } from './tracker.ts'

const NOW = 1_700_000_000_000

interface RunnerOptions {
  readonly git?: () => string
  readonly issues?: (page: number) => string
  readonly links?: (iid: number) => string
}

interface RecordedRunner {
  readonly runner: CommandRunner
  readonly calls: readonly (readonly string[])[]
  readonly linkCalls: readonly number[]
}

function recordedRunner(options: RunnerOptions = {}): RecordedRunner {
  const calls: string[][] = []
  const linkCalls: number[] = []
  const runner: CommandRunner = (command, args) => {
    calls.push([command, ...args])
    if (command === 'git') {
      return Promise.resolve({
        stdout: (options.git ?? (() => GITLAB_REMOTES_OUTPUT))(),
        stderr: '',
      })
    }

    const endpoint = args[1] ?? ''
    const link = /\/issues\/(\d+)\/links$/.exec(endpoint)
    if (link !== null) {
      const iid = Number.parseInt(link[1] ?? '', 10)
      linkCalls.push(iid)
      return Promise.resolve({
        stdout: (options.links ?? ((id) => GITLAB_LINKS.get(id) ?? '[]'))(iid),
        stderr: '',
      })
    }

    const page = /[?&]page=(\d+)/.exec(endpoint)
    return Promise.resolve({
      stdout: (options.issues ?? (() => GITLAB_ISSUES_OUTPUT))(
        page === null ? 1 : Number.parseInt(page[1] ?? '1', 10),
      ),
      stderr: '',
    })
  }
  return { runner, calls, linkCalls }
}

function trackerWith(options: RunnerOptions = {}): {
  readonly tracker: Tracker
  readonly calls: readonly (readonly string[])[]
  readonly linkCalls: readonly number[]
} {
  const recorded = recordedRunner(options)
  return {
    tracker: createGitlabTracker({ run: recorded.runner, now: () => NOW }),
    calls: recorded.calls,
    linkCalls: recorded.linkCalls,
  }
}

/** 让出一轮事件循环，不依赖真实耗时。 */
function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

describe('GitLab 工单后端', () => {
  it('读取含嵌套 group 的项目路径与工单', async () => {
    const { tracker } = trackerWith()

    const snapshot = await tracker.fetchSnapshot('/workspace')

    expect(snapshot.repository).toBe('cnzgray/platform/dsh-workflow')
    expect(snapshot.loaded).toBe(3)
    expect(snapshot.total).toBe(3)
    expect(snapshot.fetchedAt).toBe(NOW)
    expect(snapshot.tickets.map((ticket) => [ticket.ref, ticket.number, ticket.state])).toEqual([
      ['#15', 15, 'open'],
      ['#16', 16, 'open'],
      ['#9', 9, 'closed'],
    ])
  })

  it('超过一页时按页循环到短页为止', async () => {
    const recorded = recordedRunner({
      issues: (page) =>
        page === 1
          ? issuesJson(GITLAB_ISSUES.slice(0, 2))
          : page === 2
            ? issuesJson(GITLAB_ISSUES.slice(2))
            : '[]',
    })
    const tracker = createGitlabTracker({ run: recorded.runner, now: () => NOW, pageSize: 2 })

    const snapshot = await tracker.fetchSnapshot('/workspace')

    expect(snapshot.tickets.map((ticket) => ticket.ref)).toEqual(['#15', '#16', '#9'])
  })

  it('列表阶段不请求 blocking link，只按描述回退', async () => {
    const { tracker, linkCalls } = trackerWith()

    const snapshot = await tracker.fetchSnapshot('/workspace')

    expect(snapshot.tickets.map((ticket) => ticket.openBlockers)).toEqual([0, 0, 0])
    expect(linkCalls).toEqual([])
  })

  it('补齐阶段按票请求 blocking link，只统计未关闭的票', async () => {
    const { tracker, linkCalls } = trackerWith()

    const blockers = await tracker.resolveBlockers?.('/workspace', [
      { ref: '#15', number: 15 },
      { ref: '#16', number: 16 },
    ])

    expect(new Set(linkCalls)).toEqual(new Set([15, 16]))
    expect(blockers).toEqual(
      new Map([
        ['#15', 0],
        ['#16', 1],
      ]),
    )
  })

  it('描述顶部的 Blocked by 行在列表阶段直接生效', async () => {
    const { tracker, linkCalls } = trackerWith({
      issues: () =>
        issuesJson([
          gitlabIssue({ iid: 15, title: '前置任务', labels: ['ready-for-agent'] }),
          gitlabIssue({
            iid: 16,
            title: '被阻塞的任务',
            labels: ['ready-for-agent'],
            description: '# 被阻塞的任务\n\nBlocked by: #15\n',
          }),
        ]),
    })

    const snapshot = await tracker.fetchSnapshot('/workspace')

    expect(snapshot.tickets.map((ticket) => ticket.openBlockers)).toEqual([0, 1])
    expect(linkCalls).toEqual([])
  })

  it.each([
    '403 Forbidden: blocking issues are a Premium feature',
    '404 Not Found: native blocking links are not available',
    'blocking links are not supported on this instance',
  ])('blocking link 不可用时补齐返回空映射（%s）', async (stderr) => {
    const { tracker } = trackerWith({
      links: () => {
        throw new CommandError('failed', 'glab 退出码 1', stderr, 1)
      },
    })

    const blockers = await tracker.resolveBlockers?.('/workspace', [{ ref: '#15', number: 15 }])

    expect(blockers?.size).toBe(0)
  })

  it('补齐阶段忽略没有编号的票', async () => {
    const { tracker, linkCalls } = trackerWith()

    const blockers = await tracker.resolveBlockers?.('/workspace', [
      { ref: '.scratch/login/issues/01-token.md', number: null },
    ])

    expect(linkCalls).toEqual([])
    expect(blockers?.size).toBe(0)
  })

  it('补齐阶段的其他失败映射成 fetch-failed', async () => {
    const { tracker } = trackerWith({
      links: () => {
        throw new CommandError('failed', 'glab 退出码 1', 'HTTP 502: Bad Gateway', 1)
      },
    })

    await expect(
      tracker.resolveBlockers?.('/workspace', [{ ref: '#15', number: 15 }]),
    ).rejects.toMatchObject({ code: 'fetch-failed' })
  })

  it('补齐阶段并发不超过给定上限', async () => {
    const gates: (() => void)[] = []
    let active = 0
    let maxActive = 0
    const runner: CommandRunner = (command, args) => {
      if (command === 'git') {
        return Promise.resolve({ stdout: GITLAB_REMOTES_OUTPUT, stderr: '' })
      }

      const endpoint = args[1] ?? ''
      if (endpoint.endsWith('/links')) {
        active += 1
        maxActive = Math.max(maxActive, active)
        return new Promise((resolve) => {
          gates.push(() => {
            active -= 1
            resolve({ stdout: '[]', stderr: '' })
          })
        })
      }

      return Promise.resolve({
        stdout: issuesJson([
          gitlabIssue({ iid: 1, title: '一' }),
          gitlabIssue({ iid: 2, title: '二' }),
          gitlabIssue({ iid: 3, title: '三' }),
          gitlabIssue({ iid: 4, title: '四' }),
        ]),
        stderr: '',
      })
    }
    const tracker = createGitlabTracker({ run: runner, now: () => NOW, concurrency: 2 })
    const targets = [1, 2, 3, 4].map((iid) => ({ ref: `#${String(iid)}`, number: iid }))

    const pending = tracker.resolveBlockers?.('/workspace', targets)
    await flush()
    expect(gates).toHaveLength(2)
    gates.shift()?.()
    await flush()
    expect(gates).toHaveLength(2)
    gates.shift()?.()
    await flush()
    expect(gates).toHaveLength(2)
    gates.splice(0).forEach((release) => {
      release()
    })
    await flush()

    const blockers = await pending
    expect(maxActive).toBe(2)
    expect(blockers?.size).toBe(4)
  })

  it('只读 issue 接口，不请求 merge request', async () => {
    const { tracker, calls } = trackerWith()

    await tracker.fetchSnapshot('/workspace')
    await tracker.resolveBlockers?.('/workspace', [{ ref: '#15', number: 15 }])

    const apiCalls = calls.filter((call) => call[0] === 'glab').map((call) => call[2] ?? '')
    expect(apiCalls.length).toBeGreaterThan(0)
    for (const endpoint of apiCalls) {
      expect(endpoint).not.toContain('merge_requests')
      expect(endpoint).toMatch(/\/issues(?:\?|\/)/)
    }
  })

  it('glab 不存在时返回 glab-missing', async () => {
    const { tracker } = trackerWith({
      issues: () => {
        throw new CommandError('not-found', '找不到 glab')
      },
    })

    await expect(tracker.fetchSnapshot('/workspace')).rejects.toMatchObject({
      code: 'glab-missing',
    })
  })

  it('glab 未登录或令牌失效时返回 glab-unauthenticated', async () => {
    const { tracker } = trackerWith({
      issues: () => {
        throw new CommandError(
          'failed',
          'glab 退出码 1',
          '401 Unauthorized: token expired, run glab auth login',
          1,
        )
      },
    })

    await expect(tracker.fetchSnapshot('/workspace')).rejects.toMatchObject({
      code: 'glab-unauthenticated',
    })
  })

  it('其他失败返回 fetch-failed', async () => {
    const { tracker } = trackerWith({
      issues: () => {
        throw new CommandError('failed', 'glab 退出码 1', 'HTTP 502: Bad Gateway', 1)
      },
    })

    await expect(tracker.fetchSnapshot('/workspace')).rejects.toMatchObject({
      code: 'fetch-failed',
    })
  })

  it('工单输出损坏时返回 TrackerError', async () => {
    const { tracker } = trackerWith({ issues: () => 'not json' })

    await expect(tracker.fetchSnapshot('/workspace')).rejects.toMatchObject({
      code: 'fetch-failed',
    })
  })
})

describeTrackerContract('GitLab', {
  createTracker: () => createGitlabTracker({ run: recordedRunner().runner, now: () => NOW }),
  workspaceRoot: '/workspace',
  expected: {
    repository: 'cnzgray/platform/dsh-workflow',
    total: 3,
    refs: ['#15', '#16', '#9'],
    fetchedAt: NOW,
  },
  empty: {
    createTracker: () =>
      createGitlabTracker({
        run: recordedRunner({ issues: () => issuesJson([]) }).runner,
        now: () => NOW,
      }),
    repository: 'cnzgray/platform/dsh-workflow',
    fetchedAt: NOW,
  },
  blockers: {
    request: [
      { ref: '#15', number: 15 },
      { ref: '#16', number: 16 },
    ],
    expected: new Map([
      ['#15', 0],
      ['#16', 1],
    ]),
  },
})
