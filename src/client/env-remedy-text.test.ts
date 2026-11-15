import { describe, expect, it } from 'vitest'

import { ENV_REMEDY_CODES, type EnvRemedyCode } from '../protocol/env-check.ts'
import {
  remedyContent as remedyContentWithT,
  type RemedyAction,
  type RemedyContext,
} from './env-remedy-text.ts'
import { builtinZhTranslate } from './i18n-runtime.ts'

const remedyContent = (code: EnvRemedyCode, context: RemedyContext) =>
  remedyContentWithT(code, context, builtinZhTranslate)

const CONTEXT: RemedyContext = {
  backend: 'github',
  repository: 'owner/repo',
  subject: 'github',
  title: 'GitHub CLI (gh) 已安装',
  detail: '未找到 gh 可执行文件',
}

/** 每个解决码的契约：动作类型固定，文案与动作都由界面给出。 */
const KINDS: Readonly<Record<EnvRemedyCode, RemedyAction['kind']>> = {
  'install-cli': 'command',
  'login-cli': 'command',
  'install-skill': 'session',
  'init-workspace': 'session',
  'place-local-issues': 'session',
  'check-repository-access': 'command',
  'check-remote-address': 'command',
  'check-network': 'retry',
  'check-home': 'command',
  'check-logs': 'retry',
  'fix-backend': 'session',
  retry: 'retry',
}

describe('解决文案表', () => {
  it.each(Object.values(ENV_REMEDY_CODES))('解决码 %s 有文案和确定的动作类型', (code) => {
    const content = remedyContent(code, CONTEXT)

    expect(content.summary.length).toBeGreaterThan(0)
    expect(content.action.kind).toBe(KINDS[code])
  })

  it('安装命令与官方链接随后端变化', () => {
    const github = remedyContent('install-cli', CONTEXT)
    expect(github.action).toEqual({ kind: 'command', command: 'brew install gh' })
    expect(github.link?.href).toBe('https://cli.github.com')

    const gitlab = remedyContent('install-cli', { ...CONTEXT, subject: 'gitlab' })
    expect(gitlab.action).toEqual({ kind: 'command', command: 'brew install glab' })
    expect(gitlab.summary).toContain('glab')

    const gitea = remedyContent('install-cli', { ...CONTEXT, subject: 'gitea' })
    expect(gitea.action).toEqual({ kind: 'command', command: 'brew install tea' })
  })

  it('登录命令随后端变化', () => {
    expect(remedyContent('login-cli', CONTEXT).action).toEqual({
      kind: 'command',
      command: 'gh auth login',
    })
    expect(remedyContent('login-cli', { ...CONTEXT, subject: 'gitlab' }).action).toEqual({
      kind: 'command',
      command: 'glab auth login',
    })
  })

  it('安装技能的会话提示词点名技能，并链接到 mattpocock/skills', () => {
    const content = remedyContent('install-skill', {
      ...CONTEXT,
      subject: 'triage',
      title: '技能 triage 已安装',
    })

    expect(content.action.kind).toBe('session')
    if (content.action.kind !== 'session') throw new Error('动作类型不符')
    expect(content.action.prompt).toContain('triage')
    expect(content.action.prompt).toContain('mattpocock/skills')
    expect(content.link?.href).toBe('https://github.com/mattpocock/skills')
  })

  it('初始化工作区的会话提示词点名初始化技能与失败项', () => {
    const content = remedyContent('init-workspace', {
      ...CONTEXT,
      title: '工作区已初始化',
      detail: '未找到 docs/agents/issue-tracker.md',
    })

    if (content.action.kind !== 'session') throw new Error('动作类型不符')
    expect(content.action.prompt.split('\n')[0]).toBe('/setup-matt-pocock-skills')
    expect(content.action.prompt).toContain('setup-matt-pocock-skills')
    expect(content.action.prompt).toContain('docs/agents/issue-tracker.md')
    expect(content.action.prompt).toContain('工作区已初始化')
  })

  it('本地工单目录的会话提示词写明位置、状态行与约定文档', () => {
    const content = remedyContent('place-local-issues', {
      ...CONTEXT,
      subject: null,
      title: '本地工单目录可用',
      detail: '工作区里没有 .scratch 目录',
    })

    expect(content.summary).toContain('.scratch/<feature>/issues/')
    expect(content.summary).toContain('docs/local-issues.md')
    if (content.action.kind !== 'session') throw new Error('动作类型不符')
    expect(content.action.prompt).toContain('.scratch/<feature>/issues/')
    expect(content.action.prompt).toContain('Status:')
    expect(content.action.prompt).toContain('docs/local-issues.md')
  })

  it('仓库权限命令点名具体仓库，远端核对命令直接可复制', () => {
    expect(remedyContent('check-repository-access', CONTEXT).action).toEqual({
      kind: 'command',
      command: 'gh repo view owner/repo --json nameWithOwner,viewerPermission',
    })
    expect(
      remedyContent('check-repository-access', {
        ...CONTEXT,
        backend: 'gitlab',
        repository: 'group/sub/repo',
      }).action,
    ).toEqual({ kind: 'command', command: 'glab repo view group/sub/repo' })
    expect(remedyContent('check-remote-address', CONTEXT).action).toEqual({
      kind: 'command',
      command: 'git remote -v',
    })
  })

  it('仓库路径含 shell 元字符时不拼进命令', () => {
    const unsafe = remedyContent('check-repository-access', {
      ...CONTEXT,
      repository: 'owner/repo; rm -rf ~',
    })
    expect(unsafe.action).toEqual({
      kind: 'command',
      command: 'gh repo view --json nameWithOwner,viewerPermission',
    })

    const unsafeGitlab = remedyContent('check-repository-access', {
      ...CONTEXT,
      backend: 'gitlab',
      repository: 'group/repo $(id)',
    })
    expect(unsafeGitlab.action).toEqual({ kind: 'command', command: 'glab repo view' })
  })

  it('主目录解决写明设置与重启，日志解决写明日志范围', () => {
    const home = remedyContent('check-home', CONTEXT)
    expect(home.summary).toContain('HOME')
    expect(home.summary).toContain('重启 DSH')
    expect(home.action).toEqual({ kind: 'command', command: 'printenv HOME' })

    const logs = remedyContent('check-logs', CONTEXT)
    expect(logs.summary).toContain('.dsh/logs')
    expect(logs.action.kind).toBe('retry')
  })

  it('网络与重试都是重新检查的动作', () => {
    expect(remedyContent('check-network', CONTEXT).action.kind).toBe('retry')
    expect(remedyContent('retry', CONTEXT).action.kind).toBe('retry')
  })

  it('修复后端选择的会话提示词包含远端与登录步骤', () => {
    const content = remedyContent('fix-backend', {
      ...CONTEXT,
      subject: null,
      title: '已选择工单后端',
      detail: '无法判定工单后端',
    })

    if (content.action.kind !== 'session') throw new Error('动作类型不符')
    expect(content.action.prompt).toContain('origin')
    expect(content.action.prompt).toContain('glab')
    expect(content.action.prompt).toContain('tea')
  })

  it('不知道后端时安装命令列出三种 CLI，而不是一句通用建议', () => {
    const content = remedyContent('install-cli', { ...CONTEXT, subject: null })

    if (content.action.kind !== 'command') throw new Error('动作类型不符')
    expect(content.action.command).toContain('brew install gh')
    expect(content.action.command).toContain('brew install glab')
    expect(content.action.command).toContain('brew install tea')
    expect(content.link).toBeUndefined()
  })
})
