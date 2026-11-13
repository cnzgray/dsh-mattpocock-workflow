import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import * as React from 'react'

import type { CapabilityDiagnostic, EnvCheckReport } from '../protocol/env-check.ts'
import type { RpcResult } from '../protocol/tracker.ts'
import { EnvCheckView } from './env-check-view.tsx'
import type { PanelClient } from './rpc.ts'

afterEach(cleanup)

const CLIENT_CAPABILITIES: readonly CapabilityDiagnostic[] = [
  { id: 'slots', category: 'ui-extension', status: 'present' },
  { id: 'sessions', category: 'ui-extension', status: 'missing' },
]

const REPORT: EnvCheckReport = {
  checkedAt: 1,
  backend: 'github',
  items: [
    {
      id: 'home',
      subject: null,
      status: 'pass',
      detail: '/home/dev',
      suggestion: null,
      blockedBy: null,
    },
    {
      id: 'backend',
      subject: null,
      status: 'pass',
      detail: 'remote:github',
      suggestion: null,
      blockedBy: null,
    },
    {
      id: 'cli',
      subject: 'github',
      status: 'fail',
      detail: '未找到 gh 可执行文件',
      suggestion: 'install-cli',
      blockedBy: null,
    },
    {
      id: 'auth',
      subject: 'github',
      status: 'skipped',
      detail: '未执行检查',
      suggestion: null,
      blockedBy: { id: 'cli', subject: 'github' },
    },
    {
      id: 'repository',
      subject: 'github',
      status: 'skipped',
      detail: '未执行检查',
      suggestion: null,
      blockedBy: { id: 'cli', subject: 'github' },
    },
    {
      id: 'workspace',
      subject: null,
      status: 'pass',
      detail: 'docs/agents/issue-tracker.md 存在',
      suggestion: null,
      blockedBy: null,
    },
    {
      id: 'skill',
      subject: 'to-spec',
      status: 'pass',
      detail: 'DSH 技能清单已收录',
      suggestion: null,
      blockedBy: null,
    },
  ],
  capabilities: [
    { id: 'subprocess', category: 'host-service', status: 'present' },
    { id: 'timer', category: 'host-service', status: 'missing' },
  ],
}

interface FakeClient {
  readonly client: PanelClient
  readonly calls: string[]
}

function fakeClient(envCheck: (root: string) => Promise<RpcResult<EnvCheckReport>>): FakeClient {
  const calls: string[] = []
  const client: PanelClient = {
    get: () => Promise.reject(new Error('未使用')),
    refresh: () => Promise.reject(new Error('未使用')),
    envCheck(root) {
      calls.push(root)
      return envCheck(root)
    },
  }
  return { client, calls }
}

function renderView(
  envCheck: (root: string) => Promise<RpcResult<EnvCheckReport>>,
  workspaceRoot: string | undefined = '/repo',
): FakeClient {
  const fake = fakeClient(envCheck)
  render(
    <EnvCheckView
      client={fake.client}
      workspaceRoot={workspaceRoot}
      clientCapabilities={() => CLIENT_CAPABILITIES}
    />,
  )
  return fake
}

function itemCard(id: string, subject: string): HTMLElement {
  const found = screen
    .getAllByTestId('env-item')
    .find((entry) => entry.dataset.id === id && entry.dataset.subject === subject)
  if (found === undefined) throw new Error(`缺少检查项 ${id}/${subject}`)
  return found
}

const OK = (): Promise<RpcResult<EnvCheckReport>> => Promise.resolve({ ok: true, result: REPORT })

