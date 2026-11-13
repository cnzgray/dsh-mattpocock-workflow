import { describe, expect, it } from 'vitest'

import { createGithubEnvProbe } from '../adapters/github/env.ts'
import type { CommandRunner } from '../core/ticket.ts'
import { CommandError, TrackerError } from '../core/tracker-error.ts'
import { REQUIRED_SKILLS, type CapabilityDiagnostic } from '../protocol/env-check.ts'
import { LOG_EVENTS } from '../protocol/log-events.ts'
import type { BackendResolver, ResolvedBackend } from './backend-resolver.ts'
import { createEnvCheckService } from './env-check-service.ts'
import {
  CATALOG,
  DISK_FILES,
  FOUND_LOCAL_ISSUES,
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
    expect(result.repository).toBe('owner/repo')
    expect(result.items.every((entry) => entry.status === 'pass')).toBe(true)
    expect(item(result.items, 'backend', null).detail).toBe('remote:github（github.com）')
    expect(result.capabilities).toEqual(capabilities)
  })

  it('CLI 未安装时不再探测登录与仓库，并标为跳过', async () => {
    const github = fakeProbe('github', {
      cli: { status: 'fail', detail: '未找到 gh', reason: 'cli-missing' },
    })
    const { service } = harness({ github, skills: CATALOG })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(item(result.items, 'cli', 'github').remedy).toEqual({
      code: 'install-cli',
      subject: 'github',
    })
    expect(item(result.items, 'auth', 'github')).toMatchObject({
      status: 'skipped',
      blockedBy: { id: 'cli', subject: 'github' },
    })
    expect(github.calls).not.toContain('auth')
    expect(github.calls).not.toContain('repository')
  })

  it('未登录时不再探测仓库可达，解决回到登录命令', async () => {
    const github = fakeProbe('github', {
      auth: { status: 'fail', detail: '未登录', reason: 'cli-unauthenticated' },
    })
    const { service } = harness({ github, skills: CATALOG })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(item(result.items, 'auth', 'github').remedy).toEqual({
      code: 'login-cli',
      subject: 'github',
    })
    expect(item(result.items, 'repository', 'github')).toMatchObject({
      status: 'skipped',
      blockedBy: { id: 'auth', subject: 'github' },
    })
    expect(github.calls).not.toContain('repository')
  })

  it('仓库不存在、无权限与网络失败给出三种不同的解决', async () => {
    const cases = [
      ['repository-not-found', 'check-remote-address'],
      ['repository-forbidden', 'check-repository-access'],
      ['repository-network', 'check-network'],
    ] as const

    for (const [reason, code] of cases) {
      const github = fakeProbe('github', {
        repository: { status: 'fail', detail: '读取仓库失败', reason },
      })
      const { service } = harness({ github, skills: CATALOG })

      const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))
      expect(item(result.items, 'repository', 'github').remedy).toEqual({ code, subject: null })
    }
  })

  it('探测自身抛错时给出重试，而不是指向网络', async () => {
    const broken = fakeProbe('github', {})
    const throwing = {
      ...broken,
      cli: () => Promise.reject(new Error('探测实现坏了')),
    }
    const { service } = harness({ github: throwing, skills: CATALOG })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(item(result.items, 'cli', 'github')).toMatchObject({ status: 'fail' })
    expect(item(result.items, 'cli', 'github').remedy).toEqual({ code: 'retry', subject: null })
  })

  it('技能探测与后端探测并发开始，不必等命令行链结束', async () => {
    const pending = Promise.withResolvers<ResolvedBackend>()
    let catalogCalled = false
    const service = createEnvCheckService({
      resolve: () => pending.promise,
      github: fakeProbe('github', {}),
      gitlab: fakeProbe('gitlab', {}),
      gitea: fakeProbe('gitea', {}),
      files: fakeFiles({ home: HOME, files: ['/workspace/docs/agents/issue-tracker.md'] }),
      localIssues: () => Promise.resolve(FOUND_LOCAL_ISSUES),
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

  it('后端判定失败但错误码不在环境类范围时不带出原始命令输出', async () => {
    const { service } = harness({
      resolveError: new TrackerError('fetch-failed', '读取 git 远端失败：dial tcp 10.0.0.1'),
      skills: CATALOG,
    })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(item(result.items, 'backend', null)).toMatchObject({
      status: 'fail',
      detail: '无法判定工单后端',
    })
    expect(item(result.items, 'backend', null).remedy).toEqual({
      code: 'fix-backend',
      subject: null,
    })
  })

  it('本地 Markdown 后端不产生命令行相关检查', async () => {
    const { service } = harness({ kind: 'markdown', source: 'no-remote', skills: CATALOG })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(result.repository).toBeNull()
    expect(result.items.map((entry) => entry.id)).toEqual([
      'home',
      'backend',
      'workspace',
      'local-issues',
      ...REQUIRED_SKILLS.map(() => 'skill'),
    ])
  })

  it('GitLab 后端换成 glab 探测，依据写判定来源与实例主机', async () => {
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
    expect(item(result.items, 'backend', null).detail).toBe(
      'glab-auth:gitlab（gitlab.example.com）',
    )
    expect(gitlab.calls).toEqual(['cli', 'auth', 'repository'])
    expect(github.calls).toEqual([])
  })

  it('工作区未初始化时给出初始化工作区的解决', async () => {
    const { service } = harness({
      skills: CATALOG,
      files: fakeFiles({ home: HOME, files: [] }),
    })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(item(result.items, 'workspace', null)).toMatchObject({ status: 'fail' })
    expect(item(result.items, 'workspace', null).remedy).toEqual({
      code: 'init-workspace',
      subject: null,
    })
    expect(result.items.map((entry) => entry.id)).toEqual([
      'home',
      'backend',
      'cli',
      'auth',
      'repository',
      'workspace',
      ...REQUIRED_SKILLS.map(() => 'skill'),
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
      detail: `${HOME}/.dsh/skills/to-spec/SKILL.md（DSH 技能清单未收录，按磁盘判定）`,
    })
  })

  it('工作区的技能目录优先于用户主目录', async () => {
    const { service } = harness({
      skills: { names: () => Promise.resolve([]) },
      files: fakeFiles({
        home: HOME,
        files: [
          '/workspace/docs/agents/issue-tracker.md',
          `${ROOT}/.dsh/skills/to-spec/SKILL.md`,
          `${HOME}/.agents/skills/to-spec/SKILL.md`,
        ],
      }),
    })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(item(result.items, 'skill', 'to-spec').detail).toContain(
      `${ROOT}/.dsh/skills/to-spec/SKILL.md`,
    )
  })

  it('只装在 DSH 不扫描的 .claude/skills 下时报失败，不给假通过', async () => {
    const { service } = harness({
      skills: { names: () => Promise.resolve([]) },
      files: fakeFiles({
        home: HOME,
        files: [
          '/workspace/docs/agents/issue-tracker.md',
          ...[...REQUIRED_SKILLS].map((name) => `${HOME}/.claude/skills/${name}/SKILL.md`),
        ],
      }),
    })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(item(result.items, 'skill', 'grill-with-docs')).toMatchObject({
      status: 'fail',
      remedy: { code: 'install-skill', subject: 'grill-with-docs' },
    })
  })

  it('必需技能清单覆盖两个创建按钮用到的全部阶段', async () => {
    const { service } = harness({ skills: CATALOG })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    const checked = result.items
      .filter((entry) => entry.id === 'skill')
      .map((entry) => entry.subject)
    expect(checked).toEqual([...REQUIRED_SKILLS])
    for (const skill of ['grill-with-docs', 'to-spec', 'to-tickets', 'triage', 'implement']) {
      expect(checked).toContain(skill)
    }
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

  it('两处都没有的技能失败并点名要装的技能', async () => {
    const { service } = harness({
      skills: { names: () => Promise.resolve([]) },
      files: fakeFiles({ home: HOME, files: ['/workspace/docs/agents/issue-tracker.md'] }),
    })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(item(result.items, 'skill', 'to-spec')).toMatchObject({ status: 'fail' })
    expect(item(result.items, 'skill', 'to-spec').remedy).toEqual({
      code: 'install-skill',
      subject: 'to-spec',
    })
  })

  it('主目录不可解析时技能检查跳过', async () => {
    const { service } = harness({
      skills: CATALOG,
      files: fakeFiles({ home: undefined, files: ['/workspace/docs/agents/issue-tracker.md'] }),
    })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(item(result.items, 'home', null)).toMatchObject({ status: 'fail' })
    expect(item(result.items, 'home', null).remedy).toEqual({ code: 'check-home', subject: null })
    expect(item(result.items, 'skill', 'to-spec')).toMatchObject({
      status: 'skipped',
      blockedBy: { id: 'home', subject: null },
    })
  })

  it('探测超时按失败处理，解决是重新检查', async () => {
    const { service } = harness({
      skills: CATALOG,
      deadline: () => Promise.resolve({ ok: false }),
    })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(item(result.items, 'backend', null)).toMatchObject({ status: 'fail' })
    expect(item(result.items, 'backend', null).remedy).toEqual({ code: 'retry', subject: null })
    expect(item(result.items, 'cli', null)).toMatchObject({ status: 'skipped' })
    expect(item(result.items, 'local-issues', null)).toMatchObject({ status: 'fail' })
    expect(item(result.items, 'local-issues', null).remedy).toEqual({
      code: 'retry',
      subject: null,
    })
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
      gitea: fakeProbe('gitea', {}),
      files: fakeFiles({ home: HOME, files: ['/workspace/docs/agents/issue-tracker.md'] }),
      localIssues: () => Promise.resolve(FOUND_LOCAL_ISSUES),
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
      // 主目录、后端、工作区与每一项技能都通过；托管后端不检查本地工单目录，命令行失败后登录与仓库被跳过。
      passed: 3 + REQUIRED_SKILLS.length,
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
