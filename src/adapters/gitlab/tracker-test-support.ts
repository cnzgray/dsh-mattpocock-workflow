/**
 * GitLab tracker 测试夹具：录制型命令执行器与 tracker 工厂。
 * 生产代码不导入这个文件；列表与增量两组测试共用同一份 runner，
 * 避免「列表请求怎么回」和「增量请求怎么回」两套假实现分叉。
 */
import type { CommandRunner, Tracker } from '../../core/ticket.ts'
import {
  GITLAB_BLOCKED_BY_OUTPUT,
  GITLAB_CHANGES_OUTPUT,
  GITLAB_ISSUES_OUTPUT,
  GITLAB_LINKS,
  GITLAB_REMOTES_OUTPUT,
  GITLAB_TOTAL_OUTPUT,
} from './fixtures.ts'
import { createGitlabTracker } from './tracker.ts'

export const NOW = 1_700_000_000_000

export interface RunnerOptions {
  readonly git?: () => string
  readonly issues?: (page: number) => string
  /** 带 `updated_after` 的增量查询用这一组输出。 */
  readonly changes?: (page: number) => string
  /** 权威总数查询的 `--include` 输出。 */
  readonly total?: () => string
  readonly links?: (iid: number) => string
  readonly graphql?: () => string
}

export interface RecordedRunner {
  readonly runner: CommandRunner
  readonly calls: readonly (readonly string[])[]
  readonly linkCalls: readonly number[]
  readonly graphqlCalls: readonly string[]
}

export function recordedRunner(options: RunnerOptions = {}): RecordedRunner {
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

    const endpoint = args[1] === '--include' ? (args[2] ?? '') : (args[1] ?? '')
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
    // 权威总数查询：不带时间窗、per_page=1 的列表请求。
    if (endpoint.includes('per_page=1&page=1') && !endpoint.includes('updated_after')) {
      return Promise.resolve({
        stdout: (options.total ?? (() => GITLAB_TOTAL_OUTPUT))(),
        stderr: '',
      })
    }

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

export function trackerWith(
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
