/**
 * 环境检查的判定规则。宿主把每项的探测结果交进来，这里产出固定顺序的检查项：
 * 前置项没通过时，依赖它的后续项一律判为跳过，并记录根因。
 *
 * core 不做 IO；探测命令、读文件和技能清单都由 adapters / host 注入。
 */
import type {
  EnvCheckId,
  EnvCheckItem,
  EnvCheckRef,
  SuggestionCode,
} from '../protocol/env-check.ts'
import type { BackendChoice } from './backend.ts'
import type { RepositoryAddress } from './remote.ts'

/** 探测失败的语义原因。建议码由 {@link ADVICE} 映射，界面再渲染成中文。 */
export type ProbeFailureReason =
  | 'cli-missing'
  | 'cli-unauthenticated'
  | 'repository-forbidden'
  | 'repository-not-found'
  | 'repository-network'
  | 'probe-failed'
  | 'timeout'
  | 'home-unresolved'
  | 'workspace-uninitialized'
  | 'skill-missing'
  | 'backend-cli-missing'
  | 'backend-unavailable'

/** 一次探测的结果。依据文本只写结论，不回显命令原始输出。 */
export type ProbeOutcome =
  | { readonly status: 'pass'; readonly detail: string }
  | { readonly status: 'fail'; readonly detail: string; readonly reason: ProbeFailureReason }

/** 后端判定的探测结果：成功时带上选中的后端与依据。 */
export type BackendProbeOutcome =
  | { readonly status: 'pass'; readonly choice: BackendChoice; readonly detail: string }
  | { readonly status: 'fail'; readonly detail: string; readonly reason: ProbeFailureReason }

/** 一项技能的探测事实；主目录不可解析时 outcome 缺省。 */
export interface SkillProbeFact {
  readonly name: string
  readonly outcome: ProbeOutcome | undefined
}

/** 判定一次环境检查所需的全部探测结果。 */
export interface EnvCheckFacts {
  readonly home: ProbeOutcome
  readonly backend: BackendProbeOutcome
  readonly workspace: ProbeOutcome
  /** 以下三项在前置项未通过时不会探测，为 undefined。 */
  readonly cli: ProbeOutcome | undefined
  readonly auth: ProbeOutcome | undefined
  readonly repository: ProbeOutcome | undefined
  readonly skills: readonly SkillProbeFact[]
}

/**
 * 后端命令行探测能力。GitHub 和 GitLab 各实现一份，互不依赖。
 * 所有方法都不抛错：命令失败被翻译成 {@link ProbeOutcome}。
 */
export interface EnvCommandProbe {
  readonly kind: 'github' | 'gitlab'
  /** 可执行文件是否可用；依据写找到的路径。 */
  cli(workspaceRoot: string): Promise<ProbeOutcome>
  /** 是否已登录当前远端对应的实例。 */
  auth(workspaceRoot: string, remote: RepositoryAddress | undefined): Promise<ProbeOutcome>
  /** 当前仓库能否通过只读接口访问。 */
  repository(workspaceRoot: string, remote: RepositoryAddress | undefined): Promise<ProbeOutcome>
}

/** 失败原因到建议码的映射。只在这里维护，避免两处文案分叉。 */
const ADVICE: Readonly<Record<ProbeFailureReason, SuggestionCode>> = {
  'cli-missing': 'install-cli',
  'cli-unauthenticated': 'login-cli',
  'repository-forbidden': 'check-repository-access',
  'repository-not-found': 'check-remote-address',
  'repository-network': 'check-network',
  'probe-failed': 'check-logs',
  timeout: 'check-network',
  'home-unresolved': 'check-home',
  'workspace-uninitialized': 'run-setup-skills',
  'skill-missing': 'install-skill',
  'backend-cli-missing': 'install-cli',
  'backend-unavailable': 'select-backend',
}

interface Placed {
  readonly item: EnvCheckItem
  /** 跳过项要指向的根因：最先失败的那一项。 */
  readonly rootCause: EnvCheckRef | null
}

/**
 * 产出固定顺序的检查项。
 * @param facts - 各项探测结果。
 * @returns 顺序为：主目录、后端、命令行、登录、仓库可达、工作区、技能。
 */
export function buildEnvCheckItems(facts: EnvCheckFacts): readonly EnvCheckItem[] {
  const items: EnvCheckItem[] = []

  const place = (
    id: EnvCheckId,
    subject: string | null,
    outcome: ProbeOutcome | undefined,
    prereq: Placed | null,
  ): Placed => {
    const placed = placeItem(id, subject, outcome, prereq)
    items.push(placed.item)
    return placed
  }

  const home = place('home', null, facts.home, null)
  const backend = place('backend', null, toProbeOutcome(facts.backend), null)

  if (facts.backend.status === 'pass' && facts.backend.choice.kind === 'gitea') {
    // Gitea 的 CLI 检查还没接入：如实标成跳过，不冒用 gh / glab 的结论。
    for (const id of ['cli', 'auth', 'repository'] as const) {
      items.push({
        id,
        subject: 'gitea',
        status: 'skipped',
        detail: '暂不支持 Gitea 后端的环境检查',
        suggestion: null,
        blockedBy: null,
      })
    }
  } else if (facts.backend.status === 'pass' && facts.backend.choice.kind !== 'markdown') {
    const backendKind = facts.backend.choice.kind
    const cli = place('cli', backendKind, facts.cli, backend)
    const auth = place('auth', backendKind, facts.auth, cli)
    place('repository', backendKind, facts.repository, auth)
  } else if (backend.item.status !== 'pass') {
    const cli = place('cli', null, undefined, backend)
    const auth = place('auth', null, undefined, cli)
    place('repository', null, undefined, auth)
  }

  place('workspace', null, facts.workspace, null)
  for (const skill of facts.skills) {
    place('skill', skill.name, skill.outcome, home)
  }

  return items
}

function placeItem(
  id: EnvCheckId,
  subject: string | null,
  outcome: ProbeOutcome | undefined,
  prereq: Placed | null,
): Placed {
  const self: EnvCheckRef = { id, subject }

  if (prereq !== null && prereq.item.status !== 'pass') {
    const blockedBy = prereq.rootCause ?? refOf(prereq.item)
    return {
      item: {
        ...self,
        status: 'skipped',
        detail: '未执行检查',
        suggestion: null,
        blockedBy,
      },
      rootCause: blockedBy,
    }
  }

  if (outcome === undefined) {
    // 前置项已通过却没有结果属于调度缺陷：给出查日志的去向，不伪装成通过。
    return {
      item: {
        ...self,
        status: 'fail',
        detail: '探测没有返回结果',
        suggestion: ADVICE['probe-failed'],
        blockedBy: null,
      },
      rootCause: self,
    }
  }

  if (outcome.status === 'pass') {
    return {
      item: {
        ...self,
        status: 'pass',
        detail: outcome.detail,
        suggestion: null,
        blockedBy: null,
      },
      rootCause: null,
    }
  }

  return {
    item: {
      ...self,
      status: 'fail',
      detail: outcome.detail,
      suggestion: ADVICE[outcome.reason],
      blockedBy: null,
    },
    rootCause: self,
  }
}

function toProbeOutcome(outcome: BackendProbeOutcome): ProbeOutcome {
  return outcome.status === 'pass'
    ? { status: 'pass', detail: outcome.detail }
    : { status: 'fail', detail: outcome.detail, reason: outcome.reason }
}

function refOf(item: EnvCheckItem): EnvCheckRef {
  return { id: item.id, subject: item.subject }
}
