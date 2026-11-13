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
  | 'local-issues-missing'
  | 'local-issues-empty'
  | 'local-issues-invalid'

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
      /** 判定阶段就卡在这个后端上；解决据此点名后端。 */
      readonly backend?: EnvCliBackend
    }

/**
 * 本地工单目录的探测事实：适配器只报告看到了什么，依据文本由判定层生成。
 * `found` 与 `unparsable` 携带相对工作区的路径。
 */
export type LocalIssuesFact =
  | { readonly status: 'found'; readonly files: readonly string[] }
  | { readonly status: 'no-scratch' }
  | { readonly status: 'no-files' }
  | { readonly status: 'unparsable'; readonly files: readonly string[] }
  | { readonly status: 'probe-failed' }

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
  /**
   * 本地工单目录的探测事实。本地工单只服务本地 Markdown 后端：判定为托管后端
   * 时宿主不探测，这里为 undefined；后端尚未判定时仍要探测，避免误藏。
   */
  readonly localIssues: LocalIssuesFact | undefined
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
 * 后端命令行探测能力。GitHub、GitLab 与 Gitea 各实现一份，互不依赖。
 * 所有方法都不抛错：命令失败被翻译成 {@link ProbeOutcome}。
 */
export interface EnvCommandProbe {
  readonly kind: EnvCliBackend
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
 * 已判定的托管后端；本地 Markdown 或后端尚未判定时缺省。
 * 判定与「要不要检查本地工单目录」共用同一处分类，后端集合变化时只需改这里。
 */
function hostedBackend(backend: BackendProbeOutcome): EnvCliBackend | undefined {
  return backend.status === 'pass' && backend.choice.kind !== 'markdown'
    ? backend.choice.kind
    : undefined
}

/**
 * 本地工单目录只在会读它的后端下检查：本地 Markdown；后端尚未判定时也可能回退
 * 本地，一并检查。托管后端的工单列表完全来自远端，探测本地文件没有意义。
 * @param backend - 后端判定结果。
 * @returns 是否产出并探测「本地工单目录可用」。
 */
export function shouldCheckLocalIssues(backend: BackendProbeOutcome): boolean {
  return hostedBackend(backend) === undefined
}

/**
 * 产出固定顺序的检查项。
 * @param facts - 各项探测结果。
 * @returns 顺序为：主目录、后端、命令行、登录、仓库可达、工作区、本地工单目录（仅本地
 * Markdown 或后端未判定）、技能。
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
  // 判定失败但已锁定后端时，subject 让标题和后继跳过项都点名那个后端。
  const candidate = facts.backend.status === 'fail' ? (facts.backend.backend ?? null) : null
  const backend = place('backend', candidate, toProbeOutcome(facts.backend), null)

  const hosted = hostedBackend(facts.backend)
  if (hosted !== undefined) {
    const cli = place('cli', hosted, facts.cli, backend)
    const auth = place('auth', hosted, facts.auth, cli)
    place('repository', hosted, facts.repository, auth)
  } else if (facts.backend.status !== 'pass') {
    const cli = place('cli', candidate, undefined, backend)
    const auth = place('auth', candidate, undefined, cli)
    place('repository', candidate, undefined, auth)
  }

  place('workspace', null, facts.workspace, null)
  if (shouldCheckLocalIssues(facts.backend)) {
    const localIssues =
      facts.localIssues === undefined ? undefined : localIssuesOutcome(facts.localIssues)
    place('local-issues', null, localIssues, null)
  }
  for (const skill of facts.skills) {
    place('skill', skill.name, skill.outcome, home)
  }

  return items
}

const LISTED_PATHS = 5

function localIssuesOutcome(fact: LocalIssuesFact): ProbeOutcome {
  switch (fact.status) {
    case 'found':
      return {
        status: 'pass',
        detail: `找到 ${String(fact.files.length)} 张本地工单：${pathList(fact.files)}`,
      }
    case 'no-scratch':
      return {
        status: 'fail',
        detail: '工作区里没有 .scratch 目录',
        reason: 'local-issues-missing',
      }
    case 'no-files':
      return {
        status: 'fail',
        detail: '.scratch 下没有工单文件，工单应放在 .scratch/<feature>/issues/ 下',
        reason: 'local-issues-empty',
      }
    case 'unparsable':
      return {
        status: 'fail',
        detail: `工单文件缺少可解析的 Status: 行：${pathList(fact.files)}`,
        reason: 'local-issues-invalid',
      }
    case 'probe-failed':
      return { status: 'fail', detail: '本地工单目录探测失败', reason: 'probe-failed' }
  }
}

/** 最多列出几个路径；其余用数量收口，避免一条依据撑满面板。 */
function pathList(files: readonly string[]): string {
  const shown = files.slice(0, LISTED_PATHS).join('、')
  return files.length > LISTED_PATHS ? `${shown} 等 ${String(files.length)} 个` : shown
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
 * @param remedyFacts - 初始化技能的状态。
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
    case 'local-issues-missing':
    case 'local-issues-empty':
    case 'local-issues-invalid':
      return { code: 'place-local-issues', subject: null }
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
