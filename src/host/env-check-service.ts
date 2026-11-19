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
import type { LocalIssuesProbe } from '../adapters/markdown/env.ts'
import type {
  BackendProbeOutcome,
  EnvCheckFacts,
  EnvCommandProbe,
  LocalIssuesFact,
  ProbeOutcome,
  SkillProbeFact,
} from '../core/env-check.ts'
import { buildEnvCheckItems, shouldCheckLocalIssues } from '../core/env-check.ts'
import type { BackendChoice } from '../core/backend.ts'
import type { RepositoryAddress } from '../core/remote.ts'
import { TrackerError } from '../core/tracker-error.ts'
import type { BackendKind } from '../protocol/backend.ts'
import { LOG_EVENTS } from '../protocol/log-events.ts'
import {
  PANEL_SKILLS,
  REQUIRED_SKILLS,
  type CapabilityDiagnostic,
  type EnvCheckReport,
} from '../protocol/env-check.ts'
import {
  ERROR_BACKENDS,
  ERROR_CODES,
  RPC_METHODS,
  type ErrorCode,
  type RpcResult,
} from '../protocol/tracker.ts'
import type { BackendResolver } from './backend-resolver.ts'
import type { LogSink } from './log.ts'
import type { ProbeDeadline } from './probe-deadline.ts'

/** 工作区初始化后的工单操作说明；存在即视为已初始化。 */
const TRACKER_DOC = 'docs/agents/issue-tracker.md'

/** 成功报告缓存时长：10 分钟内重复检查按仓库身份直接命中。 */
const ENV_CHECK_CACHE_TTL_MS = 10 * 60 * 1000

/** 连续失败的退避首档：第一次失败后 8 秒内不重复探测。 */
const ENV_CHECK_BACKOFF_START_MS = 8_000

/** 连续失败的退避上限。 */
const ENV_CHECK_BACKOFF_MAX_MS = 5 * 60 * 1000

/** 按工作区的缓存状态：成功报告、连续失败计数与上一次失败报告。 */
interface WorkspaceCache {
  /** 全通过的成功报告与它的仓库身份；身份判定失败或未全通过时为空。 */
  readonly success: {
    readonly report: EnvCheckReport
    readonly identity: string
    readonly expiresAt: number
  } | null
  /** 连续失败次数（全通过的报告把它清零）。 */
  readonly failures: number
  /** 最近一次探测完成的时刻，退避窗口从它起算。 */
  readonly lastRunAt: number
  /** 最近一次失败报告：退避窗口内原样返回，不重新探测。 */
  readonly lastFailure: EnvCheckReport | null
}

/**
 * 磁盘上可能存放技能的目录，按顺序查找；工作区优先，其次用户主目录。
 *
 * 只列 DSH 文件系统技能提供方真正扫描的根：`<root>/.dsh/skills` 与
 * `<root>/.agents/skills`。`.claude/skills` 不在其中——文件在那里 DSH 也不会
 * 收录，`/技能名` 手势解析不到，按它判定会造成假通过。
 */
const SKILL_DIRECTORIES: readonly string[] = ['.dsh/skills', '.agents/skills']

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
  readonly gitea: EnvCommandProbe
  readonly files: EnvFiles
  /** 本地工单目录探测；只在本地 Markdown 或后端未判定时调用。 */
  readonly localIssues: LocalIssuesProbe
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
  const cache = new Map<string, WorkspaceCache>()

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

      const now = deps.now()
      const state = cache.get(workspaceRoot)
      const cached = state?.success
      if (cached !== undefined && cached !== null && now < cached.expiresAt) {
        // 缓存按工作区 + 仓库身份键控：先解析当前身份，对不上（换远端/换后端）就重跑，
        // 重跑结果照常回写缓存，让新身份重新武装。
        const task = serveCached(deps, workspaceRoot, cached).then((outcome) => {
          cache.set(workspaceRoot, nextCacheState(state, outcome, deps.now()))
          return outcome.result
        })
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
      }

      if (state !== undefined && state.failures > 0 && state.lastFailure !== null) {
        // 连续失败按递增间隔退避：窗口内原样返回上一次失败报告，不重复探测。
        const backoff = Math.min(
          ENV_CHECK_BACKOFF_START_MS * 2 ** (state.failures - 1),
          ENV_CHECK_BACKOFF_MAX_MS,
        )
        if (now - state.lastRunAt < backoff) {
          return Promise.resolve({ ok: true, result: state.lastFailure })
        }
      }

      const task = runCheck(deps, workspaceRoot).then((outcome) => {
        cache.set(workspaceRoot, nextCacheState(state, outcome, deps.now()))
        return outcome.result
      })
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

