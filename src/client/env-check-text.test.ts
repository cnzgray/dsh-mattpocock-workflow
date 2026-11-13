import { describe, expect, it } from 'vitest'

import type { CapabilityDiagnostic, EnvCheckItem } from '../protocol/env-check.ts'
import { capabilityText, envBackendLabel, envCheckTitle } from './env-check-text.ts'

function item(overrides: Partial<EnvCheckItem>): EnvCheckItem {
  return {
    id: 'home',
    subject: null,
    status: 'pass',
    detail: '依据',
    remedy: null,
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
    expect(envCheckTitle(item({ id: 'cli', subject: 'gitea' }))).toBe('Gitea CLI (tea) 已安装')
    expect(envCheckTitle(item({ id: 'auth', subject: 'gitea' }))).toBe('tea 已登录远端实例')
    expect(envCheckTitle(item({ id: 'repository', subject: 'gitlab' }))).toBe('GitLab 仓库可达')
    expect(envCheckTitle(item({ id: 'repository', subject: 'gitea' }))).toBe('Gitea 仓库可达')
    expect(envCheckTitle(item({ id: 'repository', subject: null }))).toBe('仓库可达')
    expect(envCheckTitle(item({ id: 'local-issues' }))).toBe('本地工单目录可用')
    expect(envCheckTitle(item({ id: 'skill', subject: 'to-spec' }))).toBe('技能 to-spec 已安装')
  })

  it('判定项带候选后端时标题点名它，避免与「没有后端」混淆', () => {
    expect(envCheckTitle(item({ id: 'backend' }))).toBe('已选择工单后端')
    expect(envCheckTitle(item({ id: 'backend', subject: 'gitea' }))).toBe('已选择工单后端（Gitea）')
  })

  it('顶部后端标记对 Gitea 与本地 Markdown 有明确文案', () => {
    expect(envBackendLabel('github')).toBe('GitHub')
    expect(envBackendLabel('gitlab')).toBe('GitLab')
    expect(envBackendLabel('gitea')).toBe('Gitea')
    expect(envBackendLabel('markdown')).toBe('本地 Markdown')
    expect(envBackendLabel(null)).toBe('未判定')
  })

  function capability(overrides: Partial<CapabilityDiagnostic>): CapabilityDiagnostic {
    return { id: 'subprocess', category: 'host-service', status: 'present', ...overrides }
  }

  it('能力诊断区分宿主服务与界面扩展点', () => {
    expect(capabilityText(capability({ id: 'subprocess' }))).toEqual({
      label: '子进程服务',
      category: '宿主服务',
      state: '可用',
      impact: null,
      fix: null,
    })
    expect(
      capabilityText(
        capability({ id: 'sidebar.right.pane.tab', category: 'ui-extension', status: 'missing' }),
      ),
    ).toMatchObject({
      label: '页签内容插槽',
      category: '界面扩展点',
      state: '缺失',
    })
  })

  it('缺失的能力写明影响与补法，可用项没有', () => {
    const missing = capabilityText(capability({ status: 'missing' }))
    expect(missing.impact).toContain('无法运行 git')
    expect(missing.fix).toContain('重启')

    const present = capabilityText(capability({ id: 'sessions', category: 'ui-extension' }))
    expect(present.impact).toBeNull()
    expect(present.fix).toBeNull()
  })

  it('未知能力 id 原样显示，缺失时没有影响说明', () => {
    expect(capabilityText(capability({ id: 'unknown' }))).toMatchObject({
      label: 'unknown',
      impact: null,
      fix: null,
    })
  })
})
