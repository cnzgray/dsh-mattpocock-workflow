import { describe, expect, it } from 'vitest'

import type { EnvCheckItem, EnvCliBackend, EnvRemedy } from '../protocol/env-check.ts'
import {
  buildEnvCheckItems,
  type BackendProbeOutcome,
  type EnvCheckFacts,
  type ProbeFailureReason,
  type ProbeOutcome,
} from './env-check.ts'

const SETUP = 'setup-matt-pocock-skills'

function pass(detail = '依据'): ProbeOutcome {
  return { status: 'pass', detail }
}

function failure(
  detail: string,
  reason: ProbeFailureReason,
  backend?: EnvCliBackend,
): ProbeOutcome {
  return backend === undefined
    ? { status: 'fail', detail, reason }
    : { status: 'fail', detail, reason, backend }
}

function facts(overrides: Partial<EnvCheckFacts> = {}): EnvCheckFacts {
  return {
    home: pass('/home/dev'),
    backend: {
      status: 'pass',
      choice: { kind: 'github', source: 'remote' },
      detail: 'remote:github',
    },
    workspace: pass('docs/agents/issue-tracker.md 存在'),
    cli: pass('/opt/homebrew/bin/gh'),
    auth: pass('已登录'),
    repository: pass('可访问 owner/repo'),
    skills: [{ name: 'to-spec', outcome: pass('DSH 技能清单已收录') }],
    setupSkill: SETUP,
    ...overrides,
  }
}

function item(items: readonly EnvCheckItem[], id: string, subject: string | null): EnvCheckItem {
  const found = items.find((entry) => entry.id === id && entry.subject === subject)
  if (found === undefined) throw new Error(`缺少检查项 ${id}/${String(subject)}`)
  return found
}

function remedyOf(items: readonly EnvCheckItem[], id: string, subject: string | null): EnvRemedy {
  const found = item(items, id, subject).remedy
  if (found === null) throw new Error(`${id}/${String(subject)} 没有解决`)
  return found
}

