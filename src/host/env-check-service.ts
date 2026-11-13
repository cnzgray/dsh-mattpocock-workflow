/**
 * 环境检查服务：按 core 给出的检查项与依赖关系调度探测。
 *
 * - 互不依赖的探测并发执行，前置项失败就不再跑依赖它的探测；
 * - 每个探测都有超时，超时按失败处理；
 * - 同一工作区有检查在跑时，新请求复用进行中的那一次；
 * - 日志只记耗时和通过/失败数量，不记命令原始输出。
 *
 * 主接缝是 `handle('env.check', params)`：测试注入假的探测、文件系统、
 * 技能清单和解析器，就能覆盖判定、调度与错误码。
 */
import { join } from 'node:path'

import type { EnvFiles } from '../adapters/fs/env-files.ts'
import type {
  BackendProbeOutcome,
  EnvCheckFacts,
  EnvCommandProbe,
  ProbeOutcome,
  SkillProbeFact,
} from '../core/env-check.ts'
import { buildEnvCheckItems } from '../core/env-check.ts'
import type { RepositoryAddress } from '../core/remote.ts'
import { TrackerError } from '../core/tracker-error.ts'
import { LOG_EVENTS } from '../protocol/log-events.ts'
import {
  REQUIRED_SKILLS,
  type CapabilityDiagnostic,
  type EnvCheckReport,
} from '../protocol/env-check.ts'
import { ERROR_CODES, RPC_METHODS, type ErrorCode, type RpcResult } from '../protocol/tracker.ts'
import type { BackendResolver } from './backend-resolver.ts'
import type { LogSink } from './log.ts'
import type { ProbeDeadline } from './probe-deadline.ts'

/** 工作区初始化后的工单操作说明；存在即视为已初始化。 */
const TRACKER_DOC = 'docs/agents/issue-tracker.md'

/** 磁盘上可能存放技能的目录，按顺序查找；工作区优先，其次用户主目录。 */
const SKILL_DIRECTORIES: readonly string[] = ['.agents/skills', '.claude/skills']

/** DSH 技能清单的读取能力；服务缺失时整体为 undefined。 */
export interface SkillCatalog {
  /** 当前工作区可见的技能名；失败由服务层降级为只查磁盘。 */
  names(workspaceRoot: string): Promise<readonly string[]>
}

/** 环境检查服务依赖。 */
export interface EnvCheckServiceDeps {
  /** 与快照共用同一个后端解析器，两边对后端的判定不会分叉。 */
  readonly resolve: BackendResolver
  readonly github: EnvCommandProbe
  readonly gitlab: EnvCommandProbe
  readonly files: EnvFiles
  /** DSH 技能清单；服务不可用时为 undefined，降级为只查磁盘。 */
  readonly skills: SkillCatalog | undefined
  /** 宿主服务是否可用，每次检查时读取。 */
  readonly capabilities: () => readonly CapabilityDiagnostic[]
  readonly now: () => number
  readonly deadline: ProbeDeadline
  readonly log: LogSink
}

/** 宿主对界面的环境检查入口。 */
export interface EnvCheckService {
  /**
   * 处理 `env.check`。
   * @param method - 方法名；不是 `env.check` 时返回 unknown-method。
   * @param params - `{ workspaceRoot }`。
   * @returns 检查报告或带错误码的失败。
   */
  handle(method: string, params: unknown): Promise<RpcResult<EnvCheckReport>>
}

/**
 * 创建环境检查服务。
 * @param deps - 探测、文件、技能清单、时钟与日志出口。
 * @returns 环境检查服务。
 */
export function createEnvCheckService(deps: EnvCheckServiceDeps): EnvCheckService {
  const pending = new Map<string, Promise<RpcResult<EnvCheckReport>>>()

  return {
    handle(method, params) {
      if (method !== RPC_METHODS.envCheck) {
        return Promise.resolve(failure(ERROR_CODES.unknownMethod, `未知方法：${method}`))
      }

      const workspaceRoot = readWorkspaceRoot(params)
      if (workspaceRoot === undefined) {
        return Promise.resolve(
          failure(ERROR_CODES.invalidParams, '缺少非空的 workspaceRoot 参数。'),
        )
      }

      // 同一工作区已有检查在跑：复用同一个 Promise，避免并发探测。
      const running = pending.get(workspaceRoot)
      if (running !== undefined) return running

      const task = runCheck(deps, workspaceRoot)
      pending.set(workspaceRoot, task)
      void task.then(
        () => {
          pending.delete(workspaceRoot)
        },
        () => {
          pending.delete(workspaceRoot)
        },
      )
      return task
    },
  }
}

