import { describe, expect, it } from 'vitest'

import type { CommandRunner, TicketDetail, Tracker } from '../../core/ticket.ts'
import { CommandError, TrackerError } from '../../core/tracker-error.ts'
import { describeTrackerContract } from '../contract.test-suite.ts'
import {
  GH_ASSIGNEES_OUTPUT,
  GH_CHANGES_OUTPUT,
  GH_ISSUE_DETAIL,
  GH_ISSUES_OUTPUT,
  GH_LABELS_OUTPUT,
  GH_TRUNCATED_CHANGES_OUTPUT,
  GH_VIEWER_PERMISSION_OUTPUT,
  GIT_REMOTES_OUTPUT,
} from './fixtures.ts'
import { createGithubTracker } from './tracker.ts'

const NOW = 1_700_000_000_000
/** 增量窗口起点：2026-11-13T00:00:00Z。 */
const SINCE = Date.parse('2026-11-13T00:00:00Z')

interface RecordedRunner {
  readonly runner: CommandRunner
  readonly calls: readonly (readonly string[])[]
}

function recordedRunner(handlers: {
  readonly git?: () => string | Promise<string>
  readonly gh?: (args: readonly string[]) => string | Promise<string>
}): RecordedRunner {
  const calls: string[][] = []
  const runner: CommandRunner = async (command, args) => {
    calls.push([command, ...args])
    const stdout =
      command === 'git'
        ? await (handlers.git ?? (() => GIT_REMOTES_OUTPUT))()
        : await (handlers.gh ?? (() => GH_ISSUES_OUTPUT))(args)
    return { stdout, stderr: '' }
  }
  return { runner, calls }
}

