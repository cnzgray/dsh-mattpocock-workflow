import { describe, expect, it } from 'vitest'

import type { CommandRunner } from '../../core/ticket.ts'
import { CommandError } from '../../core/tracker-error.ts'
import { createGithubEnvProbe } from './env.ts'

const REMOTE = { host: 'github.com', path: 'owner/repo' }

function runner(reply: unknown): { readonly run: CommandRunner; readonly calls: number } {
  const state = { calls: 0 }
  const run: CommandRunner = () => {
    state.calls += 1
    if (reply instanceof Error) return Promise.reject(reply)
    return Promise.resolve(reply as { stdout: string; stderr: string; executable?: string })
  }
  return {
    run,
    get calls() {
      return state.calls
    },
  }
}

describe('GitHub 环境探测', () => {
  it('找到 gh 时把可执行文件路径作为依据', async () => {
    const probe = createGithubEnvProbe({
      run: runner({ stdout: 'gh version 2.62.0', stderr: '', executable: '/opt/homebrew/bin/gh' })
        .run,
    })

    await expect(probe.cli('/repo')).resolves.toEqual({
      status: 'pass',
      detail: '/opt/homebrew/bin/gh',
    })
  })

  it('gh 不存在时失败并给出安装建议的原因', async () => {
    const probe = createGithubEnvProbe({
      run: runner(new CommandError('not-found', '找不到 gh')).run,
    })

    await expect(probe.cli('/repo')).resolves.toEqual({
      status: 'fail',
      detail: '未找到 gh 可执行文件',
      reason: 'cli-missing',
    })
  })

  it('auth status 成功时判定已登录，不返回命令输出', async () => {
    const probe = createGithubEnvProbe({
      run: runner({ stdout: 'Logged in to github.com as someone', stderr: '' }).run,
    })

    await expect(probe.auth('/repo', REMOTE)).resolves.toEqual({ status: 'pass', detail: '已登录' })
  })

  it('其他主机未登录导致非零退出时，仍按当前主机判定已登录', async () => {
    const probe = createGithubEnvProbe({
      run: runner(
        new CommandError(
          'failed',
          'gh 退出码 1',
          'X github.example.com: authentication failed\n  ✓ Logged in to github.com as someone',
        ),
      ).run,
    })

    await expect(probe.auth('/repo', REMOTE)).resolves.toEqual({
      status: 'pass',
      detail: '已登录',
    })
  })

  it('只登录了别的主机时判定未登录当前主机', async () => {
    const probe = createGithubEnvProbe({
      run: runner({ stdout: '  ✓ Logged in to github.example.com as someone', stderr: '' }).run,
    })

    await expect(probe.auth('/repo', REMOTE)).resolves.toEqual({
      status: 'fail',
      detail: '未登录 github.com',
      reason: 'cli-unauthenticated',
    })
  })

  it('令牌失效时判定未登录', async () => {
    const probe = createGithubEnvProbe({
      run: runner(new CommandError('failed', 'gh 退出码 1', 'HTTP 401: Bad credentials')).run,
    })

    await expect(probe.auth('/repo', REMOTE)).resolves.toEqual({
      status: 'fail',
      detail: '未登录或令牌已失效',
      reason: 'cli-unauthenticated',
    })
  })

  it('仓库接口可访问时通过', async () => {
    const probe = createGithubEnvProbe({ run: runner({ stdout: '{}', stderr: '' }).run })

    await expect(probe.repository('/repo', REMOTE)).resolves.toEqual({
      status: 'pass',
      detail: '可访问 owner/repo',
    })
  })

  it('仓库不存在与权限不足分开报告', async () => {
    const missing = createGithubEnvProbe({
      run: runner(new CommandError('failed', 'gh 退出码 1', 'HTTP 404: Not Found')).run,
    })
    const forbidden = createGithubEnvProbe({
      run: runner(new CommandError('failed', 'gh 退出码 1', 'HTTP 403: Forbidden')).run,
    })

    await expect(missing.repository('/repo', REMOTE)).resolves.toMatchObject({
      reason: 'repository-not-found',
    })
    await expect(forbidden.repository('/repo', REMOTE)).resolves.toMatchObject({
      reason: 'repository-forbidden',
    })
  })

  it('网络失败与权限失败区分开', async () => {
    const probe = createGithubEnvProbe({
      run: runner(new CommandError('failed', 'gh 退出码 1', 'dial tcp: i/o timeout')).run,
    })

    await expect(probe.repository('/repo', REMOTE)).resolves.toEqual({
      status: 'fail',
      detail: '网络不可达或请求超时',
      reason: 'repository-network',
    })
  })

  it('远端路径不是 owner/name 时不发请求', async () => {
    const fake = runner({ stdout: '{}', stderr: '' })
    const probe = createGithubEnvProbe({ run: fake.run })

    await expect(
      probe.repository('/repo', { host: 'github.com', path: 'owner' }),
    ).resolves.toMatchObject({ status: 'fail', reason: 'repository-forbidden' })
    expect(fake.calls).toBe(0)
  })
})