async function runCheck(
  deps: EnvCheckServiceDeps,
  workspaceRoot: string,
): Promise<RpcResult<EnvCheckReport>> {
  const startedAt = deps.now()

  try {
    const facts = await collectFacts(deps, workspaceRoot)
    const items = buildEnvCheckItems(facts)
    const report: EnvCheckReport = {
      checkedAt: startedAt,
      backend: facts.backend.status === 'pass' ? facts.backend.choice.kind : null,
      items,
      capabilities: deps.capabilities(),
    }
    logSummary(deps, report, startedAt)
    return { ok: true, result: report }
  } catch {
    deps.log('warn', LOG_EVENTS.envCheck, {
      result: 'error',
      durationMs: Math.max(0, deps.now() - startedAt),
    })
    return failure(ERROR_CODES.internal, '环境检查时发生未预期的错误。')
  }
}

async function collectFacts(
  deps: EnvCheckServiceDeps,
  workspaceRoot: string,
): Promise<EnvCheckFacts> {
  const home = deps.files.homeDirectory()
  const homeOutcome: ProbeOutcome =
    home === undefined
      ? { status: 'fail', detail: '无法解析用户主目录', reason: 'home-unresolved' }
      : { status: 'pass', detail: home }

  // 主目录、后端、工作区与技能四项互不依赖，并发探测；命令行链等后端结果。
  const [backend, workspace, skills] = await Promise.all([
    probeBackend(deps, workspaceRoot),
    probeWorkspace(deps.files, workspaceRoot),
    home === undefined ? Promise.resolve(unprobedSkills()) : probeSkills(deps, workspaceRoot, home),
  ])
  const commands = await probeCommands(deps, workspaceRoot, backend)

  return {
    home: homeOutcome,
    backend: backend.outcome,
    workspace,
    cli: commands.cli,
    auth: commands.auth,
    repository: commands.repository,
    skills,
  }
}

interface BackendProbeResult {
  readonly outcome: BackendProbeOutcome
  readonly remote: RepositoryAddress | undefined
}

async function probeBackend(
  deps: EnvCheckServiceDeps,
  workspaceRoot: string,
): Promise<BackendProbeResult> {
  try {
    const result = await deps.deadline(deps.resolve(workspaceRoot))
    if (!result.ok) {
      return {
        outcome: { status: 'fail', detail: '后端判定超时', reason: 'timeout' },
        remote: undefined,
      }
    }

    const resolved = result.value
    return {
      outcome: {
        status: 'pass',
        choice: resolved.choice,
        detail: `${resolved.choice.source}:${resolved.choice.kind}`,
      },
      remote: resolved.address,
    }
  } catch (error) {
    if (error instanceof TrackerError) {
      if (error.code === 'glab-missing') {
        return {
          outcome: {
            status: 'fail',
            detail: '未找到 glab，GitLab 后端不可用',
            reason: 'backend-cli-missing',
          },
          remote: undefined,
        }
      }
      return {
        outcome: { status: 'fail', detail: error.message, reason: 'backend-unavailable' },
        remote: undefined,
      }
    }
    return {
      outcome: { status: 'fail', detail: '无法判定工单后端', reason: 'backend-unavailable' },
      remote: undefined,
    }
  }
}

async function probeWorkspace(files: EnvFiles, workspaceRoot: string): Promise<ProbeOutcome> {
  const exists = await files.isFile(join(workspaceRoot, TRACKER_DOC))
  return exists
    ? { status: 'pass', detail: `${TRACKER_DOC} 存在` }
    : { status: 'fail', detail: `未找到 ${TRACKER_DOC}`, reason: 'workspace-uninitialized' }
}

interface CommandFacts {
  readonly cli: ProbeOutcome | undefined
  readonly auth: ProbeOutcome | undefined
  readonly repository: ProbeOutcome | undefined
}

