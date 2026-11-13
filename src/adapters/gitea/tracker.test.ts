import { describe, expect, it } from 'vitest'

import type { CommandRunner, TicketDetail, Tracker } from '../../core/ticket.ts'
import { CommandError } from '../../core/tracker-error.ts'
import { describeTrackerContract } from '../contract.test-suite.ts'
import {
  GITEA_ASSIGNEES_OUTPUT,
  GITEA_COMMENTS,
  GITEA_DEPENDENCIES,
  GITEA_ISSUES,
  GITEA_ISSUES_OUTPUT,
  GITEA_LABEL_PAGES,
  GITEA_REMOTES_OUTPUT,
  GITEA_REPO_PERMISSION_OUTPUT,
  apiCall,
  failedApiCall,
  giteaIssue,
  giteaIssueDetail,
  includeHeaders,
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

const GITEA_REPO = 'cnzgray/dsh-workflow'

interface MutableGiteaIssue {
  labels: string[]
  assignees: string[]
  state: 'open' | 'closed'
  /** 删除后详情按 404 处理。 */
  deleted?: boolean
  /** 仓库权限里的 `permissions.admin`；默认是管理员。 */
  admin?: boolean
}

function giteaDetailCall(issue: MutableGiteaIssue): RecordedApiCall {
  return apiCall(
    giteaIssueDetail({
      number: 15,
      title: '右侧栏任务面板 MVP',
      state: issue.state,
      labels: issue.labels,
      assignees: issue.assignees,
      body: '## 目标\n\n在面板里看工单。',
    }),
  )
}

/** 一个会真正落地 `tea issues edit` / `close` / `reopen` 的假后端。 */
function mutableGiteaRunner(issue: MutableGiteaIssue): {
  readonly runner: CommandRunner
  readonly calls: string[][]
} {
  const calls: string[][] = []
  const runner: CommandRunner = (command, args) => {
    calls.push([command, ...args])
    if (command === 'git') return Promise.resolve({ stdout: GITEA_REMOTES_OUTPUT, stderr: '' })
    if (args[0] === 'api') {
      const method = args[2] === '--method' ? args[3] : undefined
      const endpoint = method === undefined ? (args[2] ?? '') : (args[4] ?? '')
      return Promise.resolve(apiResult(endpoint, issue, method))
    }

    if (args[1] === 'edit') {
      applyGiteaEdit(issue, args)
      return Promise.resolve({ stdout: '', stderr: '' })
    }
    if (args[1] === 'close') {
      issue.state = 'closed'
      return Promise.resolve({ stdout: '', stderr: '' })
    }
    if (args[1] === 'reopen') {
      issue.state = 'open'
      return Promise.resolve({ stdout: '', stderr: '' })
    }
    return Promise.reject(
      new CommandError('failed', 'unexpected', `unexpected tea ${args.join(' ')}`, 1),
    )
  }
  return { runner, calls }
}

function apiResult(endpoint: string, issue: MutableGiteaIssue, method?: string): RecordedApiCall {
  if (method === 'DELETE') {
    issue.deleted = true
    return { stdout: '', stderr: includeHeaders({ status: 204 }) }
  }
  if (endpoint === '/user') return apiCall({ login: 'me' })
  if (endpoint === `/repos/${GITEA_REPO}`) {
    return issue.admin === false
      ? apiCall({ permissions: { admin: false } })
      : GITEA_REPO_PERMISSION_OUTPUT
  }

  const labelPage = /\/labels\?[^#]*page=(\d+)/.exec(endpoint)
  if (labelPage !== null) {
    return GITEA_LABEL_PAGES.get(Number(labelPage[1])) ?? apiCall([], 4)
  }
  if (endpoint === `/repos/${GITEA_REPO}/assignees`) return GITEA_ASSIGNEES_OUTPUT

  if (endpoint.includes('/comments?')) return apiCall(GITEA_COMMENTS, GITEA_COMMENTS.length)
  if (endpoint === `/repos/${GITEA_REPO}/issues/15`) {
    if (issue.deleted === true) return failedApiCall(404, 'Not Found')
    return giteaDetailCall(issue)
  }
  throw new CommandError('failed', 'unexpected', `unexpected endpoint ${endpoint}`, 1)
}

function applyGiteaEdit(issue: MutableGiteaIssue, args: readonly string[]): void {
  for (let index = 3; index + 1 < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1] ?? ''
    if (flag === '--add-labels') {
      issue.labels = unique([...issue.labels, ...value.split(',')])
    }
    if (flag === '--remove-labels') {
      const removed = value.split(',')
      issue.labels = issue.labels.filter((label) => !removed.includes(label))
    }
    if (flag === '--set-assignees') {
      issue.assignees = value.split(',').filter((login) => login.length > 0)
    }
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function mutableGiteaTracker(issue: MutableGiteaIssue): {
  readonly tracker: Tracker
  readonly calls: string[][]
} {
  const recorded = mutableGiteaRunner(issue)
  return {
    tracker: createGiteaTracker({ run: recorded.runner, now: () => NOW }),
    calls: recorded.calls,
  }
}

describe('Gitea 工单详情与变更', () => {
  it('读取 issue 与 comments，解析正文、标签、分配人与链接', async () => {
    const { tracker, calls } = mutableGiteaTracker({
      labels: ['enhancement', 'ready-for-agent'],
      assignees: ['alice'],
      state: 'open',
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
      url: `https://gitea.example.com/${GITEA_REPO}/issues/15`,
    })
    expect(detail?.comments.map((comment) => [comment.author, comment.body])).toEqual([
      ['bob', '补充验收标准'],
      ['carol', '上一次失败的原因'],
    ])
    expect(calls.filter((call) => call[0] === 'tea').map((call) => call[3])).toEqual([
      `/repos/${GITEA_REPO}/issues/15`,
      `/repos/${GITEA_REPO}/issues/15/comments?page=1&limit=50`,
    ])
  })

  it('评论按页拉到短页为止', async () => {
    const pages = new Map([
      [1, GITEA_COMMENTS.slice(0, 2)],
      [2, GITEA_COMMENTS.slice(2)],
    ])
    const runner: CommandRunner = (command, args) => {
      if (command === 'git') return Promise.resolve({ stdout: GITEA_REMOTES_OUTPUT, stderr: '' })
      const endpoint = args[2] ?? ''
      if (endpoint === `/repos/${GITEA_REPO}/issues/15`) {
        return Promise.resolve(giteaDetailCall({ labels: [], assignees: [], state: 'open' }))
      }
      const page = Number(/[?&]page=(\d+)/.exec(endpoint)?.[1] ?? '1')
      return Promise.resolve(apiCall(pages.get(page) ?? [], pages.size))
    }
    const tracker = createGiteaTracker({ run: runner, now: () => NOW, pageSize: 2 })

    const detail = await tracker.fetchDetail?.('/workspace', { ref: '#15', number: 15 })

    expect(detail?.comments.map((comment) => comment.author)).toEqual(['bob', 'carol'])
  })

  it('标签用 --add-labels / --remove-labels 增量落地', async () => {
    const { tracker, calls } = mutableGiteaTracker({
      labels: ['enhancement', 'ready-for-agent'],
      assignees: [],
      state: 'open',
    })

    await tracker.updateTicket?.('/workspace', { ref: '#15', number: 15 }, { labels: ['bug'] })

    expect(calls.at(-1)).toEqual([
      'tea',
      'issues',
      'edit',
      '15',
      '--add-labels',
      'bug',
      '--remove-labels',
      'enhancement,ready-for-agent',
    ])
  })

  it('分配人用整体替换语义的 --set-assignees，清空时传空串', async () => {
    const replaced = mutableGiteaTracker({ labels: [], assignees: ['alice'], state: 'open' })
    await replaced.tracker.updateTicket?.(
      '/workspace',
      { ref: '#15', number: 15 },
      {
        assignees: ['bob'],
      },
    )
    expect(replaced.calls.at(-1)).toEqual(['tea', 'issues', 'edit', '15', '--set-assignees', 'bob'])

    const cleared = mutableGiteaTracker({ labels: [], assignees: ['alice'], state: 'open' })
    await cleared.tracker.updateTicket?.(
      '/workspace',
      { ref: '#15', number: 15 },
      {
        assignees: [],
      },
    )
    expect(cleared.calls.at(-1)).toEqual(['tea', 'issues', 'edit', '15', '--set-assignees', ''])
  })

  it('分配给我先查当前用户再整体替换', async () => {
    const { tracker, calls } = mutableGiteaTracker({
      labels: [],
      assignees: ['alice'],
      state: 'open',
    })

    await tracker.updateTicket?.('/workspace', { ref: '#15', number: 15 }, { assignSelf: true })

    expect(calls.filter((call) => call[0] === 'tea').map((call) => call[3])).toContain('/user')
    expect(calls.at(-1)).toEqual(['tea', 'issues', 'edit', '15', '--set-assignees', 'alice,me'])
  })

  it('关闭与重开各发一条命令', async () => {
    const closed = mutableGiteaTracker({ labels: [], assignees: [], state: 'open' })
    await closed.tracker.updateTicket?.(
      '/workspace',
      { ref: '#15', number: 15 },
      {
        state: 'closed',
      },
    )
    expect(closed.calls.at(-1)).toEqual(['tea', 'issues', 'close', '15'])

    const reopened = mutableGiteaTracker({ labels: [], assignees: [], state: 'closed' })
    await reopened.tracker.updateTicket?.(
      '/workspace',
      { ref: '#15', number: 15 },
      {
        state: 'open',
      },
    )
    expect(reopened.calls.at(-1)).toEqual(['tea', 'issues', 'reopen', '15'])
  })

  it('接口返回 404 时返回 ticket-not-found', async () => {
    const runner: CommandRunner = (command) => {
      if (command === 'git') return Promise.resolve({ stdout: GITEA_REMOTES_OUTPUT, stderr: '' })
      return Promise.resolve(failedApiCall(404, 'Not Found'))
    }
    const tracker = createGiteaTracker({ run: runner, now: () => NOW })

    await expect(
      tracker.fetchDetail?.('/workspace', { ref: '#99', number: 99 }),
    ).rejects.toMatchObject({ code: 'ticket-not-found' })
  })

  it('标签分页读取，assignees 提供显示名，重复项只留第一次', async () => {
    const { tracker, calls } = mutableGiteaTracker({
      labels: [],
      assignees: [],
      state: 'open',
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
        { username: 'bob', name: null },
      ],
    })
    const endpoints = calls.filter((call) => call[0] === 'tea').map((call) => call[3] ?? '')
    expect(endpoints).toContain(`/repos/${GITEA_REPO}/labels?limit=50&page=1`)
    expect(endpoints).toContain(`/repos/${GITEA_REPO}/labels?limit=50&page=2`)
    expect(endpoints).toContain(`/repos/${GITEA_REPO}/assignees`)
  })

  it('仓库管理员才能删除工单', async () => {
    const admin = mutableGiteaTracker({ labels: [], assignees: [], state: 'open' })
    await expect(admin.tracker.canDeleteTickets?.('/workspace')).resolves.toBe(true)

    const member = mutableGiteaTracker({
      labels: [],
      assignees: [],
      state: 'open',
      admin: false,
    })
    await expect(member.tracker.canDeleteTickets?.('/workspace')).resolves.toBe(false)
  })

  it('删除时 404 返回 ticket-not-found，403 说明没有权限', async () => {
    await expect(
      giteaDeleteFailureTracker(404).deleteTicket?.('/workspace', { ref: '#99', number: 99 }),
    ).rejects.toMatchObject({ code: 'ticket-not-found' })

    const deletion = giteaDeleteFailureTracker(403).deleteTicket?.('/workspace', {
      ref: '#15',
      number: 15,
    })
    await expect(deletion).rejects.toMatchObject({ code: 'fetch-failed' })
    await expect(deletion).rejects.toThrow(/权限/)
  })
})

/** 删除请求固定返回给定状态码，用于验证 404 / 403 的映射。 */
function giteaDeleteFailureTracker(status: number): Tracker {
  const runner: CommandRunner = (command) => {
    if (command === 'git') return Promise.resolve({ stdout: GITEA_REMOTES_OUTPUT, stderr: '' })
    return Promise.resolve(failedApiCall(status, 'failed'))
  }
  return createGiteaTracker({ run: runner, now: () => NOW })
}

const GITEA_DETAIL_REQUEST = { ref: '#15', number: 15 }
const GITEA_DETAIL_EXPECTED: TicketDetail = {
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
  url: `https://gitea.example.com/${GITEA_REPO}/issues/15`,
  createdAt: '2026-11-12T14:11:22Z',
  updatedAt: '2026-11-13T10:00:00Z',
}

describeTrackerContract('Gitea', {
  createTracker: () => createGiteaTracker({ run: recordedRunner().runner, now: () => NOW }),
  workspaceRoot: '/workspace',
  expected: {
    repository: 'cnzgray/dsh-workflow',
    total: 3,
    refs: ['#15', '#16', '#9'],
    fetchedAt: NOW,
  },
  empty: {
    createTracker: () =>
      createGiteaTracker({
        run: recordedRunner({ issues: () => apiCall([], 0) }).runner,
        now: () => NOW,
      }),
    repository: 'cnzgray/dsh-workflow',
    fetchedAt: NOW,
  },
  nativeBlockers: { kind: 'snapshot', expected: [0, 1, 0] },
  detail: {
    createTracker: () =>
      mutableGiteaTracker({
        labels: ['enhancement', 'ready-for-agent'],
        assignees: ['alice'],
        state: 'open',
      }).tracker,
    request: GITEA_DETAIL_REQUEST,
    expected: GITEA_DETAIL_EXPECTED,
    change: {
      createTracker: () =>
        mutableGiteaTracker({
          labels: ['enhancement', 'ready-for-agent'],
          assignees: ['alice'],
          state: 'open',
        }).tracker,
      patch: { labels: ['bug'], state: 'closed' },
      expected: { labels: ['bug'], state: 'closed' },
    },
  },
  options: {
    createTracker: () => mutableGiteaTracker({ labels: [], assignees: [], state: 'open' }).tracker,
    expected: {
      labels: [
        { name: 'bug', color: '#d73a4a', description: "Something isn't working" },
        { name: 'enhancement', color: '#a2eeef', description: null },
        { name: 'needs-triage', color: null, description: '需要分诊' },
      ],
      assignees: [
        { username: 'alice', name: 'Alice' },
        { username: 'bob', name: null },
      ],
    },
  },
  delete: {
    createTracker: () => mutableGiteaTracker({ labels: [], assignees: [], state: 'open' }).tracker,
    request: GITEA_DETAIL_REQUEST,
    canDelete: true,
  },
})
