import { describe, expect, it } from 'vitest'

import { GH_ISSUES_OUTPUT, GIT_REMOTES_OUTPUT } from '../adapters/github/fixtures.ts'
import { GITLAB_ISSUES_OUTPUT, GITLAB_REMOTES_OUTPUT } from '../adapters/gitlab/fixtures.ts'
import type { WorkspaceFiles } from '../adapters/markdown/files.ts'
import type { CommandRunner } from '../core/ticket.ts'
import { CommandError } from '../core/tracker-error.ts'
import { TRACKER_LABELS } from '../protocol/labels.ts'
import type { RpcResult, WorkspaceSnapshot } from '../protocol/tracker.ts'
import { createBackendResolver } from './backend-resolver.ts'
import { createSnapshotService, type SnapshotService } from './snapshot-service.ts'

const NOW = 1_700_000_000_000

interface HostOptions {
  readonly git?: () => string
  readonly auth?: () => string
  readonly gh?: () => string
  readonly issues?: () => string
  readonly links?: () => string
}

interface HostRunner {
  readonly run: CommandRunner
  readonly calls: readonly (readonly string[])[]
}

function hostRunner(options: HostOptions = {}): HostRunner {
  const calls: string[][] = []
  const run: CommandRunner = (command, args) => {
    calls.push([command, ...args])
    if (command === 'git') {
      return Promise.resolve({
        stdout: (options.git ?? (() => GIT_REMOTES_OUTPUT))(),
        stderr: '',
      })
    }
    if (command === 'gh') {
      return Promise.resolve({
        stdout: (options.gh ?? (() => GH_ISSUES_OUTPUT))(),
        stderr: '',
      })
    }

    const endpoint = args[1] ?? ''
    if (args[0] === 'auth') {
      // 真实 glab 把文本报告写在标准错误上。
      return Promise.resolve({
        stdout: '',
        stderr: (options.auth ?? (() => GITLAB_AUTH))(),
      })
    }
    if (endpoint.endsWith('/links')) {
      return Promise.resolve({ stdout: (options.links ?? (() => '[]'))(), stderr: '' })
    }
    return Promise.resolve({
      stdout: (options.issues ?? (() => GITLAB_ISSUES_OUTPUT))(),
      stderr: '',
    })
  }
  return { run, calls }
}

const GITLAB_AUTH = ['gitlab.com', '  ✓ Logged in to gitlab.com as someone (keyring)'].join('\n')

const EMPTY_FILES: WorkspaceFiles = {
  listDirectory: () => Promise.resolve(undefined),
  readTextFile: () => Promise.reject(new Error('没有文件')),
  statFile: () => Promise.reject(new Error('没有文件')),
}

function serviceWith(run: CommandRunner, files: WorkspaceFiles = EMPTY_FILES): SnapshotService {
  return createSnapshotService({
    resolve: createBackendResolver({ run, now: () => NOW, files }),
    now: () => NOW,
    labels: TRACKER_LABELS,
    log: () => undefined,
  })
}

function ok(result: RpcResult<WorkspaceSnapshot>): {
  readonly backend: string
  readonly repository: string
  readonly refs: readonly string[]
} {
  if (!result.ok) throw new Error(result.error.message)
  return {
    backend: result.result.backend,
    repository: result.result.repository,
    refs: result.result.tickets.map((ticket) => ticket.ref),
  }
}

