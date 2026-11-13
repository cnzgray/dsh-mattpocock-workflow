/**
 * 环境检查的中文文案。宿主只送 id、后端和 subject，标题与建议都在这里拼，
 * 文案只维护一处。主题相关的样式不在这里。
 */
import type { CapabilityDiagnostic, EnvCheckItem, SuggestionCode } from '../protocol/env-check.ts'

/** 后端名到标题前缀的映射。 */
const CLI_TITLES: Readonly<Record<string, { readonly cli: string; readonly auth: string }>> = {
  github: { cli: 'GitHub CLI (gh) 已安装', auth: 'gh 已登录' },
  gitlab: { cli: 'GitLab CLI (glab) 已安装', auth: 'glab 已登录远端实例' },
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
      return '仓库可达'
    case 'workspace':
      return '工作区已初始化'
    case 'skill':
      return `技能 ${item.subject ?? ''} 已安装`
  }
}

/**
 * 失败项的具体修复建议；不是失败项时没有建议。
 * @param item - 检查结果。
 * @returns 中文建议，或 null。
 */
export function envSuggestionText(item: EnvCheckItem): string | null {
  if (item.status !== 'fail' || item.suggestion === null) return null
  return suggestionText(item.suggestion, item)
}

function suggestionText(code: SuggestionCode, item: EnvCheckItem): string {
  switch (code) {
    case 'install-cli':
      if (item.subject === 'github') return '运行 brew install gh，或参考 https://cli.github.com'
      if (item.subject === 'gitlab') {
        return '运行 brew install glab，或参考 https://gitlab.com/gitlab-org/cli'
      }
      return '安装对应后端的命令行工具'
    case 'login-cli':
      if (item.subject === 'github') return '运行 gh auth login'
      if (item.subject === 'gitlab') return '运行 glab auth login'
      return '登录对应后端的命令行工具'
    case 'check-repository-access':
      return '确认当前账号对该仓库有访问权限，并核对 origin 远端地址'
    case 'check-remote-address':
      return '核对 origin 的远端地址（owner/name 或 GitLab 项目路径）'
    case 'check-network':
      return '检查网络或代理设置，确认能访问代码托管服务'
    case 'check-logs':
      return '重新检查一次；如果仍然失败，请查看 DSH 日志'
    case 'check-home':
      return '检查 HOME 环境变量是否已设置'
    case 'run-setup-skills':
      return '运行 /setup-matt-pocock-skills'
    case 'install-skill':
      return `安装 mattpocock/skills 里的 ${item.subject ?? '缺失技能'}`
    case 'select-backend':
      return '把 origin 指向 GitHub 仓库或已登录的 GitLab 实例'
  }
}

/** 能力诊断的显示名。 */
const CAPABILITY_LABELS: Readonly<Record<string, string>> = {
  subprocess: '子进程服务',
  timer: '计时服务',
  connection: '连接服务',
  skills: '技能清单服务',
  slots: '插槽注册',
  sidebarRightTabs: '右栏页签注册',
  sessions: '会话状态',
  conversation: '对话输入',
  'sidebar.right.pane.tab': '页签内容插槽',
  'sidebar.right.pane.tab.title': '页签标题插槽',
}

/**
 * 能力诊断的一行文案。
 * @param diagnostic - 一项能力诊断。
 * @returns 显示名与类别。
 */
export function capabilityText(diagnostic: CapabilityDiagnostic): {
  readonly label: string
  readonly category: string
  readonly state: string
} {
  return {
    label: CAPABILITY_LABELS[diagnostic.id] ?? diagnostic.id,
    category: diagnostic.category === 'host-service' ? '宿主服务' : '界面扩展点',
    state: diagnostic.status === 'present' ? '可用' : '缺失',
  }
}