/** 缓存命中后的身份核对：身份一致原样返回，不一致重跑一次完整检查。 */
async function serveCached(
  deps: EnvCheckServiceDeps,
  workspaceRoot: string,
  cached: { readonly report: EnvCheckReport; readonly identity: string },
): Promise<CheckOutcome> {
  const probe = await probeBackend(deps, workspaceRoot)
  const identity = identityOf(probe)
  if (identity !== null && identity === cached.identity) {
    return { result: { ok: true, result: cached.report }, identity: cached.identity }
  }
  return runCheck(deps, workspaceRoot)
}

/** 一次完整检查的结果与随之确定的仓库身份。 */
interface CheckOutcome {
  readonly result: RpcResult<EnvCheckReport>
  readonly identity: string | null
}

/** 由旧状态与本次检查结果推出新缓存状态。 */
function nextCacheState(
  previous: WorkspaceCache | undefined,
  outcome: CheckOutcome,
  now: number,
): WorkspaceCache {
  const report = outcome.result.ok ? outcome.result.result : null
  if (report === null) return previous ?? emptyCache(now)
  const failed = report.items.some((item) => item.status === 'fail')
  if (!failed) {
    // 全通过才缓存：任何失败都允许下一次立刻重试，验证修复。
    return {
      success:
        outcome.identity === null
          ? null
          : { report, identity: outcome.identity, expiresAt: now + ENV_CHECK_CACHE_TTL_MS },
      failures: 0,
      lastRunAt: now,
      lastFailure: null,
    }
  }
  return {
    success: previous?.success ?? null,
    failures: (previous?.failures ?? 0) + 1,
    lastRunAt: now,
    lastFailure: report,
  }
}

function emptyCache(now: number): WorkspaceCache {
  return { success: null, failures: 0, lastRunAt: now, lastFailure: null }
}

/** 仓库身份：后端类型 + 仓库路径；判定失败时为空（不拿来当缓存键）。 */
function identityOf(probe: BackendProbeResult): string | null {
  if (probe.outcome.status !== 'pass') return null
  const kind = probe.outcome.choice.kind
  return `${kind}@${kind === 'markdown' ? '' : (probe.remote?.path ?? '')}`
}

async function runCheck(deps: EnvCheckServiceDeps, workspaceRoot: string): Promise<CheckOutcome> {
  const startedAt = deps.now()

  try {
    const collected = await collectFacts(deps, workspaceRoot)
    const items = buildEnvCheckItems(collected.facts)
    const report: EnvCheckReport = {
      checkedAt: startedAt,
      backend:
        collected.facts.backend.status === 'pass' ? collected.facts.backend.choice.kind : null,
      repository: collected.repository,
      items,
      capabilities: deps.capabilities(),
    }
    logSummary(deps, report, startedAt)
    return { result: { ok: true, result: report }, identity: collected.identity }
  } catch {
    deps.log('warn', LOG_EVENTS.envCheck, {
      result: 'error',
      durationMs: Math.max(0, deps.now() - startedAt),
    })
    return {
      result: failure(ERROR_CODES.internal, '环境检查时发生未预期的错误。'),
      identity: null,
    }
  }
}

interface CollectedFacts {
  readonly facts: EnvCheckFacts
  /** 后端判定出的仓库路径；本地 Markdown 或判定失败时为 null。 */
  readonly repository: string | null
  /** 本次判定出的仓库身份；判定失败时为空。 */
  readonly identity: string | null
}

