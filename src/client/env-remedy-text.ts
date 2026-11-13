/**
 * 解决区的中文文案与动作类型。protocol 只送解决码和对象，
 * 每个码对应的文案、动作与链接只在这里维护。
 *
 * 表是全覆盖的 `Record<EnvRemedyCode, …>`：新增解决码忘了写文案时，
 * 类型检查会失败，不会出现「有码无文案」。
 */
import type { BackendKind } from '../protocol/backend.ts'
import { PANEL_SKILLS, type EnvCliBackend, type EnvRemedyCode } from '../protocol/env-check.ts'

/** 解决区渲染所需的上下文。 */
export interface RemedyContext {
  readonly backend: BackendKind | null
  /** 后端判定出的仓库标识；本地 Markdown 或判定失败时为 null。 */
  readonly repository: string | null
  /** 解决对象：技能名或后端名，已按 `remedy.subject ?? item.subject` 解析。 */
  readonly subject: string | null
  /** 失败项的标题。 */
  readonly title: string
  /** 失败项的判定依据：只含结论，不含命令原始输出。 */
  readonly detail: string
}

/** 解决的动作类型：填入会话、命令或重试。 */
export type RemedyAction =
  | { readonly kind: 'session'; readonly prompt: string }
  | { readonly kind: 'command'; readonly command: string }
  | { readonly kind: 'retry' }

/** 解决区的文案：摘要、动作与可选的次要链接。 */
export interface RemedyContent {
  readonly summary: string
  readonly action: RemedyAction
  readonly link?: { readonly href: string; readonly label: string }
}

interface CliText {
  readonly label: string
  readonly install: string
  readonly login: string
  readonly installUrl: string
}

const CLI: Readonly<Record<EnvCliBackend, CliText>> = {
  github: {
    label: 'GitHub CLI (gh)',
    install: 'brew install gh',
    login: 'gh auth login',
    installUrl: 'https://cli.github.com',
  },
  gitlab: {
    label: 'GitLab CLI (glab)',
    install: 'brew install glab',
    login: 'glab auth login',
    installUrl: 'https://gitlab.com/gitlab-org/cli',
  },
  gitea: {
    label: 'Gitea CLI (tea)',
    install: 'brew install tea',
    login: 'tea login add',
    installUrl: 'https://gitea.com/gitea/tea',
  },
}

const SKILLS_REPO = 'https://github.com/mattpocock/skills'

/** DSH 启动报告的位置；探测失败与重试的文案共用。 */
const DSH_LOGS = '~/.dsh/logs（DSH_HOME/logs）'

function cliOf(subject: string | null): CliText | undefined {
  return subject === 'github' || subject === 'gitlab' || subject === 'gitea'
    ? CLI[subject]
    : undefined
}

/** 不知道后端时列出全部 CLI 的同一类命令，命令本身仍只从 CLI 表取。 */
function allCliCommands(pick: (cli: CliText) => string): string {
  return Object.values(CLI)
    .map((cli) => `${pick(cli)}  # ${cli.label}`)
    .join('\n')
}

function installCommand(subject: string | null): string {
  return cliOf(subject)?.install ?? allCliCommands((cli) => cli.install)
}

function loginCommand(subject: string | null): string {
  return cliOf(subject)?.login ?? allCliCommands((cli) => cli.login)
}

/** 只把形如 `owner/name`、`group/sub/name` 的仓库路径拼进命令，避免远端里的 shell 元字符被复制执行。 */
const SAFE_REPOSITORY = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/

function repositoryArg(repository: string | null): string {
  return repository !== null && SAFE_REPOSITORY.test(repository) ? ` ${repository}` : ''
}

/** 仓库权限核对命令：知道后端和仓库名时点名具体仓库。 */
function repositoryCommand(context: RemedyContext): string {
  const arg = repositoryArg(context.repository)
  if (context.backend === 'github') {
    return `gh repo view${arg} --json nameWithOwner,viewerPermission`
  }
  if (context.backend === 'gitlab') {
    return `glab repo view${arg}`
  }
  return 'git remote -v'
}

