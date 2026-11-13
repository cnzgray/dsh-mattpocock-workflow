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
  EnvCliBackend,
  EnvRemedy,
} from '../protocol/env-check.ts'
import type { BackendChoice } from './backend.ts'
import type { RepositoryAddress } from './remote.ts'

/**
 * 探测失败的语义原因。解决方式由 {@link remedyFor} 按原因和上下文选择，
 * 界面再把解决码渲染成中文文案与动作。
 */
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
  | 'backend-unavailable'

/** 一次探测的结果。依据文本只写结论，不回显命令原始输出。 */
export type ProbeOutcome =
  | { readonly status: 'pass'; readonly detail: string }
  | {
      readonly status: 'fail'
      readonly detail: string
      readonly reason: ProbeFailureReason
      /**
       * 缺 CLI 时对应的后端。解决据此给出该后端自己的安装命令，
       * 界面不需要解析依据文本。
       */
      readonly backend?: EnvCliBackend
    }

/** 后端判定的探测结果：成功时带上选中的后端与依据。 */
export type BackendProbeOutcome =
  | { readonly status: 'pass'; readonly choice: BackendChoice; readonly detail: string }
  | {
      readonly status: 'fail'
      readonly detail: string
      readonly reason: ProbeFailureReason
      /** 判定阶段就缺少该后端的 CLI；解决据此点名后端。 */
      readonly backend?: EnvCliBackend
    }

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
  /**
   * 初始化工作区的技能名。工作区未初始化时，靠它判断该给「初始化工作区」
   * 还是先「安装技能」。
   */
  readonly setupSkill: string
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

interface Placed {
  readonly item: EnvCheckItem
  /** 跳过项要指向的根因：最先失败的那一项。 */
  readonly rootCause: EnvCheckRef | null
}

/** 选择解决方式时除失败原因外还需要的事实。 */
interface RemedyFacts {
  readonly setupSkill: string
  /** 初始化技能本身是否已判定为缺失。 */
  readonly setupMissing: boolean
}

/**
 * 产出固定顺序的检查项。
 * @param facts - 各项探测结果。
 * @returns 顺序为：主目录、后端、命令行、登录、仓库可达、工作区、技能。
 */
export function buildEnvCheckItems(facts: EnvCheckFacts): readonly EnvCheckItem[] {
  const items: EnvCheckItem[] = []
  const remedyFacts: RemedyFacts = {
    setupSkill: facts.setupSkill,
    setupMissing:
      facts.skills.find((skill) => skill.name === facts.setupSkill)?.outcome?.status === 'fail',
  }

  const place = (
    id: EnvCheckId,
    subject: string | null,
    outcome: ProbeOutcome | undefined,
    prereq: Placed | null,
  ): Placed => {
    const placed = placeItem(id, subject, outcome, prereq, remedyFacts)
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
        remedy: null,
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
  remedyFacts: RemedyFacts,
): Placed {
  const self: EnvCheckRef = { id, subject }

  if (prereq !== null && prereq.item.status !== 'pass') {
    const blockedBy = prereq.rootCause ?? refOf(prereq.item)
    // 跳过项不产出 remedy：根因项那一条已经给出可执行的解决。
    return {
      item: {
        ...self,
        status: 'skipped',
        detail: '未执行检查',
        remedy: null,
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
        remedy: { code: 'check-logs', subject: null },
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
        remedy: null,
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
      remedy: remedyFor(self, outcome, remedyFacts),
      blockedBy: null,
    },
    rootCause: self,
  }
}

/**
 * 按失败原因与已知上下文选一条解决。
 * @param item - 失败项自身，给出默认可用的 subject。
 * @param outcome - 失败的探测结果。
 * @param context - 初始化技能的状态。
 * @returns 解决码与对象；不含文案。
 */
function remedyFor(
  item: EnvCheckRef,
  outcome: Extract<ProbeOutcome, { status: 'fail' }>,
  remedyFacts: RemedyFacts,
): EnvRemedy {
  // 探测点名的后端优先，其次用检查项自己的 subject。
  const subject = outcome.backend ?? item.subject

  switch (outcome.reason) {
    case 'cli-missing':
      return { code: 'install-cli', subject }
    case 'cli-unauthenticated':
      return { code: 'login-cli', subject }
    case 'skill-missing':
      return { code: 'install-skill', subject: item.subject }
    case 'workspace-uninitialized':
      // 初始化技能本身缺失时先装技能，不引导用户运行一个不存在的技能。
      return remedyFacts.setupMissing
        ? { code: 'install-skill', subject: remedyFacts.setupSkill }
        : { code: 'init-workspace', subject: null }
    case 'repository-forbidden':
      return { code: 'check-repository-access', subject: null }
    case 'repository-not-found':
      return { code: 'check-remote-address', subject: null }
    case 'repository-network':
      return { code: 'check-network', subject: null }
    case 'timeout':
    case 'probe-failed':
      return { code: 'retry', subject: null }
    case 'home-unresolved':
      return { code: 'check-home', subject: null }
    case 'backend-unavailable':
      return { code: 'fix-backend', subject: null }
  }
}

function toProbeOutcome(outcome: BackendProbeOutcome): ProbeOutcome {
  return outcome.status === 'pass'
    ? { status: 'pass', detail: outcome.detail }
    : {
        status: 'fail',
        detail: outcome.detail,
        reason: outcome.reason,
        ...(outcome.backend === undefined ? {} : { backend: outcome.backend }),
      }
}

function refOf(item: EnvCheckItem): EnvCheckRef {
  return { id: item.id, subject: item.subject }
}
