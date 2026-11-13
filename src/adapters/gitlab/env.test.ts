import { describe, expect, it } from 'vitest'

import type { CommandRunner } from '../../core/ticket.ts'
import { CommandError } from '../../core/tracker-error.ts'
import { createGitlabEnvProbe } from './env.ts'

const REMOTE = { host: 'gitlab.example.com', path: 'group/sub/repo' }

function runner(reply: unknown): CommandRunner {
  return () => {
    if (reply instanceof Error) return Promise.reject(reply)
    return Promise.resolve(reply as { stdout: string; stderr: string; executable?: string })
  }
}

describe('GitLab 环境探测', () => {
  it('已登录远端对应的实例时通过', async () => {
    const probe = createGitlabEnvProbe({
      run: runner({ stdout: '✓ Logged in to gitlab.example.com as someone', stderr: '' }),
    })

    await expect(probe.auth('/repo', REMOTE)).resolves.toEqual({
      status: 'pass',
      detail: '已登录 gitlab.example.com',
    })
  })

  it('只登录了别的实例时判定未登录当前实例', async () => {
    const probe = createGitlabEnvProbe({
      run: runner({ stdout: '✓ Logged in to gitlab.com as someone', stderr: '' }),
    })

    await expect(probe.auth('/repo', REMOTE)).resolves.toEqual({
      status: 'fail',
      detail: '未登录 gitlab.example.com',
      reason: 'cli-unauthenticated',
    })
  })

  it('auth status 非零退出但报出已登录主机时仍算通过', async () => {
    const failure = new CommandError(
      'failed',
      'glab 退出码 1',
      '✓ Logged in to gitlab.example.com as someone',
    )
    const probe = createGitlabEnvProbe({ run: runner(failure) })

    await expect(probe.auth('/repo', REMOTE)).resolves.toMatchObject({ status: 'pass' })
  })

  it('嵌套 group 的项目可访问时通过', async () => {
    const probe = createGitlabEnvProbe({ run: runner({ stdout: '{}', stderr: '' }) })

    await expect(probe.repository('/repo', REMOTE)).resolves.toEqual({
      status: 'pass',
      detail: '可访问 group/sub/repo',
    })
  })

  it('网络失败、项目不存在与权限不足分开报告', async () => {
    const network = createGitlabEnvProbe({
      run: runner(new CommandError('failed', 'glab 退出码 1', 'dial tcp: no such host')),
    })
    const missing = createGitlabEnvProbe({
      run: runner(new CommandError('failed', 'glab 退出码 1', 'HTTP 404: Project Not Found')),
    })
    const forbidden = createGitlabEnvProbe({
      run: runner(new CommandError('failed', 'glab 退出码 1', 'HTTP 403: Forbidden')),
    })

    await expect(network.repository('/repo', REMOTE)).resolves.toMatchObject({
      reason: 'repository-network',
    })
    await expect(missing.repository('/repo', REMOTE)).resolves.toMatchObject({
      reason: 'repository-not-found',
    })
    await expect(forbidden.repository('/repo', REMOTE)).resolves.toMatchObject({
      reason: 'repository-forbidden',
    })
  })

  it('glab 不存在时登录与仓库检查都报告缺少命令行工具', async () => {
    const probe = createGitlabEnvProbe({
      run: runner(new CommandError('not-found', '找不到 glab')),
    })

    await expect(probe.auth('/repo', REMOTE)).resolves.toMatchObject({ reason: 'cli-missing' })
    await expect(probe.repository('/repo', REMOTE)).resolves.toMatchObject({
      reason: 'cli-missing',
    })
  })
})