describe('环境检查判定', () => {
  it('按从机器到后端的固定顺序产出检查项', () => {
    const items = buildEnvCheckItems(
      facts({
        skills: [
          { name: 'to-spec', outcome: pass('清单') },
          { name: 'triage', outcome: pass('清单') },
        ],
      }),
    )

    expect(items.map((entry) => `${entry.id}:${String(entry.subject)}`)).toEqual([
      'home:null',
      'backend:null',
      'cli:github',
      'auth:github',
      'repository:github',
      'workspace:null',
      'skill:to-spec',
      'skill:triage',
    ])
  })

  it('全部通过时没有解决也没有跳过原因', () => {
    const items = buildEnvCheckItems(facts())

    for (const entry of items) {
      expect(entry.status).toBe('pass')
      expect(entry.remedy).toBeNull()
      expect(entry.blockedBy).toBeNull()
    }
  })

  it('Gitea 后端的 CLI 三项标为跳过，不冒用其他后端的结论', () => {
    const items = buildEnvCheckItems(
      facts({
        backend: {
          status: 'pass',
          choice: { kind: 'gitea', source: 'tea-auth' },
          detail: 'tea-auth:gitea',
        },
        cli: undefined,
        auth: undefined,
        repository: undefined,
      }),
    )

    for (const id of ['cli', 'auth', 'repository'] as const) {
      expect(item(items, id, 'gitea')).toEqual({
        id,
        subject: 'gitea',
        status: 'skipped',
        detail: '暂不支持 Gitea 后端的环境检查',
        remedy: null,
        blockedBy: null,
      })
    }
  })

  it('CLI 未安装时给出该后端的安装解决，登录与仓库可达跳过且没有解决', () => {
    const items = buildEnvCheckItems(
      facts({
        cli: failure('未找到 gh', 'cli-missing'),
        auth: undefined,
        repository: undefined,
      }),
    )

    expect(remedyOf(items, 'cli', 'github')).toEqual({
      code: 'install-cli',
      subject: 'github',
    })
    for (const id of ['auth', 'repository'] as const) {
      expect(item(items, id, 'github')).toMatchObject({
        status: 'skipped',
        remedy: null,
        blockedBy: { id: 'cli', subject: 'github' },
      })
    }
  })

  it('未登录时给出对应 CLI 的登录解决，仓库可达跳过并指向登录项', () => {
    const items = buildEnvCheckItems(facts({ auth: failure('未登录', 'cli-unauthenticated') }))

    expect(remedyOf(items, 'auth', 'github')).toEqual({ code: 'login-cli', subject: 'github' })
    expect(item(items, 'repository', 'github')).toMatchObject({
      status: 'skipped',
      remedy: null,
      blockedBy: { id: 'auth', subject: 'github' },
    })
  })

  it('后端判定因缺 glab 失败时，解决点名 GitLab 而不是「对应后端」', () => {
    const backend: BackendProbeOutcome = {
      status: 'fail',
      detail: '未找到 glab，GitLab 后端不可用',
      reason: 'cli-missing',
      backend: 'gitlab',
    }
    const items = buildEnvCheckItems(
      facts({ backend, cli: undefined, auth: undefined, repository: undefined }),
    )

    expect(remedyOf(items, 'backend', null)).toEqual({
      code: 'install-cli',
      subject: 'gitlab',
    })
    for (const id of ['cli', 'auth', 'repository'] as const) {
      expect(item(items, id, null)).toMatchObject({
        status: 'skipped',
        remedy: null,
        blockedBy: { id: 'backend', subject: null },
      })
    }
  })

  it('后端判定没有候选后端时给出修复后端选择的解决', () => {
    const items = buildEnvCheckItems(
      facts({
        backend: { status: 'fail', detail: '无法判定工单后端', reason: 'backend-unavailable' },
        cli: undefined,
        auth: undefined,
        repository: undefined,
      }),
    )

    expect(remedyOf(items, 'backend', null)).toEqual({ code: 'fix-backend', subject: null })
  })

  it('本地 Markdown 后端不产生命令行、登录与仓库可达检查', () => {
    const items = buildEnvCheckItems(
      facts({
        backend: {
          status: 'pass',
          choice: { kind: 'markdown', source: 'unsupported-remote' },
          detail: 'unsupported-remote:markdown',
        },
        cli: undefined,
        auth: undefined,
        repository: undefined,
      }),
    )

    expect(items.map((entry) => entry.id)).toEqual(['home', 'backend', 'workspace', 'skill'])
  })

  it('仓库无权限、不存在与网络失败给出三种不同的解决', () => {
    const cases = [
      ['repository-forbidden', 'check-repository-access'],
      ['repository-not-found', 'check-remote-address'],
      ['repository-network', 'check-network'],
    ] as const

    for (const [reason, code] of cases) {
      const items = buildEnvCheckItems(facts({ repository: failure('失败', reason) }))
      expect(remedyOf(items, 'repository', 'github')).toEqual({ code, subject: null })
    }
  })

  it('仓库探测发现缺 CLI 或未登录时，解决回到安装与登录', () => {
    const missing = buildEnvCheckItems(facts({ repository: failure('缺 gh', 'cli-missing') }))
    const unauthenticated = buildEnvCheckItems(
      facts({ repository: failure('令牌失效', 'cli-unauthenticated') }),
    )

    expect(remedyOf(missing, 'repository', 'github')).toEqual({
      code: 'install-cli',
      subject: 'github',
    })
    expect(remedyOf(unauthenticated, 'repository', 'github')).toEqual({
      code: 'login-cli',
      subject: 'github',
    })
  })

  it('主目录不可解析时给出检查主目录的解决，技能检查跳过并指向主目录', () => {
    const items = buildEnvCheckItems(
      facts({
        home: failure('无法解析用户主目录', 'home-unresolved'),
        skills: [{ name: 'to-spec', outcome: undefined }],
      }),
    )

    expect(remedyOf(items, 'home', null)).toEqual({ code: 'check-home', subject: null })
    expect(item(items, 'skill', 'to-spec')).toMatchObject({
      status: 'skipped',
      remedy: null,
      blockedBy: { id: 'home', subject: null },
    })
  })

  it('工作区未初始化且初始化技能通过时，解决是初始化工作区', () => {
    const items = buildEnvCheckItems(
      facts({
        workspace: failure('未找到 docs/agents/issue-tracker.md', 'workspace-uninitialized'),
        skills: [{ name: SETUP, outcome: pass('DSH 技能清单已收录') }],
      }),
    )

    expect(remedyOf(items, 'workspace', null)).toEqual({
      code: 'init-workspace',
      subject: null,
    })
  })

  it('初始化技能本身缺失时，工作区的解决先指向安装该技能', () => {
    const items = buildEnvCheckItems(
      facts({
        workspace: failure('未找到 docs/agents/issue-tracker.md', 'workspace-uninitialized'),
        skills: [{ name: SETUP, outcome: failure('两处都没有', 'skill-missing') }],
      }),
    )

    expect(remedyOf(items, 'workspace', null)).toEqual({
      code: 'install-skill',
      subject: SETUP,
    })
    expect(remedyOf(items, 'skill', SETUP)).toEqual({
      code: 'install-skill',
      subject: SETUP,
    })
  })

  it('初始化技能的探测被跳过时仍给出初始化工作区，而不是谎称技能缺失', () => {
    const items = buildEnvCheckItems(
      facts({
        workspace: failure('未找到 docs/agents/issue-tracker.md', 'workspace-uninitialized'),
        skills: [{ name: SETUP, outcome: undefined }],
      }),
    )

    expect(remedyOf(items, 'workspace', null)).toEqual({
      code: 'init-workspace',
      subject: null,
    })
  })

  it('技能缺失时解决点名该项技能', () => {
    const items = buildEnvCheckItems(
      facts({ skills: [{ name: 'triage', outcome: failure('两处都没有', 'skill-missing') }] }),
    )

    expect(remedyOf(items, 'skill', 'triage')).toEqual({
      code: 'install-skill',
      subject: 'triage',
    })
  })

  it('超时与探测失败给出重试，探测没有结果给出查日志', () => {
    const timedOut = buildEnvCheckItems(facts({ repository: failure('探测超时', 'timeout') }))
    const probeFailed = buildEnvCheckItems(
      facts({ repository: failure('仓库检查失败', 'probe-failed') }),
    )
    const missingOutcome = buildEnvCheckItems(facts({ cli: undefined }))

    expect(remedyOf(timedOut, 'repository', 'github')).toEqual({ code: 'retry', subject: null })
    expect(remedyOf(probeFailed, 'repository', 'github')).toEqual({ code: 'retry', subject: null })
    expect(remedyOf(missingOutcome, 'cli', 'github')).toEqual({
      code: 'check-logs',
      subject: null,
    })
  })
})
