/**
 * 环境检查服务测试的共享夹具：假命令探测、假文件系统、假后端解析器与假时钟。
 * 只被测试文件导入，不参与插件构建。
 */
import { expect } from 'vitest'

import type { EnvFiles } from '../adapters/fs/env-files.ts'
import type { BackendChoice } from '../core/backend.ts'
import type { EnvCommandProbe, ProbeOutcome } from '../core/env-check.ts'
import type { Tracker } from '../core/ticket.ts'
import type { BackendKind } from '../protocol/backend.ts'
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

export const ROOT = '/workspace'
export const HOME = '/home/dev'
const TRACKER_STUB: Tracker = { fetchSnapshot: () => Promise.reject(new Error('未使用')) }

export const NO_DEADLINE: ProbeDeadline = async (task) => ({ ok: true, value: await task })

export function pass(detail = '依据'): ProbeOutcome {
  return { status: 'pass', detail }
}

export function fakeFiles(options: {
  readonly home?: string | undefined
  readonly files?: readonly string[]
}): EnvFiles {
  const files = new Set(options.files ?? [])
  return {
    homeDirectory: () => options.home,
    isFile: (path) => Promise.resolve(files.has(path)),
  }
}

export interface FakeProbe extends EnvCommandProbe {
  readonly calls: readonly string[]
}

export function fakeProbe(
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

export function resolved(
  kind: BackendKind,
  source: BackendChoice['source'] = 'remote',
): ResolvedBackend {
  return {
    kind,
    tracker: TRACKER_STUB,
    choice: { kind, source },
    address: kind === 'markdown' ? undefined : { host: 'github.com', path: 'owner/repo' },
  }
}

export interface HarnessOptions {
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

export function harness(options: HarnessOptions = {}): {
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

export function report(result: RpcResult<EnvCheckReport>): EnvCheckReport {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error.message)
  return result.result
}

export function item(
  items: readonly EnvCheckItem[],
  id: string,
  subject: string | null,
): EnvCheckItem {
  const found = items.find((entry) => entry.id === id && entry.subject === subject)
  if (found === undefined) throw new Error(`缺少检查项 ${id}/${String(subject)}`)
  return found
}

export const CATALOG: SkillCatalog = {
  names: () => Promise.resolve([...REQUIRED_SKILLS]),
}

export const DISK_FILES = fakeFiles({
  home: HOME,
  files: [
    '/workspace/docs/agents/issue-tracker.md',
    `${HOME}/.claude/skills/to-spec/SKILL.md`,
    ...[...REQUIRED_SKILLS]
      .filter((name) => name !== 'to-spec')
      .map((name) => `${HOME}/.agents/skills/${name}/SKILL.md`),
  ],
})