describe('GitHub 工单后端', () => {
  it('读取 git 远端并用 GraphQL 拉取工单', async () => {
    const { runner, calls } = recordedRunner({})
    const tracker = createGithubTracker({ run: runner, now: () => NOW })

    const snapshot = await tracker.fetchSnapshot('/workspace')

    expect(snapshot.repository).toBe('cnzgray/dsh-mattpocock-workflow')
    expect(snapshot.loaded).toBe(5)
    expect(snapshot.total).toBe(30)
    expect(snapshot.fetchedAt).toBe(NOW)
    expect(calls.map((call) => call[0])).toEqual(['git', 'gh'])
  })

  it('把 owner、name 与上限传给 gh', async () => {
    const seen: string[] = []
    const { runner } = recordedRunner({
      gh: (args) => {
        seen.push(...args)
        return GH_ISSUES_OUTPUT
      },
    })
    const tracker = createGithubTracker({ run: runner, now: () => NOW, limit: 42 })

    await tracker.fetchSnapshot('/workspace')

    expect(seen).toContain('owner=cnzgray')
    expect(seen).toContain('name=dsh-mattpocock-workflow')
    expect(seen).toContain('limit=42')
  })

  it('上限超过 GraphQL 的 100 时收窄到 100', async () => {
    const seen: string[] = []
    const { runner } = recordedRunner({
      gh: (args) => {
        seen.push(...args)
        return GH_ISSUES_OUTPUT
      },
    })
    const tracker = createGithubTracker({ run: runner, now: () => NOW, limit: 500 })

    await tracker.fetchSnapshot('/workspace')

    expect(seen).toContain('limit=100')
  })

  it('优先使用 origin，不回退到其他 GitHub 远端', async () => {
    const { runner } = recordedRunner({
      git: () =>
        [
          'origin\tgit@github.com:cnzgray/dsh-mattpocock-workflow.git (fetch)',
          'upstream\thttps://github.com/someone/other.git (fetch)',
        ].join('\n'),
    })
    const tracker = createGithubTracker({ run: runner, now: () => NOW })

    await expect(tracker.fetchSnapshot('/workspace')).resolves.toMatchObject({
      repository: 'cnzgray/dsh-mattpocock-workflow',
    })
  })

  it('gh 不存在时返回 gh-missing', async () => {
    const { runner } = recordedRunner({
      gh: () => {
        throw new CommandError('not-found', '找不到 gh')
      },
    })
    const tracker = createGithubTracker({ run: runner, now: () => NOW })

    await expect(tracker.fetchSnapshot('/workspace')).rejects.toMatchObject({ code: 'gh-missing' })
  })

  it('gh 未登录时返回 gh-unauthenticated', async () => {
    const { runner } = recordedRunner({
      gh: () => {
        throw new CommandError(
          'failed',
          'gh 退出码 1',
          'To get started with GitHub CLI, please run: gh auth login',
          1,
        )
      },
    })
    const tracker = createGithubTracker({ run: runner, now: () => NOW })

    await expect(tracker.fetchSnapshot('/workspace')).rejects.toMatchObject({
      code: 'gh-unauthenticated',
    })
  })

  it('git 读取失败时返回 fetch-failed', async () => {
    const { runner } = recordedRunner({
      git: () => {
        throw new CommandError('failed', 'git 退出码 128', 'fatal: not a git repository', 128)
      },
    })
    const tracker = createGithubTracker({ run: runner, now: () => NOW })

    await expect(tracker.fetchSnapshot('/workspace')).rejects.toMatchObject({
      code: 'fetch-failed',
    })
  })

  it('origin 不是 GitHub 远端时返回 fetch-failed', async () => {
    const { runner } = recordedRunner({
      git: () => 'origin\tgit@gitlab.com:cnzgray/repo.git (fetch)',
    })
    const tracker = createGithubTracker({ run: runner, now: () => NOW })

    await expect(tracker.fetchSnapshot('/workspace')).rejects.toMatchObject({
      code: 'fetch-failed',
    })
  })

  it('gh 其他失败时返回 fetch-failed', async () => {
    const { runner } = recordedRunner({
      gh: () => {
        throw new CommandError('failed', 'gh 退出码 1', 'HTTP 502: Bad Gateway', 1)
      },
    })
    const tracker = createGithubTracker({ run: runner, now: () => NOW })

    await expect(tracker.fetchSnapshot('/workspace')).rejects.toMatchObject({
      code: 'fetch-failed',
    })
  })

  it('git 其他失败时返回 fetch-failed', async () => {
    const { runner } = recordedRunner({
      git: () => {
        throw new CommandError('failed', 'git 退出码 1', 'permission denied', 1)
      },
    })
    const tracker = createGithubTracker({ run: runner, now: () => NOW })

    await expect(tracker.fetchSnapshot('/workspace')).rejects.toMatchObject({
      code: 'fetch-failed',
    })
  })

  it('GraphQL 输出损坏时返回 TrackerError', async () => {
    const { runner } = recordedRunner({ gh: () => 'not json' })
    const tracker = createGithubTracker({ run: runner, now: () => NOW })

    await expect(tracker.fetchSnapshot('/workspace')).rejects.toBeInstanceOf(TrackerError)
  })
})

const EMPTY_ISSUES_OUTPUT = JSON.stringify({
  data: { repository: { issues: { totalCount: 0, nodes: [] } } },
})

/**
 * 增量用的假 runner：带 `since` 参数的查询回增量夹具，其它回列表夹具。
 * 真实后端按查询里的时间窗口过滤，这里靠夹具区分两条路。
 */
function changesRunner(outputs: { changes?: string; list?: string } = {}): RecordedRunner {
  return recordedRunner({
    gh: (args) => {
      const isChanges = args.some((arg) => arg.startsWith('since='))
      if (isChanges) return outputs.changes ?? GH_CHANGES_OUTPUT
      return outputs.list ?? GH_ISSUES_OUTPUT
    },
  })
}

