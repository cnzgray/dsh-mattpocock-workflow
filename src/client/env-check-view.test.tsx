import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import * as React from 'react'

import type { CapabilityDiagnostic, EnvCheckReport } from '../protocol/env-check.ts'
import type { RpcResult } from '../protocol/tracker.ts'
import { EnvCheckView } from './env-check-view.tsx'
import type { PanelClient } from './rpc.ts'

afterEach(() => {
  cleanup()
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
})

const CLIENT_CAPABILITIES: readonly CapabilityDiagnostic[] = [
  { id: 'slots', category: 'ui-extension', status: 'present' },
  { id: 'sessions', category: 'ui-extension', status: 'missing' },
]

const REPORT: EnvCheckReport = {
  checkedAt: 1,
  backend: 'github',
  repository: 'owner/repo',
  items: [
    {
      id: 'home',
      subject: null,
      status: 'pass',
      detail: '/home/dev',
      remedy: null,
      blockedBy: null,
    },
    {
      id: 'backend',
      subject: null,
      status: 'pass',
      detail: 'remote:github',
      remedy: null,
      blockedBy: null,
    },
    {
      id: 'cli',
      subject: 'github',
      status: 'fail',
      detail: '未找到 gh 可执行文件',
      remedy: { code: 'install-cli', subject: 'github' },
      blockedBy: null,
    },
    {
      id: 'auth',
      subject: 'github',
      status: 'skipped',
      detail: '未执行检查',
      remedy: null,
      blockedBy: { id: 'cli', subject: 'github' },
    },
    {
      id: 'repository',
      subject: 'github',
      status: 'skipped',
      detail: '未执行检查',
      remedy: null,
      blockedBy: { id: 'cli', subject: 'github' },
    },
    {
      id: 'workspace',
      subject: null,
      status: 'pass',
      detail: 'docs/agents/issue-tracker.md 存在',
      remedy: null,
      blockedBy: null,
    },
    {
      id: 'skill',
      subject: 'to-spec',
      status: 'pass',
      detail: 'DSH 技能清单已收录',
      remedy: null,
      blockedBy: null,
    },
  ],
  capabilities: [
    { id: 'subprocess', category: 'host-service', status: 'present' },
    { id: 'timer', category: 'host-service', status: 'missing' },
  ],
}

const WORKSPACE_FAIL: EnvCheckReport = {
  ...REPORT,
  items: REPORT.items.map((item) =>
    item.id === 'workspace'
      ? {
          ...item,
          status: 'fail',
          detail: '未找到 docs/agents/issue-tracker.md',
          remedy: { code: 'init-workspace', subject: null },
        }
      : item,
  ),
}

const FIXED_REPORT: EnvCheckReport = {
  ...REPORT,
  items: REPORT.items.map((item) => ({
    ...item,
    status: 'pass',
    remedy: null,
    blockedBy: null,
  })),
}

const RETRY_REPORT: EnvCheckReport = {
  ...REPORT,
  items: REPORT.items.map((item) =>
    item.id === 'repository'
      ? {
          ...item,
          status: 'fail',
          detail: '网络不可达或请求超时',
          remedy: { code: 'check-network', subject: null },
          blockedBy: null,
        }
      : item.id === 'auth'
        ? { ...item, status: 'pass', detail: '已登录', blockedBy: null }
        : item,
  ),
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
    resolveBlockers: () => Promise.reject(new Error('未使用')),
    envCheck(root) {
      calls.push(root)
      return envCheck(root)
    },
  }
  return { client, calls }
}

