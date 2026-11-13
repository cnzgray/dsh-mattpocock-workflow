import { describe, expect, it } from 'vitest'

import type { EnvCheckItem } from '../protocol/env-check.ts'
import { capabilityText, envCheckTitle, envSuggestionText } from './env-check-text.ts'

function item(overrides: Partial<EnvCheckItem>): EnvCheckItem {
  return {
    id: 'home',
    subject: null,
    status: 'pass',
    detail: '依据',
    suggestion: null,
    blockedBy: null,
    ...overrides,
  }
}

describe('环境检查文案', () => {
  it('后端相关检查项的标题随后端变化', () => {
    expect(envCheckTitle(item({ id: 'cli', subject: 'github' }))).toBe('GitHub CLI (gh) 已安装')
    expect(envCheckTitle(item({ id: 'cli', subject: 'gitlab' }))).toBe('GitLab CLI (glab) 已安装')
    expect(envCheckTitle(item({ id: 'cli', subject: null }))).toBe('命令行工具已安装')
    expect(envCheckTitle(item({ id: 'auth', subject: 'gitlab' }))).toBe('glab 已登录远端实例')
    expect(envCheckTitle(item({ id: 'repository', subject: 'gitlab' }))).toBe('GitLab 仓库可达')
    expect(envCheckTitle(item({ id: 'repository', subject: null }))).toBe('仓库可达')
    expect(envCheckTitle(item({ id: 'skill', subject: 'to-spec' }))).toBe('技能 to-spec 已安装')
  })

  it('安装与登录建议带上对应后端的具体命令', () => {
    expect(
      envSuggestionText(
        item({ id: 'cli', subject: 'gitlab', status: 'fail', suggestion: 'install-cli' }),
      ),
    ).toContain('brew install glab')
    expect(
      envSuggestionText(
        item({ id: 'auth', subject: 'gitlab', status: 'fail', suggestion: 'login-cli' }),
      ),
    ).toBe('运行 glab auth login')
    expect(
      envSuggestionText(
        item({ id: 'auth', subject: null, status: 'fail', suggestion: 'login-cli' }),
      ),
    ).toBe('登录对应后端的命令行工具')
  })

  it('仓库地址、日志与网络的建议各自可操作', () => {
    expect(
      envSuggestionText(
        item({ id: 'repository', status: 'fail', suggestion: 'check-remote-address' }),
      ),
    ).toContain('origin')
    expect(
      envSuggestionText(item({ id: 'cli', status: 'fail', suggestion: 'check-logs' })),
    ).toContain('日志')
    expect(
      envSuggestionText(item({ id: 'repository', status: 'fail', suggestion: 'check-network' })),
    ).toContain('网络')
  })

  it('技能、工作区与后端选择的失败建议', () => {
    expect(
      envSuggestionText(
        item({ id: 'skill', subject: 'triage', status: 'fail', suggestion: 'install-skill' }),
      ),
    ).toContain('triage')
    expect(
      envSuggestionText(item({ id: 'workspace', status: 'fail', suggestion: 'run-setup-skills' })),
    ).toBe('运行 /setup-matt-pocock-skills')
    expect(
      envSuggestionText(item({ id: 'backend', status: 'fail', suggestion: 'select-backend' })),
    ).toContain('origin')
  })

  it('通过项与跳过项没有修复建议', () => {
    expect(envSuggestionText(item({ status: 'pass' }))).toBeNull()
    expect(
      envSuggestionText(
        item({ id: 'auth', status: 'skipped', blockedBy: { id: 'cli', subject: 'github' } }),
      ),
    ).toBeNull()
  })

  it('能力诊断区分宿主服务与界面扩展点', () => {
    expect(
      capabilityText({ id: 'subprocess', category: 'host-service', status: 'present' }),
    ).toEqual({ label: '子进程服务', category: '宿主服务', state: '可用' })
    expect(
      capabilityText({
        id: 'sidebar.right.pane.tab',
        category: 'ui-extension',
        status: 'missing',
      }),
    ).toEqual({ label: '页签内容插槽', category: '界面扩展点', state: '缺失' })
    expect(
      capabilityText({ id: 'unknown', category: 'host-service', status: 'missing' }).label,
    ).toBe('unknown')
  })
})
