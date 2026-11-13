/**
 * 环境检查的 RPC 契约：检查项 id、解决码、能力诊断 id 与必需技能。
 * 只放类型和常量；判定规则在 core，探测在 adapters，组装在 host，
 * 解决码对应的文案与动作类型只在界面维护。
 */
import type { BackendKind } from './backend.ts'
import type { InjectableSkillAction } from './labels.ts'

/** 检查项的稳定 id。标题文案由界面按 id、后端和 subject 渲染。 */
export const ENV_CHECK_IDS = {
  /** 用户主目录可解析。 */
  home: 'home',
  /** 已选择工单后端。 */
  backend: 'backend',
  /** 后端对应的命令行工具已安装。 */
  cli: 'cli',
  /** 命令行工具已登录。 */
  auth: 'auth',
  /** 当前仓库可通过后端接口访问。 */
  repository: 'repository',
  /** 工作区已用 `setup-matt-pocock-skills` 初始化。 */
  workspace: 'workspace',
  /** 工作区里的本地工单目录可读；与后端无关。 */
  localIssues: 'local-issues',
  /** 一项必需技能已安装；subject 是技能名。 */
  skill: 'skill',
} as const

/** 检查项 id 的联合类型。 */
export type EnvCheckId = (typeof ENV_CHECK_IDS)[keyof typeof ENV_CHECK_IDS]

/** 检查项的三种状态。 */
export type EnvCheckStatus = 'pass' | 'fail' | 'skipped'

/** 有命令行工具的后端；安装与登录的解决按它选对应命令。 */
export type EnvCliBackend = Exclude<BackendKind, 'markdown'>

/**
 * 失败项的解决码。每个码在界面有唯一的文案和动作类型
 * （会话动作 / 命令 / 重试），有的还带一个次要链接。
 */
export const ENV_REMEDY_CODES = {
  /** 安装后端对应的命令行工具。 */
  installCli: 'install-cli',
  /** 登录后端对应的命令行工具。 */
  loginCli: 'login-cli',
  /** 本地工单目录缺失或不可读；按 `docs/local-issues.md` 放好工单文件。 */
  placeLocalIssues: 'place-local-issues',
  /** 安装一项必需技能；subject 是技能名。 */
  installSkill: 'install-skill',
  /** 用初始化技能初始化当前工作区。 */
  initWorkspace: 'init-workspace',
  /** 核对当前账号对仓库的访问权限。 */
  checkRepositoryAccess: 'check-repository-access',
  /** 核对 `origin` 的远端地址。 */
  checkRemoteAddress: 'check-remote-address',
  /** 检查网络与代理设置。 */
  checkNetwork: 'check-network',
  /** 检查并设置宿主进程的主目录。 */
  checkHome: 'check-home',
  /** 查看 DSH 日志。 */
  checkLogs: 'check-logs',
  /** 修复后端选择：远端地址或 CLI 登录。 */
  fixBackend: 'fix-backend',
  /** 重新检查一次。 */
  retry: 'retry',
} as const

/** 解决码的联合类型。 */
export type EnvRemedyCode = (typeof ENV_REMEDY_CODES)[keyof typeof ENV_REMEDY_CODES]

/**
 * 一条解决：怎么修，而不是一句建议。
 * 只包含解决码与对象，不含文案、命令和链接——那些都在界面。
 */
export interface EnvRemedy {
  readonly code: EnvRemedyCode
  /** 解决针对的对象：技能名或后端名；null 时沿用检查项自己的 subject。 */
  readonly subject: string | null
}

/** 指向一个具体检查项：id 加区分同一类的 subject（后端名或技能名）。 */
export interface EnvCheckRef {
  readonly id: EnvCheckId
  readonly subject: string | null
}

/** 一项检查的结果。 */
export interface EnvCheckItem extends EnvCheckRef {
  readonly status: EnvCheckStatus
  /** 判定依据：主目录路径、可执行文件路径、来源等。 */
  readonly detail: string
  /** 失败时的解决方式；通过项与跳过项为 null。 */
  readonly remedy: EnvRemedy | null
  /** 跳过时挡住它的根因项；其余情况为 null。 */
  readonly blockedBy: EnvCheckRef | null
}

