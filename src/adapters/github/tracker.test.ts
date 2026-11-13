import { describe, expect, it } from 'vitest'

import type { CommandRunner } from '../../core/ticket.ts'
import { CommandError, TrackerError } from '../../core/tracker-error.ts'
import { describeTrackerContract } from '../contract.test-suite.ts'
import { GH_ISSUES_OUTPUT, GIT_REMOTES_OUTPUT } from './fixtures.ts'
import { createGithubTracker } from './tracker.ts'

const NOW = 1_700_000_000_000

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
})