describe('宿主后端选择', () => {
  it('origin 是 github.com 时走 GitHub', async () => {
    const { run } = hostRunner()

    const result = await serviceWith(run).handle('snapshot.get', { workspaceRoot: '/repo' })

    expect(ok(result)).toEqual({
      backend: 'github',
      repository: 'cnzgray/dsh-mattpocock-workflow',
      refs: ['#15', '#16', '#12', '#9', '#7'],
    })
  })

  it('origin 是 gitlab.com 时走 GitLab 并显示完整项目路径', async () => {
    const { run } = hostRunner({ git: () => GITLAB_REMOTES_OUTPUT })

    const result = await serviceWith(run).handle('snapshot.get', { workspaceRoot: '/repo' })

    expect(ok(result)).toEqual({
      backend: 'gitlab',
      repository: 'cnzgray/platform/dsh-workflow',
      refs: ['#15', '#16', '#9'],
    })
  })

  it('自建主机在 glab 已登录列表里时走 GitLab', async () => {
    const { run } = hostRunner({
      git: () => 'origin\tgit@gitlab.example.com:group/sub/repo.git (fetch)',
      auth: () =>
        [
          'gitlab.com',
          '  ✓ Logged in to gitlab.com as someone',
          '  ✓ Logged in to gitlab.example.com as someone',
        ].join('\n'),
    })

    const result = await serviceWith(run).handle('snapshot.get', { workspaceRoot: '/repo' })

    expect(ok(result)).toMatchObject({
      backend: 'gitlab',
      repository: 'group/sub/repo',
    })
  })

  it('自建主机没在 glab 登录时回退本地 Markdown，并在快照里标出 backend', async () => {
    const { run } = hostRunner({
      git: () => 'origin\tgit@gitlab.example.com:group/sub/repo.git (fetch)',
      auth: () => GITLAB_AUTH,
    })

    const result = await serviceWith(run).handle('snapshot.get', { workspaceRoot: '/repo' })

    expect(ok(result)).toEqual({ backend: 'markdown', repository: 'repo', refs: [] })
  })

  it('gitlab.com 但本机没有 glab 时返回 glab-missing，不回退', async () => {
    const { run } = hostRunner({
      git: () => GITLAB_REMOTES_OUTPUT,
      auth: () => {
        throw new CommandError('not-found', '找不到 glab')
      },
    })

    const result = await serviceWith(run).handle('snapshot.get', { workspaceRoot: '/repo' })

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'glab-missing',
        message: expect.stringContaining('安装') as string,
      },
    })
  })

  it('没有 git 命令时走本地 Markdown', async () => {
    const { run } = hostRunner({
      git: () => {
        throw new CommandError('not-found', '找不到 git')
      },
    })

    const result = await serviceWith(run).handle('snapshot.get', { workspaceRoot: '/repo' })

    expect(ok(result).backend).toBe('markdown')
  })

  it('GitLab 认证失败时返回 glab-unauthenticated', async () => {
    const { run } = hostRunner({
      git: () => GITLAB_REMOTES_OUTPUT,
      issues: () => {
        throw new CommandError(
          'failed',
          'glab 退出码 1',
          '401 Unauthorized: token expired, run glab auth login',
          1,
        )
      },
    })

    const result = await serviceWith(run).handle('snapshot.get', { workspaceRoot: '/repo' })

    expect(result).toMatchObject({ ok: false, error: { code: 'glab-unauthenticated' } })
  })

  it('本地 Markdown 读取 .scratch 下的工单', async () => {
    const files = markdownFiles()
    const { run } = hostRunner({
      git: () => {
        throw new CommandError('failed', 'git 退出码 128', 'fatal: not a git repository', 128)
      },
    })

    const result = await serviceWith(run, files).handle('snapshot.get', {
      workspaceRoot: '/ws',
    })

    expect(ok(result)).toEqual({
      backend: 'markdown',
      repository: 'ws',
      refs: ['.scratch/login/issues/01-token.md'],
    })
  })

  it('后端解析结果按工作区缓存，刷新不再探测 glab', async () => {
    const { run, calls } = hostRunner({
      git: () => 'origin\tgit@gitlab.example.com:group/sub/repo.git (fetch)',
      auth: () => '  ✓ Logged in to gitlab.example.com as someone',
    })
    const service = serviceWith(run)

    await service.handle('snapshot.get', { workspaceRoot: '/repo' })
    await service.handle('snapshot.get', { workspaceRoot: '/repo' })
    await service.handle('snapshot.refresh', { workspaceRoot: '/repo' })

    const authCalls = calls.filter((call) => call[0] === 'glab' && call[1] === 'auth')
    expect(authCalls).toHaveLength(1)
  })

  it('解析失败不缓存，装好 glab 后刷新可以恢复', async () => {
    let installed = false
    const { run } = hostRunner({
      git: () => GITLAB_REMOTES_OUTPUT,
      auth: () => {
        if (!installed) throw new CommandError('not-found', '找不到 glab')
        return GITLAB_AUTH
      },
    })
    const service = serviceWith(run)

    const first = await service.handle('snapshot.get', { workspaceRoot: '/repo' })
    expect(first).toMatchObject({ ok: false, error: { code: 'glab-missing' } })

    installed = true
    const second = await service.handle('snapshot.refresh', { workspaceRoot: '/repo' })

    expect(ok(second).backend).toBe('gitlab')
  })

  it('切换工作区后重新选择后端', async () => {
    const { run, calls } = hostRunner({
      git: () => 'origin\tgit@gitlab.example.com:group/sub/repo.git (fetch)',
      auth: () => '  ✓ Logged in to gitlab.example.com as someone',
    })
    const service = serviceWith(run)

    await service.handle('snapshot.get', { workspaceRoot: '/one' })
    await service.handle('snapshot.get', { workspaceRoot: '/two' })

    const authCalls = calls.filter((call) => call[0] === 'glab' && call[1] === 'auth')
    expect(authCalls).toHaveLength(2)
  })

  it('刷新失败时保留上一次成功快照', async () => {
    let calls = 0
    const { run } = hostRunner({
      gh: () => {
        calls += 1
        if (calls > 1) throw new CommandError('failed', 'gh 退出码 1', 'HTTP 502', 1)
        return GH_ISSUES_OUTPUT
      },
    })
    const service = serviceWith(run)

    const first = await service.handle('snapshot.get', { workspaceRoot: '/repo' })
    const failed = await service.handle('snapshot.refresh', { workspaceRoot: '/repo' })
    const again = await service.handle('snapshot.get', { workspaceRoot: '/repo' })

    expect(failed).toMatchObject({ ok: false, error: { code: 'fetch-failed' } })
    expect(again).toEqual(first)
  })
})

function markdownFiles(): WorkspaceFiles {
  const directories: Record<string, readonly string[]> = {
    '/ws/.scratch': ['login/'],
    '/ws/.scratch/login': ['issues/'],
    '/ws/.scratch/login/issues': ['01-token.md'],
  }
  const files: Record<string, string> = {
    '/ws/.scratch/login/issues/01-token.md': '# 令牌刷新\n\nStatus: ready-for-agent\n',
  }

  return {
    listDirectory: (path) => {
      const names = directories[path]
      if (names === undefined) return Promise.resolve(undefined)
      return Promise.resolve(
        names.map((name) => ({
          name: name.replace(/\/$/, ''),
          kind: name.endsWith('/') ? 'directory' : 'file',
        })),
      )
    },
    readTextFile: (path) => {
      const content = files[path]
      return content === undefined
        ? Promise.reject(new Error(`ENOENT: ${path}`))
        : Promise.resolve(content)
    },
    statFile: () => Promise.resolve({ createdAt: NOW, updatedAt: NOW }),
  }
}