function renderView(
  envCheck: (root: string) => Promise<RpcResult<EnvCheckReport>>,
  options: {
    readonly workspaceRoot?: string | undefined
    readonly canInject?: boolean | undefined
    readonly injectDraft?: ((text: string) => boolean) | undefined
  } = {},
): FakeClient {
  const fake = fakeClient(envCheck)
  render(
    <EnvCheckView
      client={fake.client}
      workspaceRoot={'workspaceRoot' in options ? options.workspaceRoot : '/repo'}
      canInject={options.canInject ?? true}
      injectDraft={options.injectDraft ?? (() => true)}
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

function jumpButton(card: HTMLElement): Element {
  const found = card.querySelector('[data-testid="env-jump"]')
  if (found === null) throw new Error('缺少跳到根因按钮')
  return found
}

function remedyCard(id: string, subject: string): HTMLElement {
  const card = itemCard(id, subject)
  const remedy = card.querySelector<HTMLElement>('[data-testid="env-remedy"]')
  if (remedy === null) throw new Error(`检查项 ${id}/${subject} 没有解决区`)
  return remedy
}

function stubClipboard(mode: 'ok' | 'missing'): { readonly copied: string[] } {
  const copied: string[] = []
  const value =
    mode === 'missing'
      ? undefined
      : {
          writeText: (text: string) => {
            copied.push(text)
            return Promise.resolve()
          },
        }

  Object.defineProperty(navigator, 'clipboard', { value, configurable: true })
  return { copied }
}

function okResponse(report: EnvCheckReport = REPORT): Promise<RpcResult<EnvCheckReport>> {
  return Promise.resolve({ ok: true, result: report })
}

describe('环境检查视图', () => {
  it('打开时自动检查，顶部显示通过数、总数与后端', async () => {
    const fake = renderView(() => okResponse())

    await screen.findByTestId('env-items')
    expect(fake.calls).toEqual(['/repo'])
    expect(screen.getByTestId('env-summary').textContent).toContain('环境检查 4/7')
    expect(screen.getByTestId('env-backend').textContent).toBe('github')
  })

  it('显示通过、失败与跳过三种状态，跳过项写明挡住它的检查项', async () => {
    renderView(() => okResponse())
    await screen.findByTestId('env-items')

    expect(itemCard('home', '').dataset.status).toBe('pass')
    expect(itemCard('cli', 'github').dataset.status).toBe('fail')
    expect(itemCard('auth', 'github').dataset.status).toBe('skipped')
    expect(itemCard('auth', 'github').textContent).toContain('因为「GitHub CLI (gh) 已安装」未通过')
  })

  it('失败卡片在依据下面显示解决区，通过项与跳过项没有', async () => {
    renderView(() => okResponse())
    await screen.findByTestId('env-items')

    const remedy = remedyCard('cli', 'github')
    expect(remedy.dataset.code).toBe('install-cli')
    expect(remedy.textContent).toContain('brew install gh')
    expect(remedy.querySelector('[data-testid="env-remedy-link"]')?.getAttribute('href')).toBe(
      'https://cli.github.com',
    )

    expect(itemCard('home', '').querySelector('[data-testid="env-remedy"]')).toBeNull()
    expect(itemCard('auth', 'github').querySelector('[data-testid="env-remedy"]')).toBeNull()
  })

  it('点「填入输入框」才把点名技能与失败项的提示词交给会话，渲染时不注入', async () => {
    const injected: string[] = []
    renderView(() => okResponse(WORKSPACE_FAIL), {
      injectDraft: (text) => {
        injected.push(text)
        return true
      },
    })
    await screen.findByTestId('env-items')
    expect(injected).toEqual([])

    fireEvent.click(screen.getByTestId('env-remedy-fill'))

    expect(injected).toHaveLength(1)
    expect(injected[0]).toContain('setup-matt-pocock-skills')
    expect(injected[0]).toContain('docs/agents/issue-tracker.md')
    expect(injected[0]).toContain('工作区已初始化')
  })

  it('没有可用会话时禁用填入并说明原因，仍可复制提示词', async () => {
    const clipboard = stubClipboard('ok')
    renderView(() => okResponse(WORKSPACE_FAIL), { canInject: false, injectDraft: () => true })
    await screen.findByTestId('env-items')

    expect(screen.getByTestId<HTMLButtonElement>('env-remedy-fill').disabled).toBe(true)
    expect(screen.getByTestId('env-remedy-no-session').textContent).toContain('没有可用会话')

    fireEvent.click(screen.getByTestId('env-remedy-copy-prompt'))
    await screen.findByText('已复制')
    expect(clipboard.copied[0]).toContain('setup-matt-pocock-skills')
  })

  it('复制命令写入剪贴板并显示已复制反馈', async () => {
    const clipboard = stubClipboard('ok')
    renderView(() => okResponse())
    await screen.findByTestId('env-items')

    fireEvent.click(screen.getByTestId('env-remedy-copy-command'))

    await screen.findByText('已复制')
    expect(clipboard.copied).toEqual(['brew install gh'])
  })

  it('剪贴板不可用时命令仍然完整显示，并提示手动选择', async () => {
    stubClipboard('missing')
    renderView(() => okResponse())
    await screen.findByTestId('env-items')

    fireEvent.click(screen.getByTestId('env-remedy-copy-command'))

    await screen.findByTestId('env-remedy-copy-command-failed')
    expect(screen.getByTestId('env-remedy-command').textContent).toBe('brew install gh')
  })

  it('修好一项后重新检查，该项变绿且解决区消失', async () => {
    let call = 0
    renderView(() => {
      call += 1
      return okResponse(call === 1 ? REPORT : FIXED_REPORT)
    })
    await screen.findByTestId('env-items')
    expect(remedyCard('cli', 'github').dataset.code).toBe('install-cli')

    fireEvent.click(screen.getByTestId('env-recheck'))

    await waitFor(() => {
      expect(itemCard('cli', 'github').dataset.status).toBe('pass')
    })
    expect(itemCard('cli', 'github').querySelector('[data-testid="env-remedy"]')).toBeNull()
  })

  it('重试型解决直接触发一次新的检查', async () => {
    const fake = renderView(() => okResponse(RETRY_REPORT))
    await screen.findByTestId('env-items')

    fireEvent.click(screen.getByTestId('env-remedy-retry'))

    await waitFor(() => {
      expect(fake.calls).toEqual(['/repo', '/repo'])
    })
  })

  it('跳过项跳到根因并让根因卡片获得焦点与高亮', async () => {
    renderView(() => okResponse())
    await screen.findByTestId('env-items')

    const root = itemCard('cli', 'github')
    expect(root.dataset.highlighted).toBeUndefined()

    fireEvent.click(jumpButton(itemCard('auth', 'github')))

    expect(root.dataset.highlighted).toBe('true')
    expect(document.activeElement).toBe(root)
  })

  it('能力诊断缺失项显示影响与补法，可用项没有', async () => {
    renderView(() => okResponse())
    await screen.findByTestId('env-items')

    fireEvent.click(screen.getByTestId('capabilities-summary'))

    const rows = screen.getAllByTestId('capability')
    const timer = rows.find((row) => row.dataset.id === 'timer')
    const subprocess = rows.find((row) => row.dataset.id === 'subprocess')
    if (timer === undefined || subprocess === undefined) throw new Error('缺少能力行')

    expect(timer.querySelector('[data-testid="capability-impact"]')?.textContent).toContain(
      '影响：',
    )
    expect(timer.querySelector('[data-testid="capability-impact"]')?.textContent).toContain(
      '补法：',
    )
    expect(subprocess.querySelector('[data-testid="capability-impact"]')).toBeNull()
  })

  it('首次检查时显示加载状态', async () => {
    const pending = Promise.withResolvers<RpcResult<EnvCheckReport>>()
    renderView(() => pending.promise)

    expect(screen.getByTestId('env-loading').textContent).toContain('正在检查环境')

    pending.resolve({ ok: true, result: REPORT })
    await screen.findByTestId('env-items')
    expect(screen.queryByTestId('env-loading')).toBeNull()
  })

  it('重新检查进行中时按钮禁用且不能重复触发，旧结果与解决区保留', async () => {
    const pending = Promise.withResolvers<RpcResult<EnvCheckReport>>()
    let call = 0
    const fake = renderView(() => {
      call += 1
      return call === 1 ? okResponse() : pending.promise
    })
    await screen.findByTestId('env-items')

    fireEvent.click(screen.getByTestId('env-recheck'))
    const button = screen.getByTestId<HTMLButtonElement>('env-recheck')
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('检查中…')
    expect(screen.getByTestId('env-summary').textContent).toContain('环境检查 4/7')
    expect(remedyCard('cli', 'github').textContent).toContain('brew install gh')

    fireEvent.click(button)
    expect(fake.calls).toEqual(['/repo', '/repo'])

    pending.resolve({ ok: true, result: { ...REPORT, checkedAt: 2 } })
    await waitFor(() => {
      expect(button.disabled).toBe(false)
    })
  })

  it('检查失败时显示错误与重新检查按钮', async () => {
    let call = 0
    const fake = renderView(() => {
      call += 1
      return call === 1
        ? Promise.resolve({ ok: false, error: { code: 'internal', message: '检查服务不可用' } })
        : Promise.resolve({ ok: true, result: REPORT })
    })

    await screen.findByTestId('env-error')
    expect(screen.getByTestId('env-error').textContent).toContain('检查服务不可用')
    expect(screen.queryByTestId('env-items')).toBeNull()

    fireEvent.click(screen.getByTestId('env-error-retry'))

    await screen.findByTestId('env-items')
    expect(fake.calls).toEqual(['/repo', '/repo'])
  })

  it('切换工作区后重新检查', async () => {
    const fake = fakeClient(() => okResponse())
    const { rerender } = render(
      <EnvCheckView
        client={fake.client}
        workspaceRoot="/one"
        canInject
        injectDraft={() => true}
        clientCapabilities={() => []}
      />,
    )
    await screen.findByTestId('env-items')

    rerender(
      <EnvCheckView
        client={fake.client}
        workspaceRoot="/two"
        canInject
        injectDraft={() => true}
        clientCapabilities={() => []}
      />,
    )

    await waitFor(() => {
      expect(fake.calls).toEqual(['/one', '/two'])
    })
  })

  it('没有工作区时说明原因与下一步，不放无效的重试按钮', async () => {
    const fake = fakeClient(() => okResponse())
    render(
      <EnvCheckView
        client={fake.client}
        workspaceRoot={undefined}
        canInject
        injectDraft={() => true}
        clientCapabilities={() => []}
      />,
    )

    await screen.findByTestId('env-error')
    expect(screen.getByTestId('env-error').textContent).toContain('没有工作区目录')
    expect(screen.getByTestId('env-error').textContent).toContain('请在打开的工作区里重新打开面板')
    expect(screen.queryByTestId('env-error-retry')).toBeNull()
    expect(fake.calls).toEqual([])
  })
})
