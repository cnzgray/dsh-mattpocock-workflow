import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import * as React from 'react'

import type { BackendKind } from '../protocol/backend.ts'
import type { PromptInjection } from './injection.ts'
import { fakeInjection } from './injection-test-support.ts'
import type { EnvCheckReport } from '../protocol/env-check.ts'
import type { RpcResult, SnapshotCacheInfo } from '../protocol/tracker.ts'
import { EnvCheckView } from './env-check-view.tsx'
import {
  CANDIDATE_REPORT,
  CLIENT_CAPABILITIES,
  FIXED_REPORT,
  GITEA_REPORT,
  MARKDOWN_REPORT,
  REPORT,
  RETRY_REPORT,
  WORKSPACE_FAIL,
} from './env-check-view-test-support.ts'
import type { PanelClient } from './rpc.ts'

afterEach(() => {
  cleanup()
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
})

interface FakeClient {
  readonly client: PanelClient
  readonly calls: string[]
  /** 本地快照库的调用：工作区与是否要求清空。 */
  readonly cacheCalls: (readonly [string, boolean])[]
}

/** 空的本地快照库：默认夹具没有真实的缓存目录。 */
const EMPTY_CACHE: SnapshotCacheInfo = {
  location: '~/.dsh/cache/dsh-mattpocock-workflow/',
  entries: 0,
  lastWrittenAt: null,
  cleared: 0,
}

function fakeClient(
  envCheck: (root: string) => Promise<RpcResult<EnvCheckReport>>,
  cache: (root: string, clear: boolean) => Promise<RpcResult<SnapshotCacheInfo>> = () =>
    Promise.resolve({ ok: true, result: EMPTY_CACHE }),
): FakeClient {
  const calls: string[] = []
  const cacheCalls: (readonly [string, boolean])[] = []
  const client: PanelClient = {
    get: () => Promise.reject(new Error('未使用')),
    refresh: () => Promise.reject(new Error('未使用')),
    resolveBlockers: () => Promise.reject(new Error('未使用')),
    getDetail: () => Promise.reject(new Error('未使用')),
    updateTicket: () => Promise.reject(new Error('未使用')),
    getOptions: () =>
      Promise.resolve({ ok: false, error: { code: 'capability-unsupported', message: '未使用' } }),
    deleteTicket: () => Promise.reject(new Error('未使用')),
    cache(root, options) {
      const clear = options?.clear === true
      cacheCalls.push([root, clear])
      return cache(root, clear)
    },
    envCheck(root) {
      calls.push(root)
      return envCheck(root)
    },
  }
  return { client, calls, cacheCalls }
}

