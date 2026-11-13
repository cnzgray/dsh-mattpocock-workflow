import { describe, expect, it } from 'vitest'

import type { EnvFiles } from '../adapters/fs/env-files.ts'
import { createGithubEnvProbe } from '../adapters/github/env.ts'
import type { BackendChoice } from '../core/backend.ts'
import type { EnvCommandProbe, ProbeOutcome } from '../core/env-check.ts'
import type { CommandRunner, Tracker } from '../core/ticket.ts'
import { CommandError, TrackerError } from '../core/tracker-error.ts'
import type { BackendKind } from '../protocol/backend.ts'
import { LOG_EVENTS } from '../protocol/log-events.ts'
import {
  REQUIRED_SKILLS,
  type CapabilityDiagnostic,
  type EnvCheckItem,
  type EnvCheckReport,
} from '../protocol/env-check.ts'
import type { RpcResult } from '../protocol/tracker.ts'
import type { BackendResolver, ResolvedBackend } from './backend-resolver.ts'
import {
  createEnvCheckService,
  type EnvCheckService,
  type EnvCheckServiceDeps,
  type SkillCatalog,
} from './env-check-service.ts'
import type { ProbeDeadline } from './probe-deadline.ts'

const ROOT = '/workspace'
const HOME = '/home/dev'
const TRACKER_STUB: Tracker = { fetchSnapshot: () => Promise.reject(new Error('未使用')) }

const NO_DEADLINE: ProbeDeadline = async (task) => ({ ok: true, value: await task })

function pass(detail = '依据'): ProbeOutcome {
  return { status: 'pass', detail }
}

function fakeFiles(options: {
  readonly home?: string | undefined
  readonly files?: readonly string[]
}): EnvFiles {
  const files = new Set(options.files ?? [])
  return {
    homeDirectory: () => options.home,
    isFile: (path) => Promise.resolve(files.has(path)),
  }
}

interface FakeProbe extends EnvCommandProbe {
  readonly calls: readonly string[]
}

function fakeProbe(
  kind: 'github' | 'gitlab',
  replies: {
    readonly cli?: ProbeOutcome
    readonly auth?: ProbeOutcome
    readonly repository?: ProbeOutcome
  },
): FakeProbe {
  const calls: string[] = []
  const reply = (value: ProbeOutcome | undefined, fallback: string): ProbeOutcome => {
    calls.push(fallback)
    return value ?? pass(fallback)
  }
  return {
    kind,
    calls,
    cli: () => Promise.resolve(reply(replies.cli, 'cli')),
    auth: () => Promise.resolve(reply(replies.auth, 'auth')),
    repository: () => Promise.resolve(reply(replies.repository, 'repository')),
  }
}

function resolved(kind: BackendKind, source: BackendChoice['source'] = 'remote'): ResolvedBackend {
  return {
    kind,
    tracker: TRACKER_STUB,
    choice: { kind, source },
    address: kind === 'markdown' ? undefined : { host: 'github.com', path: 'owner/repo' },
  }
}

interface HarnessOptions {
  readonly kind?: BackendKind
  readonly source?: BackendChoice['source']
  readonly resolveError?: Error
  readonly files?: EnvFiles
  readonly skills?: SkillCatalog | undefined
  readonly capabilities?: readonly CapabilityDiagnostic[]
  readonly deadline?: ProbeDeadline
  readonly github?: EnvCommandProbe
  readonly gitlab?: EnvCommandProbe
}

function harness(options: HarnessOptions = {}): {
  readonly service: EnvCheckService
  readonly logs: readonly { event: string; fields: Record<string, unknown> }[]
  readonly resolveCalls: string[]
  readonly github: EnvCommandProbe
  readonly gitlab: EnvCommandProbe
} {
  const logs: { event: string; fields: Record<string, unknown> }[] = []
  const resolveCalls: string[] = []
  const resolve: BackendResolver = (workspaceRoot) => {
    resolveCalls.push(workspaceRoot)
    if (options.resolveError !== undefined) return Promise.reject(options.resolveError)
    return Promise.resolve(resolved(options.kind ?? 'github', options.source))
  }
  const github = options.github ?? fakeProbe('github', {})
  const gitlab = options.gitlab ?? fakeProbe('gitlab', {})
  let clock = 1_000

  const deps: EnvCheckServiceDeps = {
    resolve,
    github,
    gitlab,
    files:
      options.files ??
      fakeFiles({
        home: HOME,
        files: ['/workspace/docs/agents/issue-tracker.md'],
      }),
    skills: options.skills,
    capabilities: () => options.capabilities ?? [],
    now: () => {
      clock += 10
      return clock
    },
    deadline: options.deadline ?? NO_DEADLINE,
    log: (level, event, fields) => {
      logs.push({ event, fields: { ...fields, level } })
    },
  }

  return { service: createEnvCheckService(deps), logs, resolveCalls, github, gitlab }
}

function report(result: RpcResult<EnvCheckReport>): EnvCheckReport {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error.message)
  return result.result
}

function item(items: readonly EnvCheckItem[], id: string, subject: string | null): EnvCheckItem {
  const found = items.find((entry) => entry.id === id && entry.subject === subject)
  if (found === undefined) throw new Error(`缺少检查项 ${id}/${String(subject)}`)
  return found
}

const CATALOG: SkillCatalog = {
  names: () => Promise.resolve([...REQUIRED_SKILLS]),
}

