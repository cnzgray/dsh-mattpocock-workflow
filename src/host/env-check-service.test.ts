import { describe, expect, it } from 'vitest'

import { createGithubEnvProbe } from '../adapters/github/env.ts'
import type { CommandRunner } from '../core/ticket.ts'
import { CommandError } from '../core/tracker-error.ts'
import { REQUIRED_SKILLS, type CapabilityDiagnostic } from '../protocol/env-check.ts'
import { LOG_EVENTS } from '../protocol/log-events.ts'
import type { BackendResolver, ResolvedBackend } from './backend-resolver.ts'
import { createEnvCheckService } from './env-check-service.ts'
import {
  CATALOG,
  DISK_FILES,
  HOME,
  NO_DEADLINE,
  ROOT,
  fakeFiles,
  fakeProbe,
  harness,
  item,
  report,
  resolved,
} from './env-check-test-support.ts'

describe('环境检查服务', () => {
  it('全部就绪时报告的每一项都通过，并带上后端与能力诊断', async () => {
    const capabilities: readonly CapabilityDiagnostic[] = [
      { id: 'subprocess', category: 'host-service', status: 'present' },
    ]
    const { service } = harness({ skills: CATALOG, capabilities })

    const result = report(
      await service.handle('env.check', {
        workspaceRoot: ROOT,
      }),
    )

    expect(result.backend).toBe('github')
    expect(result.items.every((entry) => entry.status === 'pass')).toBe(true)
    expect(item(result.items, 'backend', null).detail).toBe('remote:github')
    expect(result.capabilities).toEqual(capabilities)
  })

  it('技能探测与后端探测并发开始，不必等命令行链结束', async () => {
    const pending = Promise.withResolvers<ResolvedBackend>()
    let catalogCalled = false
    const service = createEnvCheckService({
      resolve: () => pending.promise,
      github: fakeProbe('github', {}),
      gitlab: fakeProbe('gitlab', {}),
      files: fakeFiles({ home: HOME, files: ['/workspace/docs/agents/issue-tracker.md'] }),
      skills: {
        names: () => {
          catalogCalled = true
          return Promise.resolve([...REQUIRED_SKILLS])
        },
      },
      capabilities: () => [],
      now: () => 1,
      deadline: NO_DEADLINE,
      log: () => undefined,
    })

    const running = service.handle('env.check', { workspaceRoot: ROOT })
    expect(catalogCalled).toBe(true)

    pending.resolve(resolved('github'))
    await running
  })

  it('Gitea 后端不调用 gh / glab 探测，CLI 三项标为跳过', async () => {
    const github = fakeProbe('github', {})
    const gitlab = fakeProbe('gitlab', {})
    const { service } = harness({ kind: 'gitea', source: 'tea-auth', github, gitlab })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(github.calls).toEqual([])
    expect(gitlab.calls).toEqual([])
    for (const id of ['cli', 'auth', 'repository'] as const) {
      expect(item(result.items, id, 'gitea')).toMatchObject({
        status: 'skipped',
        detail: '暂不支持 Gitea 后端的环境检查',
      })
    }
  })

  it('GitLab 后端换成 glab 探测，依据写判定来源', async () => {
    const gitlab = fakeProbe('gitlab', {})
    const github = fakeProbe('github', {})
    const { service } = harness({
      kind: 'gitlab',
      source: 'glab-auth',
      gitlab,
      github,
      skills: CATALOG,
    })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(result.backend).toBe('gitlab')
    expect(item(result.items, 'backend', null).detail).toBe('glab-auth:gitlab')
    expect(gitlab.calls).toEqual(['cli', 'auth', 'repository'])
    expect(github.calls).toEqual([])
  })

  it('本地 Markdown 后端不产生命令行相关检查', async () => {
    const { service } = harness({ kind: 'markdown', source: 'no-remote', skills: CATALOG })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(result.items.map((entry) => entry.id)).toEqual([
      'home',
      'backend',
      'workspace',
      'skill',
      'skill',
      'skill',
      'skill',
      'skill',
    ])
  })

  it('技能优先按 DSH 技能清单判定', async () => {
    const { service } = harness({ skills: CATALOG })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(item(result.items, 'skill', 'to-spec')).toMatchObject({
      status: 'pass',
      detail: 'DSH 技能清单已收录',
    })
  })

  it('清单未收录时按磁盘判定并写明位置', async () => {
    const { service } = harness({
      skills: { names: () => Promise.resolve(['implement']) },
      files: DISK_FILES,
    })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(item(result.items, 'skill', 'to-spec')).toMatchObject({
      status: 'pass',
      detail: `${HOME}/.claude/skills/to-spec/SKILL.md（DSH 技能清单未收录，按磁盘判定）`,
    })
  })

  it('清单服务缺失或报错时降级为只查磁盘', async () => {
    const missing = harness({ skills: undefined, files: DISK_FILES })
    const broken = harness({
      skills: { names: () => Promise.reject(new Error('清单不可用')) },
      files: DISK_FILES,
    })

    for (const fake of [missing, broken]) {
      const result = report(await fake.service.handle('env.check', { workspaceRoot: ROOT }))
      expect(item(result.items, 'skill', 'to-spec').status).toBe('pass')
    }
  })

  it('同一工作区的并发请求复用同一次检查', async () => {
    const pending = Promise.withResolvers<ResolvedBackend>()
    const calls: string[] = []
    const resolve: BackendResolver = (root) => {
      calls.push(root)
      return pending.promise
    }
    const shared = createEnvCheckService({
      resolve,
      github: fakeProbe('github', {}),
      gitlab: fakeProbe('gitlab', {}),
      files: fakeFiles({ home: HOME, files: ['/workspace/docs/agents/issue-tracker.md'] }),
      skills: CATALOG,
      capabilities: () => [],
      now: () => 1,
      deadline: NO_DEADLINE,
      log: () => undefined,
    })

    const first = shared.handle('env.check', { workspaceRoot: ROOT })
    const second = shared.handle('env.check', { workspaceRoot: ROOT })
    pending.resolve(resolved('github'))

    const [left, right] = await Promise.all([first, second])
    expect(calls).toEqual([ROOT])
    expect(left).toBe(right)
  })

  it('修好问题后重新检查不复用上一次的结果', async () => {
    const { service, resolveCalls } = harness({ skills: CATALOG })

    await service.handle('env.check', { workspaceRoot: ROOT })
    await service.handle('env.check', { workspaceRoot: ROOT })

    expect(resolveCalls).toEqual([ROOT, ROOT])
  })

  it('每次检查记一条日志，带耗时与通过失败数量', async () => {
    const github = fakeProbe('github', {
      cli: { status: 'fail', detail: '未找到 gh', reason: 'cli-missing' },
    })
    const { service, logs } = harness({ github, skills: CATALOG })

    await service.handle('env.check', { workspaceRoot: ROOT })

    expect(logs).toHaveLength(1)
    expect(logs[0]?.event).toBe(LOG_EVENTS.envCheck)
    expect(logs[0]?.fields).toMatchObject({
      backend: 'github',
      passed: 8,
      failed: 1,
      skipped: 2,
      level: 'info',
    })
    expect(typeof logs[0]?.fields.durationMs).toBe('number')
  })

  it('报告和日志里不出现命令原始输出里的令牌', async () => {
    const SECRET = 'SECRET-TOKEN'
    const run: CommandRunner = (_command, args) => {
      if (args[0] === '--version') {
        return Promise.resolve({ stdout: '', stderr: '', executable: '/opt/homebrew/bin/gh' })
      }
      return Promise.reject(new CommandError('failed', 'gh 退出码 1', `HTTP 401: ${SECRET}`))
    }
    const github = createGithubEnvProbe({ run })
    const { service, logs } = harness({ github, skills: CATALOG })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(JSON.stringify(result)).not.toContain(SECRET)
    expect(JSON.stringify(logs)).not.toContain(SECRET)
  })

  it('未知方法返回 unknown-method', async () => {
    const { service } = harness({ skills: CATALOG })

    await expect(service.handle('snapshot.get', { workspaceRoot: ROOT })).resolves.toMatchObject({
      ok: false,
      error: { code: 'unknown-method' },
    })
  })

  it('缺少 workspaceRoot 返回 invalid-params', async () => {
    const { service } = harness({ skills: CATALOG })

    await expect(service.handle('env.check', {})).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-params' },
    })
  })
})