async function collectFacts(
  deps: EnvCheckServiceDeps,
  workspaceRoot: string,
): Promise<CollectedFacts> {
  const home = deps.files.homeDirectory()
  const homeOutcome: ProbeOutcome =
    home === undefined
      ? { status: 'fail', detail: '无法解析用户主目录', reason: 'home-unresolved' }
      : { status: 'pass', detail: home }

  // 主目录、后端、工作区与技能互不依赖，并发探测；本地工单目录与命令行链等后端结果。
  const [backend, workspace, skills] = await Promise.all([
    probeBackend(deps, workspaceRoot),
    probeWorkspace(deps.files, workspaceRoot),
    home === undefined ? Promise.resolve(unprobedSkills()) : probeSkills(deps, workspaceRoot, home),
  ])
  // 托管后端的工单完全来自远端：不探测本地目录，也就不会产出这一项。
  const [commands, localIssues] = await Promise.all([
    probeCommands(deps, workspaceRoot, backend),
    shouldCheckLocalIssues(backend.outcome)
      ? probeLocalIssues(deps, workspaceRoot)
      : Promise.resolve(undefined),
  ])
  const decided = backend.outcome.status === 'pass' ? backend.outcome.choice.kind : null

  return {
    facts: {
      home: homeOutcome,
      backend: backend.outcome,
      workspace,
      localIssues,
      cli: commands.cli,
      auth: commands.auth,
      repository: commands.repository,
      skills,
      setupSkill: PANEL_SKILLS.setup,
    },
    repository: decided === null || decided === 'markdown' ? null : (backend.remote?.path ?? null),
    identity: identityOf(backend),
  }
}

async function probeLocalIssues(
  deps: EnvCheckServiceDeps,
  workspaceRoot: string,
): Promise<LocalIssuesFact> {
  try {
    const result = await deps.deadline(deps.localIssues(workspaceRoot))
    return result.ok ? result.value : { status: 'probe-failed' }
  } catch {
    return { status: 'probe-failed' }
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
    // 只能回退本地、但差一步就能用上托管后端：判定项点名候选后端与原因。
    if (resolved.choice.kind === 'markdown' && resolved.candidate !== undefined) {
      return {
        outcome: {
          status: 'fail',
          detail: resolved.candidate.detail,
          reason: resolved.candidate.reason,
          backend: resolved.candidate.kind,
        },
        remote: resolved.address,
      }
    }

    return {
      outcome: {
        status: 'pass',
        choice: resolved.choice,
        detail: backendDetail(resolved.choice, resolved.address),
      },
      remote: resolved.address,
    }
  } catch (error) {
    if (error instanceof TrackerError) {
      const backend = ERROR_BACKENDS[error.code]
      if (backend !== undefined) {
        // 环境类错误码的 message 是写好的说明，可以直接进报告；码尾区分缺工具与未登录。
        return {
          outcome: {
            status: 'fail',
            detail: error.message,
            reason: error.code.endsWith('-unauthenticated') ? 'cli-unauthenticated' : 'cli-missing',
            backend,
          },
          remote: undefined,
        }
      }
    }
    // 其余错误可能带命令输出，不进入报告；解决由 core 按原因选择。
    return {
      outcome: { status: 'fail', detail: '无法判定工单后端', reason: 'backend-unavailable' },
      remote: undefined,
    }
  }
}

function backendDetail(choice: BackendChoice, address: RepositoryAddress | undefined): string {
  const basis = `${choice.source}:${choice.kind}`
  // 判定来源之后补上远端主机：自建实例同名仓库很多，用户要能核对认的是哪一台。
  return address === undefined ? basis : `${basis}（${address.host}）`
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
  // 本地 Markdown 没有命令行探测；其余后端各用自己注入的探测。
  if (outcome.choice.kind === 'markdown') return none

  const probe = probeFor(deps, outcome.choice.kind)
  const remote = backend.remote

  const cli = await guarded(deps, probe.cli(workspaceRoot), '命令行检查失败')
  if (cli.status !== 'pass') return { cli, auth: undefined, repository: undefined }

  const auth = await guarded(deps, probe.auth(workspaceRoot, remote), '登录检查失败')
  if (auth.status !== 'pass') return { cli, auth, repository: undefined }

  const repository = await guarded(deps, probe.repository(workspaceRoot, remote), '仓库检查失败')
  return { cli, auth, repository }
}

function probeFor(
  deps: EnvCheckServiceDeps,
  kind: Exclude<BackendKind, 'markdown'>,
): EnvCommandProbe {
  switch (kind) {
    case 'github':
      return deps.github
    case 'gitlab':
      return deps.gitlab
    case 'gitea':
      return deps.gitea
  }
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
