/**
 * Gitea tracker 测试夹具：录制型命令执行器与 tracker 工厂。
 * 生产代码不导入这个文件；列表、增量与父子几组测试共用同一份 runner，
 * 避免多套假实现分叉。
 */
import type { CommandRunner, Tracker } from '../../core/ticket.ts'
import {
  GITEA_CHANGES_OUTPUT,
  GITEA_DEPENDENCIES,
  GITEA_ISSUES_OUTPUT,
  GITEA_REMOTES_OUTPUT,
  GITEA_USER_OUTPUT,
  type RecordedApiCall,
} from './fixtures.ts'
import { createGiteaTracker } from './tracker.ts'

export const NOW = 1_700_000_000_000
/** 增量窗口起点：2026-11-20T00:00:00Z。 */
export const SINCE = Date.parse('2026-11-20T00:00:00Z')

export interface RunnerOptions {
  readonly git?: () => string
  readonly issues?: (page: number) => RecordedApiCall
  /** 带 `since` 的增量查询用这一组输出。 */
  readonly changes?: (page: number) => RecordedApiCall
  readonly dependencies?: (index: number) => RecordedApiCall
  /** `tea api /user` 的输出；返回失败响应模拟身份查询失败。 */
  readonly user?: () => RecordedApiCall
}

export interface RecordedRunner {
  readonly runner: CommandRunner
  readonly calls: readonly (readonly string[])[]
  readonly dependencyCalls: readonly number[]
}

export function recordedRunner(options: RunnerOptions = {}): RecordedRunner {
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
    if (endpoint === '/user') {
      const recorded = (options.user ?? (() => GITEA_USER_OUTPUT))()
      return Promise.resolve({ stdout: recorded.stdout, stderr: recorded.stderr })
    }

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
    const source = endpoint.includes('since=')
      ? (options.changes ?? (() => GITEA_CHANGES_OUTPUT))
      : (options.issues ?? (() => GITEA_ISSUES_OUTPUT))
    const recorded = source(page === null ? 1 : Number.parseInt(page[1] ?? '1', 10))
    return Promise.resolve({ stdout: recorded.stdout, stderr: recorded.stderr })
  }
  return { runner, calls, dependencyCalls }
}

export function trackerWith(options: RunnerOptions = {}): {
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