/** 能力诊断的类别。 */
export type CapabilityCategory = 'host-service' | 'ui-extension'

/** 能力是否可用。 */
export type CapabilityState = 'present' | 'missing'

/** 一项能力诊断。 */
export interface CapabilityDiagnostic {
  readonly id: string
  readonly category: CapabilityCategory
  readonly status: CapabilityState
}

/** 宿主侧用到的 DSH 服务。 */
export const HOST_CAPABILITY_IDS = ['subprocess', 'timer', 'connection', 'skills'] as const

/** 宿主服务 id。 */
export type HostCapabilityId = (typeof HOST_CAPABILITY_IDS)[number]

/** 界面侧用到的 DSH 服务和扩展点。 */
export const UI_CAPABILITY_IDS = [
  'slots',
  'sidebarRightTabs',
  'sessions',
  'conversation',
  'sidebar.right.pane.tab',
  'sidebar.right.pane.tab.title',
] as const

/** 界面扩展点 id。 */
export type UiCapabilityId = (typeof UI_CAPABILITY_IDS)[number]

/** 一次环境检查的结果。 */
export interface EnvCheckReport {
  /** 检查时间（毫秒时间戳）。 */
  readonly checkedAt: number
  /** 判定出的后端；后端判定失败时为 null。 */
  readonly backend: BackendKind | null
  /**
   * 判定出的仓库标识：GitHub `owner/name`，GitLab 含嵌套 group 的完整项目路径；
   * 本地 Markdown 或后端判定失败时为 null。解决里的命令靠它点名具体仓库。
   */
  readonly repository: string | null
  /** 固定顺序的检查项。 */
  readonly items: readonly EnvCheckItem[]
  /** 宿主侧能力诊断；界面会再合并自己探测到的扩展点。 */
  readonly capabilities: readonly CapabilityDiagnostic[]
}

/** `env.check` 的参数。 */
export interface EnvCheckParams {
  /** 当前工作区根目录。 */
  readonly workspaceRoot: string
}

/**
 * 面板用到的 mattpocock/skills 技能名。提示词模板、流程定义和必需技能清单都从这里取，
 * 不会写错名字。`REQUIRED_SKILLS` 只列处理阶段的前提；`wayfinder` 是按需出现的
 * 处理命令，缺装时由建票命令的下一步建议引导用户安装，不参与环境检查。
 */
export const PANEL_SKILLS = {
  setup: 'setup-matt-pocock-skills',
  grillWithDocs: 'grill-with-docs',
  toSpec: 'to-spec',
  toTickets: 'to-tickets',
  triage: 'triage',
  diagnosingBugs: 'diagnosing-bugs',
  wayfinder: 'wayfinder',
  implement: 'implement',
} as const

/** 面板用到的技能名之一。提示词模板用它，写错技能名会在类型检查时失败。 */
export type PanelSkill = (typeof PANEL_SKILLS)[keyof typeof PANEL_SKILLS]

/**
 * 环境检查逐项核对的技能，顺序按工作流：先初始化工作区，再是需求链
 * （访谈 → 规格 → 拆票）、缺陷链（定性 → 诊断）与实现。
 */
export const REQUIRED_SKILLS = [
  PANEL_SKILLS.setup,
  PANEL_SKILLS.grillWithDocs,
  PANEL_SKILLS.toSpec,
  PANEL_SKILLS.toTickets,
  PANEL_SKILLS.triage,
  PANEL_SKILLS.diagnosingBugs,
  PANEL_SKILLS.implement,
] as const

/**
 * 技能动作到面板技能名的映射。只列可注入的动作，`none` 没有对应技能。
 * core 判定的动作 id 必须都能在这里查到（宿主层有一致性测试）。
 */
export const SKILL_ACTION_SKILLS = {
  implement: PANEL_SKILLS.implement,
  diagnose: PANEL_SKILLS.diagnosingBugs,
  triage: PANEL_SKILLS.triage,
} as const satisfies Record<InjectableSkillAction, string>
