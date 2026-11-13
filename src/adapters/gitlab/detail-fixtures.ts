/**
 * GitLab 详情、变更、补全候选与删除的测试夹具：一个会真正落地
 * `glab issue update` / `close` / `reopen` / 删除的假后端，以及详情读写的期望值。
 * 与 `tracker.test.ts` 分开，免得两个测试文件都超出行数上限。
 */
import type { CommandRunner, Tracker } from '../../core/ticket.ts'
import { CommandError } from '../../core/tracker-error.ts'
import {
  GITLAB_LABELS_OUTPUT,
  GITLAB_MEMBERS_OUTPUT,
  GITLAB_NOTES_OUTPUT,
  GITLAB_REMOTES_OUTPUT,
  gitlabIssueDetail,
} from './fixtures.ts'
import { createGitlabTracker } from './tracker.ts'

export const GITLAB_PROJECT = 'cnzgray/platform/dsh-workflow'
export const GITLAB_PROJECT_ENDPOINT = `projects/${encodeURIComponent(GITLAB_PROJECT)}`

export interface MutableGitlabIssue {
  labels: string[]
  assignees: string[]
  state: 'opened' | 'closed'
  /** 删除后详情按 404 处理。 */
  deleted?: boolean
  /** 项目 access_level；默认 Owner（50）。 */
  accessLevel?: number | null
  /** `glab api user` 的 is_admin。 */
  isAdmin?: boolean
}

export function gitlabDetailOutput(issue: MutableGitlabIssue): string {
  return JSON.stringify(
    gitlabIssueDetail({
      iid: 15,
      title: '右侧栏任务面板 MVP',
      state: issue.state,
      labels: issue.labels,
      assignees: issue.assignees,
      description: '## 目标\n\n在面板里看工单。',
    }),
  )
}

/** 一个会真正落地 `glab issue update` / `close` / `reopen` 的假后端。 */
function mutableGitlabRunner(issue: MutableGitlabIssue): {
  readonly runner: CommandRunner
  readonly calls: string[][]
} {
  const calls: string[][] = []
  const runner: CommandRunner = (command, args) => {
    calls.push([command, ...args])
    if (command === 'git') return Promise.resolve({ stdout: GITLAB_REMOTES_OUTPUT, stderr: '' })

    if (args[0] === 'api') {
      if (args[1] === '--method') {
        return Promise.resolve(apiResponse(args[3] ?? '', issue, args[2]))
      }
      return Promise.resolve(apiResponse(args[1] ?? '', issue))
    }

    switch (args[1] ?? '') {
      case 'update':
        applyGitlabUpdate(issue, args)
        return Promise.resolve({ stdout: '', stderr: '' })
      case 'close':
        issue.state = 'closed'
        return Promise.resolve({ stdout: '', stderr: '' })
      case 'reopen':
        issue.state = 'opened'
        return Promise.resolve({ stdout: '', stderr: '' })
      default:
        return Promise.reject(
          new CommandError('failed', 'unexpected', `unexpected glab ${args.join(' ')}`, 1),
        )
    }
  }
  return { runner, calls }
}

function apiResponse(
  endpoint: string,
  issue: MutableGitlabIssue,
  method?: string,
): {
  readonly stdout: string
  readonly stderr: string
} {
  if (method === 'DELETE') {
    issue.deleted = true
    return { stdout: '', stderr: '' }
  }
  if (endpoint === 'user') {
    return {
      stdout: JSON.stringify({ username: 'me', is_admin: issue.isAdmin === true }),
      stderr: '',
    }
  }
  if (endpoint === GITLAB_PROJECT_ENDPOINT) {
    return { stdout: projectOutput(issue), stderr: '' }
  }
  if (endpoint.includes('/labels?')) return { stdout: GITLAB_LABELS_OUTPUT, stderr: '' }
  if (endpoint.includes('/members/all?')) return { stdout: GITLAB_MEMBERS_OUTPUT, stderr: '' }
  if (endpoint.includes('/notes?')) return { stdout: GITLAB_NOTES_OUTPUT, stderr: '' }
  if (endpoint === `${GITLAB_PROJECT_ENDPOINT}/issues/15`) {
    if (issue.deleted === true) {
      throw new CommandError('failed', 'glab 退出码 1', 'glab: 404 Not Found', 1)
    }
    return { stdout: gitlabDetailOutput(issue), stderr: '' }
  }
  throw new CommandError('failed', 'unexpected', `unexpected endpoint ${endpoint}`, 1)
}

function projectOutput(issue: MutableGitlabIssue): string {
  const accessLevel = issue.accessLevel === undefined ? 50 : issue.accessLevel
  return JSON.stringify({
    permissions: {
      project_access: accessLevel === null ? null : { access_level: accessLevel },
      group_access: null,
    },
  })
}

function applyGitlabUpdate(issue: MutableGitlabIssue, args: readonly string[]): void {
  const assignees: string[] = []

  for (let index = 3; index + 1 < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1] ?? ''
    if (flag === '--label') issue.labels = unique([...issue.labels, ...value.split(',')])
    if (flag === '--unlabel') {
      const removed = value.split(',')
      issue.labels = issue.labels.filter((label) => !removed.includes(label))
    }
    if (flag === '--assignee') assignees.push(value)
  }

  if (assignees.length === 0) return
  if (assignees.every((value) => value.startsWith('!'))) {
    const removed = assignees.map((value) => value.slice(1))
    issue.assignees = issue.assignees.filter((login) => !removed.includes(login))
    return
  }
  issue.assignees = unique(assignees.flatMap((value) => value.split(',')))
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

/** 读取详情时用的时钟。 */
export const GITLAB_NOW = 1_700_000_000_000

export function mutableGitlabTracker(issue: MutableGitlabIssue): {
  readonly tracker: Tracker
  readonly calls: string[][]
} {
  const recorded = mutableGitlabRunner(issue)
  return {
    tracker: createGitlabTracker({ run: recorded.runner, now: () => GITLAB_NOW }),
    calls: recorded.calls,
  }
}

/** 删除命令固定失败，用于验证 404 / 403 的映射。 */
export function gitlabDeleteFailureTracker(stderr: string): Tracker {
  const runner: CommandRunner = (command) => {
    if (command === 'git') return Promise.resolve({ stdout: GITLAB_REMOTES_OUTPUT, stderr: '' })
    return Promise.reject(new CommandError('failed', 'glab 退出码 1', stderr, 1))
  }
  return createGitlabTracker({ run: runner, now: () => GITLAB_NOW })
}
