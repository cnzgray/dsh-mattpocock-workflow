/**
 * 环境检查的中文文案。宿主只送 id、后端、subject 和解决码，标题、能力说明
 * 都在这里拼，文案只维护一处。主题相关的样式不在这里。
 */
import type {
  CapabilityDiagnostic,
  EnvCheckItem,
  HostCapabilityId,
  UiCapabilityId,
} from '../protocol/env-check.ts'

/** 后端名到标题前缀的映射。 */
const CLI_TITLES: Readonly<Record<string, { readonly cli: string; readonly auth: string }>> = {
  github: { cli: 'GitHub CLI (gh) 已安装', auth: 'gh 已登录' },
  gitlab: { cli: 'GitLab CLI (glab) 已安装', auth: 'glab 已登录远端实例' },
  gitea: { cli: 'Gitea CLI (tea) 已安装', auth: 'tea 已登录远端实例' },
}

/**
 * 检查项的标题，写成该项应达到的状态。
 * @param item - 检查结果。
 * @returns 中文标题。
 */
export function envCheckTitle(item: EnvCheckItem): string {
  switch (item.id) {
    case 'home':
      return '用户主目录可解析'
    case 'backend':
      return '已选择工单后端'
    case 'cli':
      return CLI_TITLES[item.subject ?? '']?.cli ?? '命令行工具已安装'
    case 'auth':
      return CLI_TITLES[item.subject ?? '']?.auth ?? '命令行工具已登录'
    case 'repository':
      if (item.subject === 'github') return 'GitHub 仓库可达'
      if (item.subject === 'gitlab') return 'GitLab 仓库可达'
      if (item.subject === 'gitea') return 'Gitea 仓库可达'
      return '仓库可达'
    case 'workspace':
      return '工作区已初始化'
    case 'skill':
      return `技能 ${item.subject ?? ''} 已安装`
  }
}

type CapabilityId = HostCapabilityId | UiCapabilityId

interface CapabilityContent {
  readonly label: string
  /** 缺失时影响什么。 */
  readonly impact: string
  /** 缺失时怎么补。 */
  readonly fix: string
}

/** 能力诊断的显示名、影响与补法。宿主侧和界面侧的 id 在同一张表里。 */
const CAPABILITIES: Readonly<Record<CapabilityId, CapabilityContent>> = {
  subprocess: {
    label: '子进程服务',
    impact: '无法运行 git 与后端命令行，工单列表和环境检查都不可用。',
    fix: '确认 DSH 的 subprocess 服务已启用，或升级 DSH 后重启。',
  },
  timer: {
    label: '计时服务',
    impact: '探测没有超时保护，环境检查可能长时间不返回。',
    fix: '确认 DSH 的 timer 服务已启用，或升级 DSH 后重启。',
  },
  connection: {
    label: '连接服务',
    impact: '面板无法与宿主通信，打不开工单列表和环境检查。',
    fix: '确认 DSH 的 connection 服务已启用，或升级 DSH 后重启。',
  },
  skills: {
    label: '技能清单服务',
    impact: '读不到 DSH 技能清单，技能检查只能按磁盘目录判定。',
    fix: '确认 DSH 的 skills 服务已启用，或把技能装到工作区的 .claude/skills 下。',
  },
  slots: {
    label: '插槽注册',
    impact: '注册不了面板页签，右栏里看不到 MattWorkflow。',
    fix: '升级 DSH 到提供 slots 的版本后重启。',
  },
  sidebarRightTabs: {
    label: '右栏页签注册',
    impact: '注册不了页签类型，右栏里看不到 MattWorkflow。',
    fix: '升级 DSH 到提供 sidebarRightTabs 的版本后重启。',
  },
  sessions: {
    label: '会话状态',
    impact: '确定不了当前会话，提示词注入不可用。',
    fix: '升级 DSH 到提供 sessions 的版本后重启。',
  },
  conversation: {
    label: '对话输入',
    impact: '访问不了输入框，提示词注入不可用。',
    fix: '升级 DSH 到提供 conversation 的版本后重启。',
  },
  'sidebar.right.pane.tab': {
    label: '页签内容插槽',
    impact: '面板内容无处挂载，打开页签只会看到空内容。',
    fix: '升级 DSH 到提供 sidebar.right.pane.tab 插槽的版本后重启。',
  },
  'sidebar.right.pane.tab.title': {
    label: '页签标题插槽',
    impact: '页签标题只能显示默认值。',
    fix: '升级 DSH 到提供 sidebar.right.pane.tab.title 插槽的版本后重启。',
  },
}

const CAPABILITY_BY_ID: ReadonlyMap<string, CapabilityContent> = new Map(
  Object.entries(CAPABILITIES),
)

/**
 * 能力诊断的一行文案。
 * @param diagnostic - 一项能力诊断。
 * @returns 显示名、类别、状态；缺失时再带影响与补法。
 */
export function capabilityText(diagnostic: CapabilityDiagnostic): {
  readonly label: string
  readonly category: string
  readonly state: string
  readonly impact: string | null
  readonly fix: string | null
} {
  const content = CAPABILITY_BY_ID.get(diagnostic.id)
  const missing = diagnostic.status === 'missing'

  return {
    label: content?.label ?? diagnostic.id,
    category: diagnostic.category === 'host-service' ? '宿主服务' : '界面扩展点',
    state: missing ? '缺失' : '可用',
    impact: missing ? (content?.impact ?? null) : null,
    fix: missing ? (content?.fix ?? null) : null,
  }
}