describe('GitHub 工单增量', () => {
  it('增量查询带上更新时间窗口，过滤条件与列表一致', async () => {
    const { runner, calls } = changesRunner()
    const tracker = createGithubTracker({ run: runner, now: () => NOW })

    await tracker.fetchChanges?.('/workspace', SINCE)

    const ghCall = calls.find((call) => call[0] === 'gh')
    const query = ghCall?.find((arg) => arg.startsWith('query=')) ?? ''
    expect(query).toContain('filterBy: { since: $since }')
    expect(query).toContain('orderBy: { field: UPDATED_AT, direction: DESC }')
    expect(query).toContain('pageInfo { hasNextPage }')
    expect(ghCall).toContain(`since=${new Date(SINCE).toISOString()}`)
  })

  it('返回窗口内变更过的工单与仓库总数', async () => {
    const { runner } = changesRunner()
    const tracker = createGithubTracker({ run: runner, now: () => NOW })

    const changes = await tracker.fetchChanges?.('/workspace', SINCE)

    expect(changes?.tickets.map((ticket) => ticket.ref)).toEqual(['#16', '#12'])
    expect(changes?.truncated).toBe(false)
    expect(changes?.total).toBe(30)
  })

  it('后端还有下一页时标记为截断，宿主据此退回全量重拉', async () => {
    const { runner } = changesRunner({ changes: GH_TRUNCATED_CHANGES_OUTPUT })
    const tracker = createGithubTracker({ run: runner, now: () => NOW })

    const changes = await tracker.fetchChanges?.('/workspace', SINCE)

    expect(changes?.truncated).toBe(true)
  })

  it('列表快照声明窗口上限，宿主合并增量时按它裁剪', async () => {
    const { runner } = recordedRunner({})
    const tracker = createGithubTracker({ run: runner, now: () => NOW, limit: 42 })

    const snapshot = await tracker.fetchSnapshot('/workspace')

    expect(snapshot.windowLimit).toBe(42)
  })
})

interface MutableGithubIssue {
  labels: string[]
  assignees: string[]
  state: 'OPEN' | 'CLOSED'
  /** 删除后详情按编号不存在处理。 */
  deleted?: boolean
  /** `gh repo view --json viewerPermission` 的返回值；默认仓库管理员。 */
  viewerPermission?: string
}

const REPO = 'cnzgray/dsh-mattpocock-workflow'

function detailOutput(issue: MutableGithubIssue): string {
  return JSON.stringify({
    ...GH_ISSUE_DETAIL,
    state: issue.state,
    labels: issue.labels.map((name) => ({ name })),
    assignees: issue.assignees.map((login) => ({ login })),
  })
}

/** 一个会真正落地 `gh issue edit` / `close` / `reopen` 的假后端。 */
function mutableGithubRunner(issue: MutableGithubIssue): {
  readonly runner: CommandRunner
  readonly calls: string[][]
} {
  const calls: string[][] = []
  const runner: CommandRunner = (command, args) => {
    calls.push([command, ...args])
    if (command === 'git') return Promise.resolve({ stdout: GIT_REMOTES_OUTPUT, stderr: '' })

    if (args[0] === 'repo' && args[1] === 'view') {
      return Promise.resolve({
        stdout:
          issue.viewerPermission === undefined
            ? GH_VIEWER_PERMISSION_OUTPUT
            : JSON.stringify({ viewerPermission: issue.viewerPermission }),
        stderr: '',
      })
    }
    if (args[0] === 'label' && args[1] === 'list') {
      return Promise.resolve({ stdout: GH_LABELS_OUTPUT, stderr: '' })
    }
    if (args[0] === 'api' && (args[1] ?? '').endsWith('/assignees')) {
      return Promise.resolve({ stdout: GH_ASSIGNEES_OUTPUT, stderr: '' })
    }
    if (args[0] !== 'issue') {
      return Promise.reject(
        new CommandError('failed', 'unexpected', `unexpected gh ${args.join(' ')}`, 1),
      )
    }
    if (issue.deleted === true) {
      return Promise.reject(
        new CommandError(
          'failed',
          'gh 退出码 1',
          'Could not resolve to an Issue or PullRequest with the number of 15.',
          1,
        ),
      )
    }

    switch (args[1] ?? '') {
      case 'view':
        return Promise.resolve({ stdout: detailOutput(issue), stderr: '' })
      case 'edit':
        applyGithubEdit(issue, args)
        return Promise.resolve({ stdout: '', stderr: '' })
      case 'close':
        issue.state = 'CLOSED'
        return Promise.resolve({ stdout: '', stderr: '' })
      case 'reopen':
        issue.state = 'OPEN'
        return Promise.resolve({ stdout: '', stderr: '' })
      case 'delete':
        issue.deleted = true
        return Promise.resolve({ stdout: '', stderr: '' })
      default:
        return Promise.reject(
          new CommandError('failed', 'unexpected', `unexpected gh ${args.join(' ')}`, 1),
        )
    }
  }
  return { runner, calls }
}