function renderView(
  envCheck: (root: string) => Promise<RpcResult<EnvCheckReport>>,
  options: {
    readonly workspaceRoot?: string | undefined
    readonly injection?: PromptInjection | undefined
    readonly focusBackend?: Exclude<BackendKind, 'markdown'> | null
    readonly cache?: (root: string, clear: boolean) => Promise<RpcResult<SnapshotCacheInfo>>
  } = {},
): FakeClient {
  const fake = fakeClient(envCheck, options.cache)
  render(
    <EnvCheckView
      client={fake.client}
      workspaceRoot={'workspaceRoot' in options ? options.workspaceRoot : '/repo'}
      injection={options.injection ?? fakeInjection()}
      clientCapabilities={() => CLIENT_CAPABILITIES}
      focusBackend={options.focusBackend ?? null}
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
    expect(screen.getByTestId('env-backend').textContent).toBe('GitHub')
  })

  it('显示通过、失败与跳过三种状态，跳过项写明挡住它的检查项', async () => {
    renderView(() => okResponse())
    await screen.findByTestId('env-items')

    expect(itemCard('home', '').dataset.status).toBe('pass')
    expect(itemCard('cli', 'github').dataset.status).toBe('fail')
    expect(itemCard('auth', 'github').dataset.status).toBe('skipped')
    expect(itemCard('auth', 'github').textContent).toContain('因为「GitHub CLI (gh) 已安装」未通过')
  })

  it('Gitea 后端显示 tea 口径的三项与安装命令，不出现本地工单目录', async () => {
    renderView(() => okResponse(GITEA_REPORT))
    await screen.findByTestId('env-items')

    expect(screen.getByTestId('env-backend').textContent).toBe('Gitea')
    expect(itemCard('cli', 'gitea').textContent).toContain('Gitea CLI (tea) 已安装')
    expect(remedyCard('cli', 'gitea').textContent).toContain('brew install tea')
    expect(itemCard('auth', 'gitea').textContent).toContain('tea 已登录远端实例')
    expect(itemCard('repository', 'gitea').textContent).toContain('Gitea 仓库可达')
    expect(itemCard('auth', 'gitea').textContent).toContain('因为「Gitea CLI (tea) 已安装」未通过')
    expect(
      screen.getAllByTestId('env-item').some((entry) => entry.dataset.id === 'local-issues'),
    ).toBe(false)
  })

  it('本地 Markdown 后端显示本地工单目录与放置解决', async () => {
    renderView(() => okResponse(MARKDOWN_REPORT))
    await screen.findByTestId('env-items')

    expect(screen.getByTestId('env-backend').textContent).toBe('本地 Markdown')
    expect(itemCard('local-issues', '').textContent).toContain('本地工单目录可用')
    expect(remedyCard('local-issues', '').textContent).toContain('.scratch/<feature>/issues/')
  })

  it('判定项带候选 Gitea 时标题点名后端，解决给 tea 的登录命令', async () => {
    renderView(() => okResponse(CANDIDATE_REPORT))
    await screen.findByTestId('env-items')

    expect(screen.getByTestId('env-backend').textContent).toBe('未判定')
    expect(itemCard('backend', 'gitea').textContent).toContain('已选择工单后端（Gitea）')
    expect(remedyCard('backend', 'gitea').textContent).toContain('tea login add')
    expect(itemCard('cli', 'gitea').textContent).toContain('因为「已选择工单后端（Gitea）」未通过')
  })

  it('从工单列表跳转时定位到该后端第一个失败项', async () => {
    renderView(() => okResponse(GITEA_REPORT), { focusBackend: 'gitea' })
    await screen.findByTestId('env-items')

    const cli = itemCard('cli', 'gitea')
    await waitFor(() => {
      expect(cli.dataset.highlighted).toBe('true')
    })
    expect(document.activeElement).toBe(cli)
    expect(itemCard('repository', 'gitea').dataset.highlighted).toBeUndefined()
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
      injection: fakeInjection({
        inject: (text) => {
          injected.push(text)
          return 'filled'
        },
      }),
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
    renderView(() => okResponse(WORKSPACE_FAIL), {
      injection: fakeInjection({ canInjectCurrent: false }),
    })
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
        injection={fakeInjection()}
        clientCapabilities={() => []}
      />,
    )
    await screen.findByTestId('env-items')

    rerender(
      <EnvCheckView
        client={fake.client}
        workspaceRoot="/two"
        injection={fakeInjection()}
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
        injection={fakeInjection()}
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

describe('本地快照库小节', () => {
  it('显示缓存位置、条目数与最近写入时间', async () => {
    const fake = renderView(() => okResponse(), {
      cache: () =>
        Promise.resolve({
          ok: true,
          result: {
            location: '~/.dsh/cache/dsh-mattpocock-workflow/',
            entries: 3,
            lastWrittenAt: Date.now() - 60_000,
            cleared: 0,
          },
        }),
    })

    await screen.findByTestId('env-cache')
    expect(fake.cacheCalls).toEqual([['/repo', false]])
    expect(screen.getByTestId('env-cache-location').textContent).toBe(
      '~/.dsh/cache/dsh-mattpocock-workflow/',
    )
    expect(screen.getByTestId('env-cache-entries').textContent).toContain('3 条快照')
    expect(screen.getByTestId('env-cache-written').textContent).toContain('最近写入')
  })

  it('没有写入记录时说明是空的，不显示时间', async () => {
    renderView(() => okResponse())

    await screen.findByTestId('env-cache')

    expect(screen.getByTestId('env-cache-written').textContent).toContain('还没有写入记录')
  })

  it('清除时让宿主清空本地快照库，并刷新这节信息', async () => {
    let cleared = false
    const fake = renderView(() => okResponse(), {
      cache: (_root, clear) => {
        if (clear) cleared = true
        return Promise.resolve({
          ok: true,
          result: {
            location: '~/.dsh/cache/dsh-mattpocock-workflow/',
            entries: cleared ? 0 : 2,
            lastWrittenAt: null,
            cleared: clear ? 2 : 0,
          },
        })
      },
    })
    await screen.findByTestId('env-cache')

    fireEvent.click(screen.getByTestId('env-cache-clear'))

    await screen.findByTestId('env-cache-notice')
    expect(fake.cacheCalls).toEqual([
      ['/repo', false],
      ['/repo', true],
      ['/repo', false],
    ])
    expect(screen.getByTestId('env-cache-notice').textContent).toContain('已清除 2 条')
    expect(screen.getByTestId('env-cache-entries').textContent).toContain('0 条快照')
  })

  it('清除失败时显示原因，不静默', async () => {
    renderView(() => okResponse(), {
      cache: (_root, clear) =>
        clear
          ? Promise.resolve({
              ok: false,
              error: { code: 'internal', message: '快照库被占用' },
            })
          : Promise.resolve({ ok: true, result: EMPTY_CACHE }),
    })
    await screen.findByTestId('env-cache')

    fireEvent.click(screen.getByTestId('env-cache-clear'))

    await screen.findByTestId('env-cache-error')
    expect(screen.getByTestId('env-cache-error').textContent).toContain('快照库被占用')
    expect(screen.queryByTestId('env-cache-notice')).toBeNull()
  })
})