describe('环境检查视图', () => {
  it('打开时自动检查，顶部显示通过数、总数与后端', async () => {
    const fake = renderView(OK)

    await screen.findByTestId('env-items')
    expect(fake.calls).toEqual(['/repo'])
    expect(screen.getByTestId('env-summary').textContent).toContain('环境检查 4/7')
    expect(screen.getByTestId('env-backend').textContent).toBe('github')
  })

  it('显示通过、失败与跳过三种状态，跳过项写明挡住它的检查项', async () => {
    renderView(OK)
    await screen.findByTestId('env-items')

    expect(itemCard('home', '').dataset.status).toBe('pass')
    expect(itemCard('cli', 'github').dataset.status).toBe('fail')
    expect(itemCard('auth', 'github').dataset.status).toBe('skipped')
    expect(itemCard('auth', 'github').textContent).toContain('因为「GitHub CLI (gh) 已安装」未通过')
  })

  it('失败项给出具体修复建议，通过项没有建议', async () => {
    renderView(OK)
    await screen.findByTestId('env-items')

    expect(itemCard('cli', 'github').textContent).toContain('修复：运行 brew install gh')
    expect(itemCard('home', '').textContent).not.toContain('修复：')
  })

  it('能力诊断默认收起，标题显示可用与缺失数量', async () => {
    renderView(OK)
    await screen.findByTestId('env-items')

    const details = screen.getByTestId('capabilities')
    expect((details as HTMLDetailsElement).open).toBe(false)
    expect(screen.getByTestId('capabilities-summary').textContent).toContain(
      'present 2 / missing 2',
    )

    fireEvent.click(screen.getByTestId('capabilities-summary'))

    const rows = screen.getAllByTestId('capability')
    expect(rows.map((row) => row.dataset.id)).toEqual(['subprocess', 'timer', 'slots', 'sessions'])
    expect(rows.map((row) => row.dataset.status)).toEqual([
      'present',
      'missing',
      'present',
      'missing',
    ])
  })

  it('首次检查时显示加载状态', async () => {
    const pending = Promise.withResolvers<RpcResult<EnvCheckReport>>()
    renderView(() => pending.promise)

    expect(screen.getByTestId('env-loading').textContent).toContain('正在检查环境')

    pending.resolve({ ok: true, result: REPORT })
    await screen.findByTestId('env-items')
    expect(screen.queryByTestId('env-loading')).toBeNull()
  })

  it('重新检查进行中时按钮禁用且不能重复触发，旧结果保留', async () => {
    const pending = Promise.withResolvers<RpcResult<EnvCheckReport>>()
    let call = 0
    const fake = renderView(() => {
      call += 1
      return call === 1 ? OK() : pending.promise
    })
    await screen.findByTestId('env-items')

    fireEvent.click(screen.getByTestId('env-recheck'))
    const button = screen.getByTestId<HTMLButtonElement>('env-recheck')
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('检查中…')
    expect(screen.getByTestId('env-summary').textContent).toContain('环境检查 4/7')

    fireEvent.click(button)
    expect(fake.calls).toEqual(['/repo', '/repo'])

    pending.resolve({ ok: true, result: { ...REPORT, checkedAt: 2 } })
    await waitFor(() => {
      expect(button.disabled).toBe(false)
    })
  })

  it('检查失败时显示错误，不显示检查列表', async () => {
    renderView(() =>
      Promise.resolve({ ok: false, error: { code: 'internal', message: '检查服务不可用' } }),
    )

    await screen.findByTestId('env-error')
    expect(screen.getByTestId('env-error').textContent).toContain('检查服务不可用')
    expect(screen.queryByTestId('env-items')).toBeNull()
  })

  it('切换工作区后重新检查', async () => {
    const fake = fakeClient(OK)
    const { rerender } = render(
      <EnvCheckView client={fake.client} workspaceRoot="/one" clientCapabilities={() => []} />,
    )
    await screen.findByTestId('env-items')

    rerender(
      <EnvCheckView client={fake.client} workspaceRoot="/two" clientCapabilities={() => []} />,
    )

    await waitFor(() => {
      expect(fake.calls).toEqual(['/one', '/two'])
    })
  })

  it('没有工作区时提示无法检查', async () => {
    const fake = fakeClient(OK)
    render(
      <EnvCheckView client={fake.client} workspaceRoot={undefined} clientCapabilities={() => []} />,
    )

    await screen.findByTestId('env-error')
    expect(screen.getByTestId('env-error').textContent).toContain('没有工作区目录')
  })
})
