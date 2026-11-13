import { describe, expect, it } from 'vitest'

import type { EnvCheckItem } from '../protocol/env-check.ts'
import {
  buildEnvCheckItems,
  type BackendProbeOutcome,
  type EnvCheckFacts,
  type ProbeFailureReason,
  type ProbeOutcome,
} from './env-check.ts'

function pass(detail = '依据'): ProbeOutcome {
  return { status: 'pass', detail }
}

function failure(detail: string, reason: ProbeFailureReason): ProbeOutcome {
  return { status: 'fail', detail, reason }
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
    ...overrides,
  }
}

function item(items: readonly EnvCheckItem[], id: string, subject: string | null): EnvCheckItem {
  const found = items.find((entry) => entry.id === id && entry.subject === subject)
  if (found === undefined) throw new Error(`缺少检查项 ${id}/${String(subject)}`)
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

  it('全部通过时没有建议码和跳过原因', () => {
    const items = buildEnvCheckItems(facts())

    for (const entry of items) {
      expect(entry.status).toBe('pass')
      expect(entry.suggestion).toBeNull()
      expect(entry.blockedBy).toBeNull()
    }
  })

  it('CLI 未安装时，登录与仓库可达标为跳过并指向 CLI', () => {
    const items = buildEnvCheckItems(
      facts({
        cli: failure('未找到 gh', 'cli-missing'),
        auth: undefined,
        repository: undefined,
      }),
    )

    const cli = item(items, 'cli', 'github')
    expect(cli.status).toBe('fail')
    expect(cli.suggestion).toBe('install-cli')
    expect(item(items, 'auth', 'github')).toMatchObject({
      status: 'skipped',
      blockedBy: { id: 'cli', subject: 'github' },
    })
    expect(item(items, 'repository', 'github')).toMatchObject({
      status: 'skipped',
      blockedBy: { id: 'cli', subject: 'github' },
    })
  })

  it('未登录时仓库可达跳过，并指向登录项而不是登录项的根因', () => {
    const items = buildEnvCheckItems(facts({ auth: failure('未登录', 'cli-unauthenticated') }))

    expect(item(items, 'auth', 'github')).toMatchObject({
      status: 'fail',
      suggestion: 'login-cli',
    })
    expect(item(items, 'repository', 'github')).toMatchObject({
      status: 'skipped',
      blockedBy: { id: 'auth', subject: 'github' },
    })
  })

  it('后端判定失败时，三项后端相关检查全部跳过并指向后端', () => {
    const backend: BackendProbeOutcome = {
      status: 'fail',
      detail: '未找到 glab',
      reason: 'backend-cli-missing',
    }
    const items = buildEnvCheckItems(
      facts({ backend, cli: undefined, auth: undefined, repository: undefined }),
    )

    expect(item(items, 'backend', null)).toMatchObject({
      status: 'fail',
      suggestion: 'install-cli',
    })
    for (const id of ['cli', 'auth', 'repository']) {
      expect(item(items, id, null)).toMatchObject({
        status: 'skipped',
        blockedBy: { id: 'backend', subject: null },
      })
    }
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

  it('主目录不可解析时技能检查跳过并指向主目录', () => {
    const items = buildEnvCheckItems(
      facts({
        home: failure('无法解析用户主目录', 'home-unresolved'),
        skills: [{ name: 'to-spec', outcome: undefined }],
      }),
    )

    expect(item(items, 'home', null)).toMatchObject({
      status: 'fail',
      suggestion: 'check-home',
    })
    expect(item(items, 'skill', 'to-spec')).toMatchObject({
      status: 'skipped',
      blockedBy: { id: 'home', subject: null },
    })
  })

  it('工作区未初始化时给出运行初始化技能的建议', () => {
    const items = buildEnvCheckItems(
      facts({ workspace: failure('未找到文档', 'workspace-uninitialized') }),
    )

    expect(item(items, 'workspace', null)).toMatchObject({
      status: 'fail',
      suggestion: 'run-setup-skills',
    })
  })

  it.each([
    ['repository-forbidden', 'check-repository-access'],
    ['repository-network', 'check-network'],
    ['timeout', 'check-network'],
    ['skill-missing', 'install-skill'],
  ] as const)('失败原因 %s 映射成建议码 %s', (reason, suggestion) => {
    const base = facts()
    const items = buildEnvCheckItems(
      reason === 'skill-missing'
        ? { ...base, skills: [{ name: 'to-spec', outcome: failure('缺失', reason) }] }
        : {
            ...base,
            repository: failure('失败', reason),
          },
    )

    expect(items.find((entry) => entry.suggestion === suggestion)).toBeDefined()
  })
})