const DISK_FILES = fakeFiles({
  home: HOME,
  files: [
    '/workspace/docs/agents/issue-tracker.md',
    `${HOME}/.claude/skills/to-spec/SKILL.md`,
    ...[...REQUIRED_SKILLS]
      .filter((name) => name !== 'to-spec')
      .map((name) => `${HOME}/.agents/skills/${name}/SKILL.md`),
  ],
})

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

  it('CLI 未安装时不再探测登录与仓库，并标为跳过', async () => {
    const github = fakeProbe('github', {
      cli: { status: 'fail', detail: '未找到 gh', reason: 'cli-missing' },
    })
    const { service } = harness({ github, skills: CATALOG })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(item(result.items, 'cli', 'github')).toMatchObject({
      status: 'fail',
      suggestion: 'install-cli',
    })
    expect(item(result.items, 'auth', 'github')).toMatchObject({
      status: 'skipped',
      blockedBy: { id: 'cli', subject: 'github' },
    })
    expect(github.calls).toEqual(['cli'])
  })

  it('未登录时不再探测仓库可达', async () => {
    const github = fakeProbe('github', {
      auth: { status: 'fail', detail: '未登录', reason: 'cli-unauthenticated' },
    })
    const { service } = harness({ github, skills: CATALOG })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(item(result.items, 'repository', 'github')).toMatchObject({
      status: 'skipped',
      blockedBy: { id: 'auth', subject: 'github' },
    })
    expect(github.calls).toEqual(['cli', 'auth'])
  })

  it('仓库不存在、无权限与网络失败给出不同建议', async () => {
    const missing = harness({
      github: fakeProbe('github', {
        repository: {
          status: 'fail',
          detail: '仓库不存在',
          reason: 'repository-not-found',
        },
      }),
      skills: CATALOG,
    })
    const forbidden = harness({
      github: fakeProbe('github', {
        repository: {
          status: 'fail',
          detail: '没有访问权限或仓库不存在',
          reason: 'repository-forbidden',
        },
      }),
      skills: CATALOG,
    })
    const network = harness({
      github: fakeProbe('github', {
        repository: { status: 'fail', detail: '网络不可达', reason: 'repository-network' },
      }),
      skills: CATALOG,
    })

    const forbiddenReport = report(
      await forbidden.service.handle('env.check', { workspaceRoot: ROOT }),
    )
    const networkReport = report(await network.service.handle('env.check', { workspaceRoot: ROOT }))

    const missingReport = report(await missing.service.handle('env.check', { workspaceRoot: ROOT }))
    expect(item(missingReport.items, 'repository', 'github').suggestion).toBe(
      'check-remote-address',
    )
    expect(item(forbiddenReport.items, 'repository', 'github').suggestion).toBe(
      'check-repository-access',
    )
    expect(item(networkReport.items, 'repository', 'github').suggestion).toBe('check-network')
  })

  it('探测自身抛错时建议查看日志，而不是指向网络', async () => {
    const broken = fakeProbe('github', {})
    const throwing = {
      ...broken,
      cli: () => Promise.reject(new Error('探测实现坏了')),
    }
    const { service } = harness({ github: throwing, skills: CATALOG })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(item(result.items, 'cli', 'github')).toMatchObject({
      status: 'fail',
      suggestion: 'check-logs',
    })
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

  it('后端判定失败时三项后端相关检查全部跳过', async () => {
    const github = fakeProbe('github', {})
    const gitlab = fakeProbe('gitlab', {})
    const { service, logs } = harness({
      resolveError: new TrackerError('glab-missing', '未找到 glab'),
      skills: CATALOG,
      github,
      gitlab,
    })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(result.backend).toBeNull()
    expect(item(result.items, 'backend', null)).toMatchObject({
      status: 'fail',
      suggestion: 'install-cli',
    })
    for (const id of ['cli', 'auth', 'repository']) {
      expect(item(result.items, id, null)).toMatchObject({
        status: 'skipped',
        blockedBy: { id: 'backend', subject: null },
      })
    }
    expect(github.calls).toEqual([])
    expect(gitlab.calls).toEqual([])
    expect(logs.at(0)?.fields.backend).toBeNull()
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

  it('工作区未初始化时建议运行初始化技能', async () => {
    const { service } = harness({
      skills: CATALOG,
      files: fakeFiles({ home: HOME, files: [] }),
    })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(item(result.items, 'workspace', null)).toMatchObject({
      status: 'fail',
      suggestion: 'run-setup-skills',
    })
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

  it('两处都没有的技能失败并给出安装建议', async () => {
    const { service } = harness({
      skills: { names: () => Promise.resolve([]) },
      files: fakeFiles({ home: HOME, files: ['/workspace/docs/agents/issue-tracker.md'] }),
    })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(item(result.items, 'skill', 'to-spec')).toMatchObject({
      status: 'fail',
      suggestion: 'install-skill',
    })
  })

  it('主目录不可解析时技能检查跳过', async () => {
    const { service } = harness({
      skills: CATALOG,
      files: fakeFiles({ home: undefined, files: ['/workspace/docs/agents/issue-tracker.md'] }),
    })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(item(result.items, 'home', null)).toMatchObject({
      status: 'fail',
      suggestion: 'check-home',
    })
    expect(item(result.items, 'skill', 'to-spec')).toMatchObject({
      status: 'skipped',
      blockedBy: { id: 'home', subject: null },
    })
  })

  it('探测超时按失败处理', async () => {
    const { service } = harness({
      skills: CATALOG,
      deadline: () => Promise.resolve({ ok: false }),
    })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(item(result.items, 'backend', null)).toMatchObject({
      status: 'fail',
      suggestion: 'check-network',
    })
    expect(item(result.items, 'cli', null)).toMatchObject({ status: 'skipped' })
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
