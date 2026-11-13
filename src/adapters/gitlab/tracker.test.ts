import { describe, expect, it } from 'vitest'

import type { BlockerResolution, CommandRunner, TicketDetail, Tracker } from '../../core/ticket.ts'
import { CommandError } from '../../core/tracker-error.ts'
import { describeTrackerContract } from '../contract.test-suite.ts'
import {
  GITLAB_PROJECT_ENDPOINT,
  gitlabDeleteFailureTracker,
  gitlabDetailOutput,
  mutableGitlabTracker,
} from './detail-fixtures.ts'
import {
  GITLAB_BLOCKED_BY_OUTPUT,
  GITLAB_CHANGES_OUTPUT,
  GITLAB_ISSUES,
  GITLAB_ISSUES_OUTPUT,
  GITLAB_LINKS,
  GITLAB_NOTES,
  GITLAB_REMOTES_OUTPUT,
  gitlabIssue,
  issuesJson,
} from './fixtures.ts'
import { createGitlabTracker } from './tracker.ts'

const NOW = 1_700_000_000_000
/** 增量窗口起点：2026-11-20T00:00:00Z。 */
const SINCE = Date.parse('2026-11-20T00:00:00Z')

interface RunnerOptions {
  readonly git?: () => string
  readonly issues?: (page: number) => string
  /** 带 `updated_after` 的增量查询用这一组输出。 */
  readonly changes?: (page: number) => string
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
    const source = endpoint.includes('updated_after')
      ? (options.changes ?? (() => GITLAB_CHANGES_OUTPUT))
      : (options.issues ?? (() => GITLAB_ISSUES_OUTPUT))
    return Promise.resolve({
      stdout: source(page === null ? 1 : Number.parseInt(page[1] ?? '1', 10)),
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
async function listThenResolve(tracker: Tracker): Promise<BlockerResolution> {
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

  it('列表带 blocking_issues_count 时补齐阶段直接判定支持，不发能力探测', async () => {
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

    // 计数走批量查询；阻塞引用要票号，只对真有阻塞的票再读一次 links，
    // 这次请求失败时只丢引用，计数仍然可用。
    expect(linkCalls).toEqual([16])
    expect(graphqlCalls).toHaveLength(1)
    expect(native.open).toEqual(
      new Map([
        ['#15', 0],
        ['#16', 1],
      ]),
    )
    expect(native.blockedBy.size).toBe(0)
  })

  it('补齐阶段只探测一次能力，只对真有阻塞的票读一次 links', async () => {
    const { tracker, linkCalls } = trackerWith()

    await listThenResolve(tracker)

    expect(linkCalls).toEqual([15, 16])
  })

  it('能力探测按实例主机缓存，重复刷新不重复探测', async () => {
    const { tracker, linkCalls, graphqlCalls } = trackerWith()

    await listThenResolve(tracker)
    await listThenResolve(tracker)

    expect(linkCalls).toEqual([15, 16, 16])
    expect(graphqlCalls).toHaveLength(2)
  })

  it('多个 tracker 共用能力缓存时，同一主机只探测一次', async () => {
    const blockerCapability = new Map<string, Promise<boolean>>()
    const first = trackerWith({}, blockerCapability)
    const second = trackerWith({}, blockerCapability)

    await listThenResolve(first.tracker)
    await listThenResolve(second.tracker)

    expect(first.linkCalls).toEqual([15, 16])
    expect(second.linkCalls).toEqual([16])
    expect(second.graphqlCalls).toHaveLength(1)
  })

  it('原生阻塞数随一次批量查询取回，阻塞引用另读一次 links', async () => {
    const { tracker, graphqlCalls } = trackerWith()

    const native = await listThenResolve(tracker)

    expect(graphqlCalls).toHaveLength(1)
    expect(graphqlCalls[0]).toContain('"15"')
    expect(graphqlCalls[0]).toContain('"16"')
    expect(native.open.get('#16')).toBe(1)
    expect(native.blockedBy.get('#16')).toEqual(['#15', '#7'])
  })

  it('探测命中 200 + 空数组时不补齐，且不再请求批量计数', async () => {
    const { tracker, linkCalls, graphqlCalls } = trackerWith({
      issues: describedIssuesJson,
      links: () => '[]',
    })

    const native = await listThenResolve(tracker)

    expect(linkCalls).toEqual([16])
    expect(graphqlCalls).toEqual([])
    expect(native.open.size).toBe(0)
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
    expect(native.open.size).toBe(0)
  })

  it('探测优先选择正文里写了 Blocked by 的开放票', async () => {
    const { tracker, linkCalls } = trackerWith({ issues: describedIssuesJson })

    await listThenResolve(tracker)

    expect(linkCalls).toEqual([16, 16])
  })

  it('没有列表线索时补齐阶段自己读远端并探测第一张票', async () => {
    const { tracker, linkCalls, graphqlCalls } = trackerWith()

    const native = await tracker.resolveBlockers?.('/workspace', [
      { ref: '#15', number: 15 },
      { ref: '#16', number: 16 },
    ])

    expect(linkCalls).toEqual([15, 16])
    expect(graphqlCalls).toHaveLength(1)
    expect(native?.open.get('#16')).toBe(1)
    expect(native?.blockedBy.get('#16')).toEqual(['#15', '#7'])
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
    expect(native.open.size).toBe(0)
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

describe('GitLab 工单增量', () => {
  it('增量查询带上 updated_after 窗口，其余过滤条件与列表一致', async () => {
    const { tracker, calls } = trackerWith()

    await tracker.fetchChanges?.('/workspace', SINCE)

    const endpoint = calls.find((call) => call[0] === 'glab')?.[2] ?? ''
    expect(endpoint).toContain('state=all')
    expect(endpoint).toContain(`updated_after=${new Date(SINCE).toISOString()}`)
    expect(endpoint).toContain('order_by=updated_at')
    expect(endpoint).toContain('sort=asc')
    expect(endpoint).toContain('projects/cnzgray%2Fplatform%2Fdsh-workflow/issues')
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

describe('GitLab 工单详情与变更', () => {
  it('读取 issue 与 notes，跳过 system note 并按时间排序', async () => {
    const { tracker, calls } = mutableGitlabTracker({
      labels: ['enhancement', 'ready-for-agent'],
      assignees: ['alice'],
      state: 'opened',
    })

    const detail = await tracker.fetchDetail?.('/workspace', { ref: '#15', number: 15 })

    expect(detail).toMatchObject({
      ref: '#15',
      number: 15,
      title: '右侧栏任务面板 MVP',
      author: 'dave',
      body: '## 目标\n\n在面板里看工单。',
      labels: ['enhancement', 'ready-for-agent'],
      assignees: ['alice'],
      url: 'https://gitlab.com/cnzgray/platform/dsh-workflow/-/issues/15',
    })
    expect(detail?.comments.map((comment) => [comment.author, comment.body])).toEqual([
      ['bob', '补充验收标准'],
      ['carol', '上一次失败的原因'],
    ])
    expect(calls.filter((call) => call[0] === 'glab').map((call) => call[2])).toEqual([
      'projects/cnzgray%2Fplatform%2Fdsh-workflow/issues/15',
      'projects/cnzgray%2Fplatform%2Fdsh-workflow/issues/15/notes?per_page=100&page=1',
    ])
  })

  it('评论按页拉取，短页即停止', async () => {
    const pages = new Map([
      [1, JSON.stringify(GITLAB_NOTES.slice(0, 2))],
      [2, JSON.stringify(GITLAB_NOTES.slice(2))],
    ])
    const runner: CommandRunner = (command, args) => {
      if (command === 'git') return Promise.resolve({ stdout: GITLAB_REMOTES_OUTPUT, stderr: '' })
      const endpoint = args[1] ?? ''
      if (endpoint === `${GITLAB_PROJECT_ENDPOINT}/issues/15`) {
        return Promise.resolve({
          stdout: gitlabDetailOutput({ labels: [], assignees: [], state: 'opened' }),
          stderr: '',
        })
      }
      const page = /[?&]page=(\d+)/.exec(endpoint)?.[1] ?? '1'
      return Promise.resolve({ stdout: pages.get(Number(page)) ?? '[]', stderr: '' })
    }
    const tracker = createGitlabTracker({ run: runner, now: () => NOW, pageSize: 2 })

    const detail = await tracker.fetchDetail?.('/workspace', { ref: '#15', number: 15 })

    expect(detail?.comments.map((comment) => comment.author)).toEqual(['bob', 'carol'])
  })

  it('标签用 --label / --unlabel 增量落地', async () => {
    const { tracker, calls } = mutableGitlabTracker({
      labels: ['enhancement', 'ready-for-agent'],
      assignees: [],
      state: 'opened',
    })

    await tracker.updateTicket?.('/workspace', { ref: '#15', number: 15 }, { labels: ['bug'] })

    expect(calls.at(-1)).toEqual([
      'glab',
      'issue',
      'update',
      '15',
      '--label',
      'bug',
      '--unlabel',
      'enhancement,ready-for-agent',
    ])
  })

  it('分配人按整体替换给出完整名单', async () => {
    const { tracker, calls } = mutableGitlabTracker({
      labels: [],
      assignees: ['alice'],
      state: 'opened',
    })

    await tracker.updateTicket?.('/workspace', { ref: '#15', number: 15 }, { assignees: ['bob'] })

    expect(calls.at(-1)).toEqual(['glab', 'issue', 'update', '15', '--assignee', 'bob'])
  })

  it('清空分配人时用 ! 前缀逐个移除', async () => {
    const { tracker, calls } = mutableGitlabTracker({
      labels: [],
      assignees: ['alice', 'bob'],
      state: 'opened',
    })

    await tracker.updateTicket?.('/workspace', { ref: '#15', number: 15 }, { assignees: [] })

    expect(calls.at(-1)).toEqual([
      'glab',
      'issue',
      'update',
      '15',
      '--assignee',
      '!alice',
      '--assignee',
      '!bob',
    ])
  })

  it('分配给我先查当前用户再整体替换', async () => {
    const { tracker, calls } = mutableGitlabTracker({
      labels: [],
      assignees: ['alice'],
      state: 'opened',
    })

    await tracker.updateTicket?.('/workspace', { ref: '#15', number: 15 }, { assignSelf: true })

    expect(calls.map((call) => call.slice(0, 3))).toContainEqual(['glab', 'api', 'user'])
    expect(calls.at(-1)).toEqual(['glab', 'issue', 'update', '15', '--assignee', 'alice,me'])
  })

  it('关闭与重开各发一条命令', async () => {
    const closed = mutableGitlabTracker({ labels: [], assignees: [], state: 'opened' })
    await closed.tracker.updateTicket?.(
      '/workspace',
      { ref: '#15', number: 15 },
      {
        state: 'closed',
      },
    )
    expect(closed.calls.at(-1)).toEqual(['glab', 'issue', 'close', '15'])

    const reopened = mutableGitlabTracker({ labels: [], assignees: [], state: 'closed' })
    await reopened.tracker.updateTicket?.(
      '/workspace',
      { ref: '#15', number: 15 },
      {
        state: 'open',
      },
    )
    expect(reopened.calls.at(-1)).toEqual(['glab', 'issue', 'reopen', '15'])
  })

  it('编号不存在时返回 ticket-not-found', async () => {
    const runner: CommandRunner = (command) => {
      if (command === 'git') return Promise.resolve({ stdout: GITLAB_REMOTES_OUTPUT, stderr: '' })
      return Promise.reject(new CommandError('failed', 'glab 退出码 1', 'glab: 404 Not Found', 1))
    }
    const tracker = createGitlabTracker({ run: runner, now: () => NOW })

    await expect(
      tracker.fetchDetail?.('/workspace', { ref: '#99', number: 99 }),
    ).rejects.toMatchObject({ code: 'ticket-not-found' })
  })

  it('用 labels 与 members/all 接口读取补全候选，跳过非 active 成员', async () => {
    const { tracker, calls } = mutableGitlabTracker({
      labels: [],
      assignees: [],
      state: 'opened',
    })

    const options = await tracker.fetchOptions?.('/workspace')

    expect(options).toEqual({
      labels: [
        { name: 'bug', color: '#d73a4a', description: "Something isn't working" },
        { name: 'enhancement', color: '#a2eeef', description: null },
        { name: 'needs-triage', color: null, description: '需要分诊' },
      ],
      assignees: [
        { username: 'alice', name: 'Alice' },
        { username: 'bob', name: 'Bob' },
      ],
    })
    expect(calls.map((call) => call[2])).toContain(
      `${GITLAB_PROJECT_ENDPOINT}/labels?per_page=100&page=1`,
    )
    expect(calls.map((call) => call[2])).toContain(
      `${GITLAB_PROJECT_ENDPOINT}/members/all?per_page=100&page=1`,
    )
  })

  it('项目 Owner 或实例管理员才能删除工单', async () => {
    const owner = mutableGitlabTracker({ labels: [], assignees: [], state: 'opened' })
    await expect(owner.tracker.canDeleteTickets?.('/workspace')).resolves.toBe(true)

    const developer = mutableGitlabTracker({
      labels: [],
      assignees: [],
      state: 'opened',
      accessLevel: 30,
    })
    await expect(developer.tracker.canDeleteTickets?.('/workspace')).resolves.toBe(false)

    const admin = mutableGitlabTracker({
      labels: [],
      assignees: [],
      state: 'opened',
      accessLevel: 30,
      isAdmin: true,
    })
    await expect(admin.tracker.canDeleteTickets?.('/workspace')).resolves.toBe(true)
  })

  it('删除时编号不存在返回 ticket-not-found，没有权限时说明原因', async () => {
    const missing = gitlabDeleteFailureTracker('glab: 404 Not Found')
    await expect(
      missing.deleteTicket?.('/workspace', { ref: '#99', number: 99 }),
    ).rejects.toMatchObject({ code: 'ticket-not-found' })

    const forbidden = gitlabDeleteFailureTracker('HTTP 403: Forbidden')
    const deletion = forbidden.deleteTicket?.('/workspace', { ref: '#15', number: 15 })
    await expect(deletion).rejects.toMatchObject({ code: 'fetch-failed' })
    await expect(deletion).rejects.toThrow(/权限/)
  })
})

const GITLAB_DETAIL_REQUEST = { ref: '#15', number: 15 }
const GITLAB_DETAIL_EXPECTED: TicketDetail = {
  ref: '#15',
  number: 15,
  title: '右侧栏任务面板 MVP',
  state: 'open',
  author: 'dave',
  body: '## 目标\n\n在面板里看工单。',
  labels: ['enhancement', 'ready-for-agent'],
  assignees: ['alice'],
  comments: [
    { author: 'bob', body: '补充验收标准', createdAt: '2026-11-13T09:00:00Z' },
    { author: 'carol', body: '上一次失败的原因', createdAt: '2026-11-13T10:00:00Z' },
  ],
  url: 'https://gitlab.com/cnzgray/platform/dsh-workflow/-/issues/15',
  createdAt: '2026-11-12T14:11:22Z',
  updatedAt: '2026-11-13T10:00:00Z',
}

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
    expected: {
      open: new Map([
        ['#15', 0],
        ['#16', 1],
      ]),
      // 只有真有未关闭阻塞的票才读一次 links，#15 没有阻塞票，没有原生引用。
      blockedBy: new Map([['#16', ['#15', '#7']]]),
    },
  },
  changes: {
    createTracker: () => createGitlabTracker({ run: recordedRunner().runner, now: () => NOW }),
    since: SINCE,
    expected: { refs: ['#16'] },
  },
  fields: {
    closedAt: { '#9': '2026-11-11T10:00:00Z' },
    // 列表阶段只有描述回退；这个 fixture 的描述里没有 Blocked by 行。
    blockedBy: { '#15': [], '#16': [], '#9': [] },
  },
  detail: {
    createTracker: () =>
      mutableGitlabTracker({
        labels: ['enhancement', 'ready-for-agent'],
        assignees: ['alice'],
        state: 'opened',
      }).tracker,
    request: GITLAB_DETAIL_REQUEST,
    expected: GITLAB_DETAIL_EXPECTED,
    change: {
      createTracker: () =>
        mutableGitlabTracker({
          labels: ['enhancement', 'ready-for-agent'],
          assignees: ['alice'],
          state: 'opened',
        }).tracker,
      patch: { labels: ['bug'], state: 'closed' },
      expected: { labels: ['bug'], state: 'closed' },
    },
  },
  options: {
    createTracker: () =>
      mutableGitlabTracker({ labels: [], assignees: [], state: 'opened' }).tracker,
    expected: {
      labels: [
        { name: 'bug', color: '#d73a4a', description: "Something isn't working" },
        { name: 'enhancement', color: '#a2eeef', description: null },
        { name: 'needs-triage', color: null, description: '需要分诊' },
      ],
      assignees: [
        { username: 'alice', name: 'Alice' },
        { username: 'bob', name: 'Bob' },
      ],
    },
  },
  delete: {
    createTracker: () =>
      mutableGitlabTracker({ labels: [], assignees: [], state: 'opened' }).tracker,
    request: GITLAB_DETAIL_REQUEST,
    canDelete: true,
  },
})
