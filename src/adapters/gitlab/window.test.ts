/**
 * GitLab 列表窗口：首屏只取一页、用 `X-Total` 给出仓库总数，
 * 扩窗时按窗口续取。仓库识别与阻塞补齐在 `tracker.test.ts` 覆盖。
 */
import { describe, expect, it } from 'vitest'

import type { CommandRunner } from '../../core/ticket.ts'
import { GITLAB_ISSUES, GITLAB_REMOTES_OUTPUT, includeOutput, issuesJson } from './fixtures.ts'
import { createGitlabTracker } from './tracker.ts'

const NOW = 1_700_000_000_000

interface RecordedRunner {
  readonly runner: CommandRunner
  readonly calls: readonly (readonly string[])[]
}

/**
 * 只回应列表请求的假 glab：按 `page` 参数回放录制输出。
 * @param issues - 按页码返回的页输出。
 * @returns 假 runner 与调用记录。
 */
function recordedRunner(issues: (page: number) => string): RecordedRunner {
  const calls: string[][] = []
  const runner: CommandRunner = (command, args) => {
    calls.push([command, ...args])
    if (command === 'git') return Promise.resolve({ stdout: GITLAB_REMOTES_OUTPUT, stderr: '' })

    const endpoint = args[args.length - 1] ?? ''
    const page = /[?&]page=(\d+)/.exec(endpoint)
    const pageNumber = page === null ? 1 : Number.parseInt(page[1] ?? '1', 10)
    return Promise.resolve({ stdout: issues(pageNumber), stderr: '' })
  }
  return { runner, calls }
}

describe('GitLab 列表窗口', () => {
  it('窗口只取一页，并用 X-Total 给出仓库总数', async () => {
    const recorded = recordedRunner(() => includeOutput(250, issuesJson(GITLAB_ISSUES.slice(0, 2))))
    const tracker = createGitlabTracker({ run: recorded.runner, now: () => NOW, pageSize: 2 })

    const snapshot = await tracker.fetchSnapshot('/workspace', 2)

    expect(snapshot.loaded).toBe(2)
    expect(snapshot.total).toBe(250)
    expect(snapshot.windowLimit).toBe(2)
    // 身份查询与层级补齐都不占列表翻页的请求数。
    const calls = recorded.calls.filter(
      (call) => call[0] === 'glab' && call[call.length - 1] !== 'user' && !call.includes('graphql'),
    )
    expect(calls).toHaveLength(1)
    const call = calls[0]?.join(' ') ?? ''
    expect(call).toContain('--include')
    expect(call).toContain('order_by=updated_at')
    expect(call).toContain('sort=desc')
  })

  it('窗口覆盖两页时按窗口续取', async () => {
    const recorded = recordedRunner((page) =>
      page === 1
        ? includeOutput(250, issuesJson(GITLAB_ISSUES.slice(0, 2)))
        : issuesJson(GITLAB_ISSUES.slice(2, 3)),
    )
    const tracker = createGitlabTracker({ run: recorded.runner, now: () => NOW, pageSize: 2 })

    const snapshot = await tracker.fetchSnapshot('/workspace', 3)

    expect(snapshot.tickets.map((ticket) => ticket.ref)).toEqual(['#15', '#16', '#9'])
    expect(snapshot.windowLimit).toBe(3)
    expect(snapshot.total).toBe(250)
    // 只有第一页需要响应头，后续页不再带 `--include`。
    const calls = recorded.calls.filter(
      (call) => call[0] === 'glab' && call[call.length - 1] !== 'user' && !call.includes('graphql'),
    )
    expect(calls).toHaveLength(2)
    expect(calls[1]).not.toContain('--include')
  })
})
