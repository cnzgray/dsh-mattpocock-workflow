import { describe, expect, it } from 'vitest'

import { createGiteaEnvProbe } from '../adapters/gitea/env.ts'
import {
  GITEA_LOGINS_OUTPUT,
  GITEA_REMOTES_OUTPUT,
  failedApiCall,
} from '../adapters/gitea/fixtures.ts'
import type { CommandRunner } from '../core/ticket.ts'
import { CommandError } from '../core/tracker-error.ts'
import { createBackendResolver } from './backend-resolver.ts'
import { CATALOG, ROOT, fakeProbe, harness, item, report } from './env-check-test-support.ts'

describe('环境检查的 Gitea 探测', () => {
  it('Gitea 后端调用 tea 探测三项，subject 是 Gitea', async () => {
    const github = fakeProbe('github', {})
    const gitlab = fakeProbe('gitlab', {})
    const gitea = fakeProbe('gitea', {
      cli: { status: 'pass', detail: '/opt/homebrew/bin/tea' },
      auth: { status: 'pass', detail: '已登录 gitea.example.com' },
      repository: { status: 'pass', detail: '可访问 owner/repo' },
    })
    const { service } = harness({ kind: 'gitea', source: 'tea-auth', github, gitlab, gitea })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(result.backend).toBe('gitea')
    expect(item(result.items, 'backend', null).detail).toBe('tea-auth:gitea（gitea.example.com）')
    expect(github.calls).toEqual([])
    expect(gitlab.calls).toEqual([])
    expect(item(result.items, 'cli', 'gitea').detail).toBe('/opt/homebrew/bin/tea')
    expect(item(result.items, 'auth', 'gitea')).toMatchObject({
      status: 'pass',
      detail: '已登录 gitea.example.com',
    })
    expect(item(result.items, 'repository', 'gitea')).toMatchObject({
      status: 'pass',
      detail: '可访问 owner/repo',
    })
  })

  it('tea 没装时判定项点名 Gitea 并给出安装建议，三项跳过指向判定项', async () => {
    const gitea = fakeProbe('gitea', {})
    const { service } = harness({
      kind: 'markdown',
      source: 'unsupported-remote',
      gitea,
      candidate: {
        kind: 'gitea',
        reason: 'cli-missing',
        detail: '未找到 tea，远端 gitea.example.com 需要 tea 才能识别为 Gitea',
      },
    })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(item(result.items, 'backend', 'gitea')).toMatchObject({
      status: 'fail',
      detail: '未找到 tea，远端 gitea.example.com 需要 tea 才能识别为 Gitea',
    })
    expect(item(result.items, 'backend', 'gitea').remedy).toEqual({
      code: 'install-cli',
      subject: 'gitea',
    })
    for (const id of ['cli', 'auth', 'repository'] as const) {
      expect(item(result.items, id, 'gitea')).toMatchObject({
        status: 'skipped',
        blockedBy: { id: 'backend', subject: 'gitea' },
      })
    }
    expect(gitea.calls).toEqual([])
  })

  it('tea 装了但没登录实例时判定项建议登录', async () => {
    const { service } = harness({
      kind: 'markdown',
      source: 'unsupported-remote',
      candidate: {
        kind: 'gitea',
        reason: 'cli-unauthenticated',
        detail: 'tea 未登录 gitea.example.com',
      },
    })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(item(result.items, 'backend', 'gitea')).toMatchObject({ status: 'fail' })
    expect(item(result.items, 'backend', 'gitea').remedy).toEqual({
      code: 'login-cli',
      subject: 'gitea',
    })
    expect(item(result.items, 'auth', 'gitea')).toMatchObject({
      status: 'skipped',
      blockedBy: { id: 'backend', subject: 'gitea' },
    })
  })

  it('真实解析器把没装 tea 的自建远端判成 Gitea 候选（主接缝端到端）', async () => {
    const run: CommandRunner = (command) => {
      if (command === 'git') return Promise.resolve({ stdout: GITEA_REMOTES_OUTPUT, stderr: '' })
      throw new CommandError('not-found', `找不到 ${command}`)
    }
    const { service } = harness({
      resolve: createBackendResolver({ run, now: () => 1, cache: false }),
    })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(result.backend).toBeNull()
    expect(item(result.items, 'backend', 'gitea')).toMatchObject({ status: 'fail' })
    expect(item(result.items, 'backend', 'gitea').remedy).toEqual({
      code: 'install-cli',
      subject: 'gitea',
    })
    expect(item(result.items, 'cli', 'gitea').status).toBe('skipped')
  })

  it('真实解析器认出 tea 已登录的实例时走 Gitea 并探测三项', async () => {
    const run: CommandRunner = (command) => {
      if (command === 'git') return Promise.resolve({ stdout: GITEA_REMOTES_OUTPUT, stderr: '' })
      if (command === 'tea') {
        return Promise.resolve({ stdout: GITEA_LOGINS_OUTPUT, stderr: '' })
      }
      throw new CommandError('not-found', `找不到 ${command}`)
    }
    const gitea = fakeProbe('gitea', {})
    const { service } = harness({
      resolve: createBackendResolver({ run, now: () => 1, cache: false }),
      gitea,
    })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(result.backend).toBe('gitea')
    expect(item(result.items, 'cli', 'gitea').status).toBe('pass')
  })

  it('同一主机同时在 glab 与 tea 登录时，后端标记与工单列表一致', async () => {
    const run: CommandRunner = (command) => {
      if (command === 'git') return Promise.resolve({ stdout: GITEA_REMOTES_OUTPUT, stderr: '' })
      if (command === 'glab') {
        return Promise.resolve({
          stdout: '',
          stderr: '  ✓ Logged in to gitea.example.com as someone',
        })
      }
      if (command === 'tea') {
        return Promise.resolve({ stdout: GITEA_LOGINS_OUTPUT, stderr: '' })
      }
      throw new CommandError('not-found', `找不到 ${command}`)
    }
    const gitlab = fakeProbe('gitlab', {})
    const { service } = harness({
      resolve: createBackendResolver({ run, now: () => 1, cache: false }),
      gitlab,
    })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(result.backend).toBe('gitlab')
  })

  it('Gitea 仓库 404、403 与网络失败给出不同建议', async () => {
    const cases = [
      ['check-remote-address', () => Promise.resolve(failedApiCall(404, 'not found'))],
      ['check-repository-access', () => Promise.resolve(failedApiCall(403, 'forbidden'))],
      [
        'check-network',
        () =>
          Promise.reject(
            new CommandError('failed', 'tea 退出码 1', 'dial tcp: connection refused', 1),
          ),
      ],
    ] as const

    for (const [code, reply] of cases) {
      const run: CommandRunner = (command, args) => {
        if (command !== 'tea') throw new CommandError('not-found', `找不到 ${command}`)
        if (args[0] === '--version') {
          return Promise.resolve({ stdout: '', stderr: '', executable: '/opt/homebrew/bin/tea' })
        }
        if (args[0] === 'logins') {
          return Promise.resolve({ stdout: GITEA_LOGINS_OUTPUT, stderr: '' })
        }
        return reply()
      }
      const gitea = createGiteaEnvProbe({ run })
      const { service } = harness({ kind: 'gitea', source: 'tea-auth', gitea })

      const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))
      const entry = item(result.items, 'repository', 'gitea')
      expect(entry.status).toBe('fail')
      expect(entry.remedy).toEqual({ code, subject: null })
    }
  })

  it('Gitea 令牌失效时三项仍照常呈现，建议重新登录', async () => {
    const gitea = fakeProbe('gitea', {
      auth: { status: 'fail', detail: '未登录 gitea.example.com', reason: 'cli-unauthenticated' },
    })
    const { service } = harness({ kind: 'gitea', source: 'tea-auth', gitea })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(item(result.items, 'auth', 'gitea')).toMatchObject({ status: 'fail' })
    expect(item(result.items, 'auth', 'gitea').remedy).toEqual({
      code: 'login-cli',
      subject: 'gitea',
    })
    expect(item(result.items, 'repository', 'gitea')).toMatchObject({
      status: 'skipped',
      blockedBy: { id: 'auth', subject: 'gitea' },
    })
  })

  it('Gitea 探测的原始输出（含令牌与认证头）不进入报告与日志', async () => {
    const SECRET = 'SECRET-TOKEN'
    const run: CommandRunner = (command, args) => {
      if (command !== 'tea') throw new CommandError('not-found', `找不到 ${command}`)
      if (args[0] === '--version') {
        return Promise.resolve({ stdout: '', stderr: '', executable: '/opt/homebrew/bin/tea' })
      }
      if (args[0] === 'logins') {
        return Promise.resolve({
          stdout: JSON.stringify([
            { name: 'gitea', url: 'https://gitea.example.com', token: SECRET },
          ]),
          stderr: `Authorization: token ${SECRET}`,
        })
      }
      return Promise.resolve({
        stdout: '',
        stderr: `HTTP/2.0 403 Forbidden\nAuthorization: token ${SECRET}\n`,
      })
    }
    const gitea = createGiteaEnvProbe({ run })
    const { service, logs } = harness({ kind: 'gitea', source: 'tea-auth', gitea, skills: CATALOG })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(JSON.stringify(result)).not.toContain(SECRET)
    expect(JSON.stringify(logs)).not.toContain(SECRET)
  })
})