function applyGithubEdit(issue: MutableGithubIssue, args: readonly string[]): void {
  for (let index = 3; index + 1 < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1] ?? ''
    if (flag === '--add-label' && !issue.labels.includes(value)) issue.labels.push(value)
    if (flag === '--remove-label') issue.labels = issue.labels.filter((label) => label !== value)
    if (flag === '--add-assignee' && !issue.assignees.includes(value)) {
      issue.assignees.push(value)
    }
    if (flag === '--remove-assignee') {
      issue.assignees = issue.assignees.filter((login) => login !== value)
    }
  }
}

function mutableTracker(issue: MutableGithubIssue): { tracker: Tracker; calls: string[][] } {
  const recorded = mutableGithubRunner(issue)
  return {
    tracker: createGithubTracker({ run: recorded.runner, now: () => NOW }),
    calls: recorded.calls,
  }
}

describe('GitHub 工单详情与变更', () => {
  it('用一条 gh issue view 读取详情与评论', async () => {
    const { tracker, calls } = mutableTracker({
      labels: ['enhancement', 'ready-for-agent'],
      assignees: ['alice'],
      state: 'OPEN',
    })

    const detail = await tracker.fetchDetail?.('/workspace', { ref: '#15', number: 15 })

    expect(detail).toMatchObject({
      ref: '#15',
      number: 15,
      title: '右侧栏任务面板 MVP',
      state: 'open',
      author: 'dave',
      labels: ['enhancement', 'ready-for-agent'],
      assignees: ['alice'],
      url: `https://github.com/${REPO}/issues/15`,
    })
    expect(detail?.comments.map((comment) => [comment.author, comment.body])).toEqual([
      ['bob', '补充验收标准'],
      ['carol', '上一次失败的原因'],
    ])
    expect(calls[1]?.slice(0, 4)).toEqual(['gh', 'issue', 'view', '15'])
    expect(calls[1]).toContain('--repo')
    expect(calls[1]).toContain(REPO)
  })

  it('标签按增删差异落地，目标集合相同时不发编辑命令', async () => {
    const same = mutableTracker({
      labels: ['enhancement', 'ready-for-agent'],
      assignees: ['alice'],
      state: 'OPEN',
    })

    await same.tracker.updateTicket?.(
      '/workspace',
      { ref: '#15', number: 15 },
      {
        labels: ['enhancement', 'ready-for-agent'],
      },
    )

    expect(same.calls).toHaveLength(2)

    const changed = mutableTracker({
      labels: ['enhancement', 'ready-for-agent'],
      assignees: ['alice'],
      state: 'OPEN',
    })
    await changed.tracker.updateTicket?.(
      '/workspace',
      { ref: '#15', number: 15 },
      {
        labels: ['bug'],
      },
    )

    expect(changed.calls[2]).toEqual([
      'gh',
      'issue',
      'edit',
      '15',
      '--add-label',
      'bug',
      '--remove-label',
      'enhancement',
      '--remove-label',
      'ready-for-agent',
      '--repo',
      REPO,
    ])
  })

  it('分配人用增量增删，分配给我用 @me', async () => {
    const { tracker, calls } = mutableTracker({
      labels: [],
      assignees: ['alice'],
      state: 'OPEN',
    })

    await tracker.updateTicket?.(
      '/workspace',
      { ref: '#15', number: 15 },
      {
        assignees: ['bob'],
        assignSelf: true,
      },
    )

    expect(calls[2]).toEqual([
      'gh',
      'issue',
      'edit',
      '15',
      '--add-assignee',
      'bob',
      '--add-assignee',
      '@me',
      '--remove-assignee',
      'alice',
      '--repo',
      REPO,
    ])
  })

  it('关闭与重开各发一条独立命令，状态没变时不发命令', async () => {
    const closed = mutableTracker({ labels: [], assignees: [], state: 'OPEN' })
    await closed.tracker.updateTicket?.(
      '/workspace',
      { ref: '#15', number: 15 },
      {
        state: 'closed',
      },
    )
    expect(closed.calls[2]).toEqual(['gh', 'issue', 'close', '15', '--repo', REPO])

    const reopened = mutableTracker({ labels: [], assignees: [], state: 'CLOSED' })
    await reopened.tracker.updateTicket?.(
      '/workspace',
      { ref: '#15', number: 15 },
      {
        state: 'open',
      },
    )
    expect(reopened.calls[2]).toEqual(['gh', 'issue', 'reopen', '15', '--repo', REPO])

    const unchanged = mutableTracker({ labels: [], assignees: [], state: 'OPEN' })
    await unchanged.tracker.updateTicket?.(
      '/workspace',
      { ref: '#15', number: 15 },
      {
        state: 'open',
      },
    )
    expect(unchanged.calls).toHaveLength(2)
  })

  it('编号不存在时返回 ticket-not-found', async () => {
    const { runner } = recordedRunner({
      gh: () => {
        throw new CommandError(
          'failed',
          'gh 退出码 1',
          'Could not resolve to an Issue or PullRequest with the number of 99.',
          1,
        )
      },
    })
    const tracker = createGithubTracker({ run: runner, now: () => NOW })

    await expect(
      tracker.fetchDetail?.('/workspace', { ref: '#99', number: 99 }),
    ).rejects.toMatchObject({ code: 'ticket-not-found' })
  })

  it('用 label list 与 assignees 接口读取补全候选', async () => {
    const { tracker, calls } = mutableTracker({
      labels: [],
      assignees: [],
      state: 'OPEN',
    })

    const options = await tracker.fetchOptions?.('/workspace')

    expect(options).toEqual({
      labels: [
        { name: 'bug', color: '#d73a4a', description: "Something isn't working" },
        { name: 'enhancement', color: '#a2eeef', description: null },
        { name: 'needs-triage', color: null, description: '需要分诊' },
      ],
      assignees: [
        { username: 'alice', name: null },
        { username: 'bob', name: null },
        { username: 'carol', name: null },
      ],
    })
    const labelCall = calls.find((call) => call[1] === 'label')
    expect(labelCall).toContain('--limit')
    expect(labelCall).toContain('1000')
    expect(calls.some((call) => call.includes('--paginate') && call.includes('--slurp'))).toBe(true)
  })

  it('只有 ADMIN 权限才能删除工单', async () => {
    const admin = mutableTracker({ labels: [], assignees: [], state: 'OPEN' })
    await expect(admin.tracker.canDeleteTickets?.('/workspace')).resolves.toBe(true)

    const maintainer = mutableTracker({
      labels: [],
      assignees: [],
      state: 'OPEN',
      viewerPermission: 'MAINTAIN',
    })
    await expect(maintainer.tracker.canDeleteTickets?.('/workspace')).resolves.toBe(false)
  })

  it('删除时编号不存在返回 ticket-not-found，没有权限时说明原因', async () => {
    const missing = deleteFailureTracker('HTTP 404: Not Found')
    await expect(
      missing.deleteTicket?.('/workspace', { ref: '#99', number: 99 }),
    ).rejects.toMatchObject({ code: 'ticket-not-found' })

    const forbidden = deleteFailureTracker('HTTP 403: Must have admin rights to Repository.')
    const deletion = forbidden.deleteTicket?.('/workspace', { ref: '#15', number: 15 })
    await expect(deletion).rejects.toMatchObject({ code: 'fetch-failed' })
    await expect(deletion).rejects.toThrow(/权限/)
  })
})