const REMEDIES: Readonly<Record<EnvRemedyCode, (context: RemedyContext) => RemedyContent>> = {
  'install-cli': (context) => {
    const cli = cliOf(context.subject)
    return {
      summary:
        cli === undefined
          ? '安装后端对应的命令行工具（gh / glab / tea），装好后重新检查。'
          : `安装 ${cli.label}：命令在本机终端运行，装好后重新检查。`,
      action: { kind: 'command', command: installCommand(context.subject) },
      ...(cli === undefined
        ? {}
        : { link: { href: cli.installUrl, label: `${cli.label} 安装说明` } }),
    }
  },
  'login-cli': (context) => {
    const cli = cliOf(context.subject)
    return {
      summary:
        cli === undefined
          ? '登录后端对应的命令行工具（gh / glab / tea），登录后重新检查。'
          : `登录 ${cli.label}；自建实例要在登录时填实例地址，登录后重新检查。`,
      action: { kind: 'command', command: loginCommand(context.subject) },
    }
  },
  'install-skill': (context) => {
    const skill = context.subject ?? '缺失技能'
    return {
      summary: `让当前会话把 ${skill} 技能装到 DSH 会扫描的技能目录（如 .agents/skills），来源是 mattpocock/skills。`,
      action: {
        kind: 'session',
        prompt: `安装 mattpocock/skills 里的 ${skill} 技能到当前工作区 DSH 会扫描的技能目录（如 .agents/skills 或 .dsh/skills），让环境检查项「${context.title}」通过。装好后告诉我，我再重新检查。`,
      },
      link: { href: SKILLS_REPO, label: 'mattpocock/skills 仓库' },
    }
  },
  'init-workspace': (context) => ({
    summary: `让当前会话运行 ${PANEL_SKILLS.setup}，把工作区按面板要求初始化。`,
    action: {
      kind: 'session',
      prompt: [
        `/${PANEL_SKILLS.setup}`,
        '',
        `初始化当前工作区。环境检查项「${context.title}」未通过：${context.detail}。`,
        '按技能完成初始化后告诉我，我再重新检查。',
      ].join('\n'),
    },
  }),
  'place-local-issues': (context) => ({
    summary:
      '把工单放进工作区的 .scratch/<feature>/issues/，每个文件开头写 Status: 行；约定见 docs/local-issues.md。',
    action: {
      kind: 'session',
      prompt: `环境检查项「${context.title}」未通过：${context.detail}。按 docs/local-issues.md 的约定，在当前工作区的 .scratch/<feature>/issues/ 下补上本地工单文件（文件名以编号开头，开头写 # 标题 与 Status: 行）。放好后告诉我，我再重新检查。`,
    },
  }),
  'check-repository-access': (context) => ({
    summary: `核对当前账号对 ${context.repository ?? '远端仓库'} 的访问权限；命令只读，不会改动仓库。`,
    action: { kind: 'command', command: repositoryCommand(context) },
  }),
  'check-remote-address': () => ({
    summary: '核对 origin 指向的仓库地址；远端写错时先改正，再重新检查。',
    action: { kind: 'command', command: 'git remote -v' },
  }),
  'check-network': () => ({
    summary: '网络不可达：检查代理与网络设置，确认能访问代码托管服务后重新检查。',
    action: { kind: 'retry' },
  }),
  'check-home': () => ({
    summary:
      '宿主进程没有可用的用户主目录。在启动 DSH 的终端或服务配置里设置 HOME，然后重启 DSH；命令只核对当前环境。',
    action: { kind: 'command', command: 'printenv HOME' },
  }),
  'check-logs': () => ({
    summary: `探测没有返回结果。DSH 日志在 ${DSH_LOGS} 下，最新一份就是本次启动的报告。`,
    action: { kind: 'retry' },
  }),
  'fix-backend': (context) => ({
    summary: '让当前会话修好后端选择：核对 origin 远端，或补上 glab / tea 的安装与登录。',
    action: {
      kind: 'session',
      prompt: `环境检查项「${context.title}」未通过：${context.detail}。检查当前仓库的 origin 远端：GitHub 仓库要指向 github.com；GitLab 自建实例需要安装并登录 glab；Gitea 实例需要安装并登录 tea。修好后告诉我，我再重新检查。`,
    },
  }),
  retry: () => ({
    summary: `重新检查一次，确认是否为偶发失败；仍然失败时看 ${DSH_LOGS} 下最新的启动报告。`,
    action: { kind: 'retry' },
  }),
}

/**
 * 取一条解决的文案与动作。
 * @param code - 解决码。
 * @param context - 后端、仓库、对象与失败项信息。
 * @returns 摘要、动作与可选链接。
 */
export function remedyContent(code: EnvRemedyCode, context: RemedyContext): RemedyContent {
  return REMEDIES[code](context)
}