async function probeCommands(
  deps: EnvCheckServiceDeps,
  workspaceRoot: string,
  backend: BackendProbeResult,
): Promise<CommandFacts> {
  const none: CommandFacts = { cli: undefined, auth: undefined, repository: undefined }
  const outcome = backend.outcome
  if (outcome.status !== 'pass') return none
  // Gitea 与本地 Markdown 没有命令行探测：前者尚未接入，后者本来就不需要。
  if (outcome.choice.kind === 'markdown' || outcome.choice.kind === 'gitea') return none

  const probe = outcome.choice.kind === 'github' ? deps.github : deps.gitlab
  const remote = backend.remote

  const cli = await guarded(deps, probe.cli(workspaceRoot), '命令行检查失败')
  if (cli.status !== 'pass') return { cli, auth: undefined, repository: undefined }

  const auth = await guarded(deps, probe.auth(workspaceRoot, remote), '登录检查失败')
  if (auth.status !== 'pass') return { cli, auth, repository: undefined }

  const repository = await guarded(deps, probe.repository(workspaceRoot, remote), '仓库检查失败')
  return { cli, auth, repository }
}

async function guarded(
  deps: EnvCheckServiceDeps,
  task: Promise<ProbeOutcome>,
  failureDetail: string,
): Promise<ProbeOutcome> {
  try {
    const result = await deps.deadline(task)
    return result.ok ? result.value : { status: 'fail', detail: '探测超时', reason: 'timeout' }
  } catch {
    return { status: 'fail', detail: failureDetail, reason: 'probe-failed' }
  }
}

function unprobedSkills(): readonly SkillProbeFact[] {
  return REQUIRED_SKILLS.map((name) => ({ name, outcome: undefined }))
}

async function probeSkills(
  deps: EnvCheckServiceDeps,
  workspaceRoot: string,
  home: string,
): Promise<readonly SkillProbeFact[]> {
  const directories = [
    ...SKILL_DIRECTORIES.map((directory) => join(workspaceRoot, directory)),
    ...SKILL_DIRECTORIES.map((directory) => join(home, directory)),
  ]
  const catalog = await readCatalog(deps, workspaceRoot)

  return Promise.all(
    REQUIRED_SKILLS.map((name) => probeSkill(deps.files, name, directories, catalog)),
  )
}

async function readCatalog(
  deps: EnvCheckServiceDeps,
  workspaceRoot: string,
): Promise<readonly string[] | undefined> {
  if (deps.skills === undefined) return undefined

  try {
    const result = await deps.deadline(deps.skills.names(workspaceRoot))
    return result.ok ? result.value : undefined
  } catch {
    // 技能清单不可用不影响其他检查，降级为只查磁盘。
    return undefined
  }
}

async function probeSkill(
  files: EnvFiles,
  name: string,
  directories: readonly string[],
  catalog: readonly string[] | undefined,
): Promise<{ readonly name: string; readonly outcome: ProbeOutcome }> {
  if (catalog?.includes(name) === true) {
    return { name, outcome: { status: 'pass', detail: 'DSH 技能清单已收录' } }
  }

  const found = await findSkillFile(files, name, directories)
  if (found === undefined) {
    return {
      name,
      outcome: {
        status: 'fail',
        detail: 'DSH 技能清单与磁盘目录都没有找到',
        reason: 'skill-missing',
      },
    }
  }
  return {
    name,
    outcome: { status: 'pass', detail: `${found}（DSH 技能清单未收录，按磁盘判定）` },
  }
}

async function findSkillFile(
  files: EnvFiles,
  name: string,
  directories: readonly string[],
): Promise<string | undefined> {
  for (const directory of directories) {
    const path = join(directory, name, 'SKILL.md')
    if (await files.isFile(path)) return path
  }
  return undefined
}

function logSummary(deps: EnvCheckServiceDeps, report: EnvCheckReport, startedAt: number): void {
  let passed = 0
  let failed = 0
  let skipped = 0
  for (const item of report.items) {
    if (item.status === 'pass') passed += 1
    else if (item.status === 'fail') failed += 1
    else skipped += 1
  }

  deps.log('info', LOG_EVENTS.envCheck, {
    result: 'ok',
    backend: report.backend,
    durationMs: Math.max(0, deps.now() - startedAt),
    passed,
    failed,
    skipped,
  })
}

function readWorkspaceRoot(params: unknown): string | undefined {
  if (typeof params !== 'object' || params === null) return undefined
  if (!('workspaceRoot' in params)) return undefined
  const root = params.workspaceRoot
  return typeof root === 'string' && root.length > 0 ? root : undefined
}

function failure(code: ErrorCode, message: string): RpcResult<EnvCheckReport> {
  return { ok: false, error: { code, message } }
}