/** 删除命令固定失败，用于验证 404 / 403 的映射。 */
function deleteFailureTracker(stderr: string): Tracker {
  const runner: CommandRunner = (command) => {
    if (command === 'git') return Promise.resolve({ stdout: GIT_REMOTES_OUTPUT, stderr: '' })
    return Promise.reject(new CommandError('failed', 'gh 退出码 1', stderr, 1))
  }
  return createGithubTracker({ run: runner, now: () => NOW })
}

const GH_DETAIL_REQUEST = { ref: '#15', number: 15 }
const GH_DETAIL_EXPECTED: TicketDetail = {
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
  url: `https://github.com/${REPO}/issues/15`,
  createdAt: '2026-11-12T14:11:22Z',
  updatedAt: '2026-11-13T10:00:00Z',
}

describeTrackerContract('GitHub', {
  createTracker: () => createGithubTracker({ run: recordedRunner({}).runner, now: () => NOW }),
  workspaceRoot: '/workspace',
  expected: {
    repository: 'cnzgray/dsh-mattpocock-workflow',
    total: 30,
    refs: ['#15', '#16', '#12', '#9', '#7'],
    fetchedAt: NOW,
  },
  empty: {
    createTracker: () =>
      createGithubTracker({
        run: recordedRunner({ gh: () => EMPTY_ISSUES_OUTPUT }).runner,
        now: () => NOW,
      }),
    repository: 'cnzgray/dsh-mattpocock-workflow',
    fetchedAt: NOW,
  },
  nativeBlockers: { kind: 'snapshot', expected: [0, 1, 0, 0, 2] },
  changes: {
    createTracker: () => createGithubTracker({ run: changesRunner().runner, now: () => NOW }),
    since: SINCE,
    expected: { refs: ['#16', '#12'] },
  },
  detail: {
    createTracker: () =>
      mutableTracker({
        labels: ['enhancement', 'ready-for-agent'],
        assignees: ['alice'],
        state: 'OPEN',
      }).tracker,
    request: GH_DETAIL_REQUEST,
    expected: GH_DETAIL_EXPECTED,
    change: {
      createTracker: () =>
        mutableTracker({
          labels: ['enhancement', 'ready-for-agent'],
          assignees: ['alice'],
          state: 'OPEN',
        }).tracker,
      patch: { labels: ['bug'], state: 'closed' },
      expected: { labels: ['bug'], state: 'closed' },
    },
  },
  options: {
    createTracker: () => mutableTracker({ labels: [], assignees: [], state: 'OPEN' }).tracker,
    expected: {
      labels: [
        { name: 'bug', color: '#d73a4a', description: "Something isn't working" },
        { name: 'enhancement', color: '#a2eeef', description: null },
        { name: 'needs-triage', color: null, description: '需要分诊' },
      ],
      assignees: [
        { username: 'alice', name: null },
        { username: 'bob', name: null },
        { username: 'carol', name: null },
      ],
    },
  },
  delete: {
    createTracker: () => mutableTracker({ labels: [], assignees: [], state: 'OPEN' }).tracker,
    request: GH_DETAIL_REQUEST,
    canDelete: true,
  },
  fields: {
    closedAt: { '#7': '2026-11-02T09:30:00Z' },
    // GitHub 列表查询只给未关闭阻塞数，拿不到依赖边。
    blockedBy: {},
  },
})
