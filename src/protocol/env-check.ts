/**
 * 环境检查的 RPC 契约：检查项 id、建议码、能力诊断 id 与必需技能。
 * 只放类型和常量；判定规则在 core，探测在 adapters，组装在 host。
 */
import type { BackendKind } from './backend.ts'

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
  /** 一项必需技能已安装；subject 是技能名。 */
  skill: 'skill',
} as const

/** 检查项 id 的联合类型。 */
export type EnvCheckId = (typeof ENV_CHECK_IDS)[keyof typeof ENV_CHECK_IDS]

/** 检查项的三种状态。 */
export type EnvCheckStatus = 'pass' | 'fail' | 'skipped'

/** 失败时给出的建议码；具体文案在界面。 */
export const ENV_SUGGESTIONS = {
  installCli: 'install-cli',
  loginCli: 'login-cli',
  checkRepositoryAccess: 'check-repository-access',
  checkRemoteAddress: 'check-remote-address',
  checkNetwork: 'check-network',
  checkLogs: 'check-logs',
  checkHome: 'check-home',
  runSetupSkills: 'run-setup-skills',
  installSkill: 'install-skill',
  selectBackend: 'select-backend',
} as const

/** 建议码的联合类型。 */
export type SuggestionCode = (typeof ENV_SUGGESTIONS)[keyof typeof ENV_SUGGESTIONS]

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
  /** 失败时的建议码；通过和跳过时为 null。 */
  readonly suggestion: SuggestionCode | null
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
 * 面板用到的 mattpocock/skills 技能名。提示词模板和必需技能清单都从这里取，
 * 两处不会脱节。
 */
export const PANEL_SKILLS = {
  setup: 'setup-matt-pocock-skills',
  toSpec: 'to-spec',
  triage: 'triage',
  diagnosingBugs: 'diagnosing-bugs',
  implement: 'implement',
} as const

/** 环境检查逐项核对的技能，顺序固定。 */
export const REQUIRED_SKILLS = [
  PANEL_SKILLS.setup,
  PANEL_SKILLS.toSpec,
  PANEL_SKILLS.triage,
  PANEL_SKILLS.diagnosingBugs,
  PANEL_SKILLS.implement,
] as const
