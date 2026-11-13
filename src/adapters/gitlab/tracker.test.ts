import { describe, expect, it } from 'vitest'

import type { CommandRunner, Tracker } from '../../core/ticket.ts'
import { CommandError } from '../../core/tracker-error.ts'
import { describeTrackerContract } from '../contract.test-suite.ts'
import {
  GITLAB_BLOCKED_BY_OUTPUT,
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
  readonly graphql?: () => string
}

interface RecordedRunner {
  readonly runner: CommandRunner
  readonly calls: readonly (readonly string[])[]
  readonly linkCalls: readonly number[]
  readonly graphqlCalls: readonly string[]
}

function recordedRunner(options: RunnerOptions = {}): RecordedRunner {
  const calls: string[][] = []
  const linkCalls: number[] = []
  const graphqlCalls: string[] = []
  const runner: CommandRunner = (command, args) => {
    calls.push([command, ...args])
    if (command === 'git') {
      return Promise.resolve({
        stdout: (options.git ?? (() => GITLAB_REMOTES_OUTPUT))(),
        stderr: '',
      })
    }

    const endpoint = args[1] ?? ''
    if (endpoint === 'graphql') {
      graphqlCalls.push(args.join(' '))
      return Promise.resolve({
        stdout: (options.graphql ?? (() => GITLAB_BLOCKED_BY_OUTPUT))(),
        stderr: '',
      })
    }

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
  return { runner, calls, linkCalls, graphqlCalls }
}

function trackerWith(
  options: RunnerOptions = {},
  blockerCapability?: Map<string, Promise<boolean>>,
): {
  readonly tracker: Tracker
  readonly calls: readonly (readonly string[])[]
  readonly linkCalls: readonly number[]
  readonly graphqlCalls: readonly string[]
} {
  const recorded = recordedRunner(options)
  return {
    tracker: createGitlabTracker({
      run: recorded.runner,
      now: () => NOW,
      ...(blockerCapability === undefined ? {} : { blockerCapability }),
    }),
    calls: recorded.calls,
    linkCalls: recorded.linkCalls,
    graphqlCalls: recorded.graphqlCalls,
  }
}

/** 一张票在正文里写了阻塞关系，用来验证探测目标与描述回退。 */
function describedIssuesJson(): string {
  return issuesJson([
    gitlabIssue({ iid: 15, title: '前置任务' }),
    gitlabIssue({
      iid: 16,
      title: '被阻塞的任务',
      description: 'Blocked by: #15\n',
    }),
    gitlabIssue({ iid: 9, title: '已整理', state: 'closed' }),
  ])
}

/** 模拟宿主的两阶段读取：先列表，再对开放票补齐原生阻塞数。 */
async function listThenResolve(tracker: Tracker): Promise<ReadonlyMap<string, number>> {
  const snapshot = await tracker.fetchSnapshot('/workspace')
  const targets = snapshot.tickets
    .filter((ticket) => ticket.state === 'open')
    .map((ticket) => ({ ref: ticket.ref, number: ticket.number }))
  const native = await tracker.resolveBlockers?.('/workspace', targets)
  if (native === undefined) throw new Error('GitLab 后端应实现 resolveBlockers')
  return native
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

  it('首屏列表不发任何阻塞相关请求，阻塞数先按描述回退', async () => {
    const { tracker, linkCalls, graphqlCalls } = trackerWith({ issues: describedIssuesJson })

    const snapshot = await tracker.fetchSnapshot('/workspace')

    expect(linkCalls).toEqual([])
    expect(graphqlCalls).toEqual([])
    expect(snapshot.tickets.map((ticket) => ticket.openBlockers)).toEqual([0, 1, 0])
  })

  it('列表带 blocking_issues_count 时补齐阶段直接判定支持，不再探测 links', async () => {
    const { tracker, linkCalls, graphqlCalls } = trackerWith({
      issues: () =>
        issuesJson([
          { ...gitlabIssue({ iid: 15, title: '前置任务' }), blocking_issues_count: 0 },
          { ...gitlabIssue({ iid: 16, title: '被阻塞的任务' }), blocking_issues_count: 1 },
        ]),
      links: () => {
        throw new CommandError('failed', 'glab 退出码 1', 'HTTP 500', 1)
      },
    })

    const native = await listThenResolve(tracker)

    expect(linkCalls).toEqual([])
    expect(graphqlCalls).toHaveLength(1)
    expect(native).toEqual(
      new Map([
        ['#15', 0],
        ['#16', 1],
      ]),
    )
  })

  it('补齐阶段只发一次阻塞能力探测，不逐票请求', async () => {
    const { tracker, linkCalls } = trackerWith()

    await listThenResolve(tracker)

    expect(linkCalls).toEqual([15])
  })

  it('能力探测按实例主机缓存，重复刷新不重复探测', async () => {
    const { tracker, linkCalls, graphqlCalls } = trackerWith()

    await listThenResolve(tracker)
    await listThenResolve(tracker)

    expect(linkCalls).toEqual([15])
    expect(graphqlCalls).toHaveLength(2)
  })

  it('多个 tracker 共用能力缓存时，同一主机只探测一次', async () => {
    const blockerCapability = new Map<string, Promise<boolean>>()
    const first = trackerWith({}, blockerCapability)
    const second = trackerWith({}, blockerCapability)

    await listThenResolve(first.tracker)
    await listThenResolve(second.tracker)

    expect(first.linkCalls).toEqual([15])
    expect(second.linkCalls).toEqual([])
    expect(second.graphqlCalls).toHaveLength(1)
  })

  it('原生阻塞数随一次批量查询取回，不再逐票请求 links', async () => {
    const { tracker, graphqlCalls } = trackerWith()

    const native = await listThenResolve(tracker)

    expect(graphqlCalls).toHaveLength(1)
    expect(graphqlCalls[0]).toContain('"15"')
    expect(graphqlCalls[0]).toContain('"16"')
    expect(native.get('#16')).toBe(1)
  })

  it('探测命中 200 + 空数组时不补齐，且不再请求批量计数', async () => {
    const { tracker, linkCalls, graphqlCalls } = trackerWith({
      issues: describedIssuesJson,
      links: () => '[]',
    })

    const native = await listThenResolve(tracker)

    expect(linkCalls).toEqual([16])
    expect(graphqlCalls).toEqual([])
    expect(native.size).toBe(0)
  })

  it.each([
    '403 Forbidden: blocking issues are a Premium feature',
    '404 Not Found: native blocking links are not available',
    'HTTP 502: Bad Gateway',
  ])('探测失败（%s）时不补齐且不重试', async (stderr) => {
    const { tracker, linkCalls, graphqlCalls } = trackerWith({
      issues: describedIssuesJson,
      links: () => {
        throw new CommandError('failed', 'glab 退出码 1', stderr, 1)
      },
    })

    const native = await listThenResolve(tracker)
    await listThenResolve(tracker)

    expect(linkCalls).toEqual([16])
    expect(graphqlCalls).toEqual([])
    expect(native.size).toBe(0)
  })

  it('探测优先选择正文里写了 Blocked by 的开放票', async () => {
    const { tracker, linkCalls } = trackerWith({ issues: describedIssuesJson })

    await listThenResolve(tracker)

    expect(linkCalls).toEqual([16])
  })

  it('没有列表线索时补齐阶段自己读远端并探测第一张票', async () => {
    const { tracker, linkCalls, graphqlCalls } = trackerWith()

    const native = await tracker.resolveBlockers?.('/workspace', [
      { ref: '#15', number: 15 },
      { ref: '#16', number: 16 },
    ])

    expect(linkCalls).toEqual([15])
    expect(graphqlCalls).toHaveLength(1)
    expect(native?.get('#16')).toBe(1)
  })

  it('批量计数失败时抛错，由宿主保留首屏的描述回退', async () => {
    const { tracker, graphqlCalls } = trackerWith({
      issues: describedIssuesJson,
      links: () => JSON.stringify([{ iid: 15, link_type: 'is_blocked_by' }]),
      graphql: () => {
        throw new CommandError('failed', 'glab 退出码 1', 'HTTP 502: Bad Gateway', 1)
      },
    })

    await expect(listThenResolve(tracker)).rejects.toThrow()
    expect(graphqlCalls).toHaveLength(1)
  })

  it('没有开放票时不做能力探测', async () => {
    const { tracker, linkCalls, graphqlCalls } = trackerWith({
      issues: () => issuesJson([gitlabIssue({ iid: 9, title: '已关闭', state: 'closed' })]),
    })

    const native = await listThenResolve(tracker)

    expect(linkCalls).toEqual([])
    expect(graphqlCalls).toEqual([])
    expect(native.size).toBe(0)
  })

  it('只读 issue 接口，不请求 merge request', async () => {
    const { tracker, calls } = trackerWith()

    await tracker.fetchSnapshot('/workspace')

    const glabCalls = calls.filter((call) => call[0] === 'glab')
    expect(glabCalls.length).toBeGreaterThan(0)
    for (const call of glabCalls) {
      const endpoint = call[2] ?? ''
      expect(endpoint).not.toContain('merge_requests')
      if (endpoint === 'graphql') {
        expect(call.slice(3).join(' ')).not.toContain('merge_requests')
      } else {
        expect(endpoint).toMatch(/\/issues(?:\?|\/)/)
      }
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
  nativeBlockers: {
    kind: 'deferred',
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
