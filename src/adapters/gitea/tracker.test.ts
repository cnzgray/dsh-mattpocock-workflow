import { describe, expect, it } from 'vitest'

import type { CommandRunner, TicketDetail, Tracker } from '../../core/ticket.ts'
import { CommandError } from '../../core/tracker-error.ts'
import { describeTrackerContract } from '../contract.test-suite.ts'
import {
  GITEA_ASSIGNEES_OUTPUT,
  GITEA_COMMENTS,
  GITEA_ISSUES,
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
import { NOW, SINCE, recordedRunner, trackerWith } from './tracker-test-support.ts'
import { createGiteaTracker } from './tracker.ts'

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
    expect(snapshot.viewer).toBe('cnzgray')
    expect(snapshot.tickets.map((ticket) => ticket.assignees)).toEqual([['alice'], ['cnzgray'], []])
  })

  it('身份查询失败时列表仍然成功，当前用户为 null', async () => {
    const { tracker } = trackerWith({ user: () => failedApiCall(503, 'unavailable') })

    const snapshot = await tracker.fetchSnapshot('/workspace')

    expect(snapshot.tickets).toHaveLength(3)
    expect(snapshot.viewer).toBeNull()
  })

  it('窗口按更新时间倒序取页，够数就停并给出总数', async () => {
    const recorded = recordedRunner({
      issues: (page) =>
        page === 1
          ? apiCall([giteaIssue({ number: 15, title: '第一页' })], 250)
          : apiCall([giteaIssue({ number: 16, title: '第二页' })], 250),
    })
    const tracker = createGiteaTracker({ run: recorded.runner, now: () => NOW, pageSize: 1 })

    const snapshot = await tracker.fetchSnapshot('/workspace', 2)

    expect(snapshot.tickets.map((ticket) => ticket.ref)).toEqual(['#15', '#16'])
    expect(snapshot.windowLimit).toBe(2)
    expect(snapshot.total).toBe(250)
    // 依赖查询会在列表之后补；列表请求按 page 参数区分。
    const listCalls = recorded.calls.filter((call) => call.some((arg) => arg.includes('/issues?')))
    expect(listCalls).toHaveLength(2)
    expect(listCalls[0]?.join(' ')).toContain('sort=recentupdate')
  })

  it('自建实例的头像按远端协议与端口补成绝对地址', async () => {
    const { tracker } = trackerWith({
      git: () =>
        [
          'origin\thttp://gitea.example.com:3000/cnzgray/dsh-workflow.git (fetch)',
          'origin\thttp://gitea.example.com:3000/cnzgray/dsh-workflow.git (push)',
        ].join('\n'),
    })

    const snapshot = await tracker.fetchSnapshot('/workspace')

    expect(snapshot.tickets[0]?.author?.avatarUrl).toBe('http://gitea.example.com:3000/avatars/1')
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

    const endpoints = calls
      .filter((call) => call[0] === 'tea' && call[3] !== '/user')
      .map((call) => call[3] ?? '')
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

describe('Gitea 工单增量', () => {
  it('增量查询带上 since 窗口，其余过滤条件与列表一致', async () => {
    const { tracker, calls } = trackerWith()

    await tracker.fetchChanges?.('/workspace', SINCE)

    const endpoint =
      calls.find((call) => call[0] === 'tea' && (call[3] ?? '').includes('since='))?.[3] ?? ''
    expect(endpoint).toContain('state=all')
    expect(endpoint).toContain('type=issues')
    expect(endpoint).toContain(`since=${new Date(SINCE).toISOString()}`)
  })

  it('另发一次无时间窗、limit=1 的列表请求取权威总数', async () => {
    const { tracker, calls } = trackerWith()

    await tracker.fetchChanges?.('/workspace', SINCE)

    const totalCall = calls.find(
      (call) =>
        call[0] === 'tea' &&
        (call[3] ?? '').includes('/issues?') &&
        !(call[3] ?? '').includes('since='),
    )
    expect(totalCall?.[3]).toContain('state=all')
    expect(totalCall?.[3]).toContain('type=issues')
    expect(totalCall?.[3]).toContain('limit=1')
    expect(totalCall?.[3]).not.toContain('since=')
  })

  it('增量顺带刷新当前登录用户', async () => {
    const { tracker } = trackerWith()

    const changes = await tracker.fetchChanges?.('/workspace', SINCE)

    expect(changes?.viewer).toBe('cnzgray')
  })

  it('增量身份查询失败时省略当前用户，由宿主沿用基准身份', async () => {
    const { tracker } = trackerWith({ user: () => failedApiCall(503, 'unavailable') })

    const changes = await tracker.fetchChanges?.('/workspace', SINCE)

    expect(changes?.tickets.map((ticket) => ticket.ref)).toEqual(['#16'])
    expect(Object.hasOwn(changes ?? {}, 'viewer')).toBe(false)
  })

  it('返回窗口内变更过的票，并给出它的阻塞数', async () => {
    const { tracker } = trackerWith()

    const changes = await tracker.fetchChanges?.('/workspace', SINCE)

    expect(changes?.tickets.map((ticket) => ticket.ref)).toEqual(['#16'])
    expect(changes?.truncated).toBe(false)
    // Gitea 没有单独的阻塞补齐能力，增量里要自己补齐，
    // 否则合并后这张票会显示成没有阻塞。
    expect(changes?.tickets[0]?.openBlockers).toBe(1)
  })

  it('权威总数不取窗口内的计数', async () => {
    const recorded = recordedRunner({ changes: () => apiCall([], 0) })
    const tracker = createGiteaTracker({ run: recorded.runner, now: () => NOW })

    const changes = await tracker.fetchChanges?.('/workspace', SINCE)

    // 窗口里一张票都没动，但仓库仍有 3 张票。
    expect(changes?.tickets).toEqual([])
    expect(changes?.total).toBe(3)
  })

  it('翻到页数上限还没拿完时标记为截断', async () => {
    const recorded = recordedRunner({
      changes: () => apiCall([giteaIssue({ number: 15, title: '一直有票', state: 'closed' })]),
    })
    const tracker = createGiteaTracker({ run: recorded.runner, now: () => NOW })

    const changes = await tracker.fetchChanges?.('/workspace', SINCE)

    expect(changes?.truncated).toBe(true)
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
  uploadsBaseUrl: null,
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
    viewer: 'cnzgray',
    assignees: { '#15': ['alice'], '#16': ['cnzgray'], '#9': [] },
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
  hierarchy: { kind: 'convention', parents: { '#16': '#15' } },
  changes: {
    createTracker: () => createGiteaTracker({ run: recordedRunner().runner, now: () => NOW }),
    since: SINCE,
    expected: { refs: ['#16'], total: 3, viewer: 'cnzgray' },
  },
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
  fields: {
    closedAt: { '#9': '2026-11-11T10:00:00Z' },
    blockedBy: { '#15': ['#7'], '#16': ['#15', '#7'], '#9': [] },
  },
})
