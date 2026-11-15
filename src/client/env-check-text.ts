/**
 * 环境检查的界面文案。宿主只送 id、后端、subject 和解决码，标题、能力说明
 * 都在这里按词典键拼，文案只维护一处。主题相关的样式不在这里。
 */
import type { BackendKind } from '../protocol/backend.ts'
import type {
  CapabilityDiagnostic,
  EnvCheckItem,
  HostCapabilityId,
  UiCapabilityId,
} from '../protocol/env-check.ts'
import { backendLabel } from './backend-label.ts'
import type { Translate } from './i18n-runtime.ts'
import type { MessageKey } from './messages.ts'

/** 环境检查顶部的后端标记；本地后端写全名，避免与“没有后端”混淆。 */
export function envBackendLabel(backend: BackendKind | null, t: Translate): string {
  if (backend === null) return t('backend.undetermined')
  return backend === 'markdown' ? t('backend.markdownLong') : backendLabel(backend, t)
}

/** 后端 subject 的显示名：已知后端走短名，未知值原样显示。 */
function backendName(subject: string, t: Translate): string {
  return subject === 'github' ||
    subject === 'gitlab' ||
    subject === 'gitea' ||
    subject === 'markdown'
    ? backendLabel(subject, t)
    : subject
}

/** 后端名到标题键的映射。 */
const CLI_TITLES: Readonly<
  Record<string, { readonly cli: MessageKey; readonly auth: MessageKey }>
> = {
  github: { cli: 'env.title.cliGithub', auth: 'env.title.authGithub' },
  gitlab: { cli: 'env.title.cliGitlab', auth: 'env.title.authGitlab' },
  gitea: { cli: 'env.title.cliGitea', auth: 'env.title.authGitea' },
}

/**
 * 检查项的标题，写成该项应达到的状态。
 * @param item - 检查结果。
 * @param t - 翻译入口；省略时用内置中文。
 * @returns 标题。
 */
export function envCheckTitle(item: EnvCheckItem, t: Translate): string {
  switch (item.id) {
    case 'home':
      return t('env.title.home')
    case 'backend':
      // 带候选后端时点名它：用户一眼看出插件认的是哪个后端、缺的是哪一步。
      return item.subject === null
        ? t('env.title.backend')
        : t('env.title.backendWith', { backend: backendName(item.subject, t) })
    case 'cli':
      return t(CLI_TITLES[item.subject ?? '']?.cli ?? 'env.title.cliGeneric')
    case 'auth':
      return t(CLI_TITLES[item.subject ?? '']?.auth ?? 'env.title.authGeneric')
    case 'repository':
      if (item.subject === 'github') return t('env.title.repositoryGithub')
      if (item.subject === 'gitlab') return t('env.title.repositoryGitlab')
      if (item.subject === 'gitea') return t('env.title.repositoryGitea')
      return t('env.title.repositoryGeneric')
    case 'workspace':
      return t('env.title.workspace')
    case 'local-issues':
      return t('env.title.localIssues')
    case 'skill':
      return t('env.title.skill', { skill: item.subject ?? '' })
  }
}

type CapabilityId = HostCapabilityId | UiCapabilityId

interface CapabilityContent {
  readonly label: MessageKey
  /** 缺失时影响什么。 */
  readonly impact: MessageKey
  /** 缺失时怎么补。 */
  readonly fix: MessageKey
}

/** 能力诊断的显示名、影响与补法。宿主侧和界面侧的 id 在同一张表里。 */
const CAPABILITIES: Readonly<Record<CapabilityId, CapabilityContent>> = {
  subprocess: {
    label: 'capability.subprocess.label',
    impact: 'capability.subprocess.impact',
    fix: 'capability.subprocess.fix',
  },
  timer: {
    label: 'capability.timer.label',
    impact: 'capability.timer.impact',
    fix: 'capability.timer.fix',
  },
  connection: {
    label: 'capability.connection.label',
    impact: 'capability.connection.impact',
    fix: 'capability.connection.fix',
  },
  skills: {
    label: 'capability.skills.label',
    impact: 'capability.skills.impact',
    fix: 'capability.skills.fix',
  },
  slots: {
    label: 'capability.slots.label',
    impact: 'capability.slots.impact',
    fix: 'capability.slots.fix',
  },
  sidebarRightTabs: {
    label: 'capability.sidebarRightTabs.label',
    impact: 'capability.sidebarRightTabs.impact',
    fix: 'capability.sidebarRightTabs.fix',
  },
  sidebarRight: {
    label: 'capability.sidebarRight.label',
    impact: 'capability.sidebarRight.impact',
    fix: 'capability.sidebarRight.fix',
  },
  sessions: {
    label: 'capability.sessions.label',
    impact: 'capability.sessions.impact',
    fix: 'capability.sessions.fix',
  },
  conversation: {
    label: 'capability.conversation.label',
    impact: 'capability.conversation.impact',
    fix: 'capability.conversation.fix',
  },
  uiWorkspace: {
    label: 'capability.uiWorkspace.label',
    impact: 'capability.uiWorkspace.impact',
    fix: 'capability.uiWorkspace.fix',
  },
  locale: {
    label: 'capability.locale.label',
    impact: 'capability.locale.impact',
    fix: 'capability.locale.fix',
  },
  'sidebar.right.pane.tab': {
    label: 'capability.sidebar.right.pane.tab.label',
    impact: 'capability.sidebar.right.pane.tab.impact',
    fix: 'capability.sidebar.right.pane.tab.fix',
  },
  'sidebar.right.pane.tab.title': {
    label: 'capability.sidebar.right.pane.tab.title.label',
    impact: 'capability.sidebar.right.pane.tab.title.impact',
    fix: 'capability.sidebar.right.pane.tab.title.fix',
  },
}

const CAPABILITY_BY_ID: ReadonlyMap<string, CapabilityContent> = new Map(
  Object.entries(CAPABILITIES),
)

/**
 * 能力诊断的一行文案。
 * @param diagnostic - 一项能力诊断。
 * @param t - 翻译入口；省略时用内置中文。
 * @returns 显示名、类别、状态；缺失时再带影响与补法。
 */
export function capabilityText(
  diagnostic: CapabilityDiagnostic,
  t: Translate,
): {
  readonly label: string
  readonly category: string
  readonly state: string
  readonly impact: string | null
  readonly fix: string | null
} {
  const content = CAPABILITY_BY_ID.get(diagnostic.id)
  const missing = diagnostic.status === 'missing'

  return {
    label: content === undefined ? diagnostic.id : t(content.label),
    category: t(
      diagnostic.category === 'host-service'
        ? 'capability.category.host'
        : 'capability.category.ui',
    ),
    state: t(missing ? 'capability.state.missing' : 'capability.state.present'),
    impact: missing && content !== undefined ? t(content.impact) : null,
    fix: missing && content !== undefined ? t(content.fix) : null,
  }
}
