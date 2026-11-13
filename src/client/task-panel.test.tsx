import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'

import type { RpcResult, WorkspaceSnapshot } from '../protocol/tracker.ts'
import { NEW_BUG_PROMPT, NEW_FEATURE_PROMPT } from './prompts.ts'
import type { PanelClient } from './rpc.ts'
import {
  badgeFor,
  deferred,
  ENV_REPORT,
  fakeClient,
  firstRow,
  GITEA_ENV_REPORT,
  NOW,
  panelProps,
  rowRefs,
  SNAPSHOT,
  UNUSED_RESOLVE,
} from './task-panel-test-support.ts'
import { TaskPanel } from './task-panel.tsx'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('任务面板', () => {
  it('显示仓库、快照时间、统计与已加载数量', async () => {
    render(<TaskPanel {...panelProps()} />)

    await screen.findAllByTestId('ticket-row')
    expect(screen.getByTestId('repo-name').textContent).toBe('cnzgray/dsh-mattpocock-workflow')
    expect(screen.getByTestId('backend-badge').textContent).toBe('GitHub')
    expect(screen.getByTestId('snapshot-age').textContent).toContain('刚刚')
    expect(screen.getByTestId('stat-ready').textContent).toContain('2')
    expect(screen.getByTestId('stat-blocked').textContent).toContain('1')
    expect(screen.getByTestId('stat-closed').textContent).toContain('1')
    expect(screen.getByTestId('loaded-total').textContent).toContain('已加载 5 / 共 30')
    expect(screen.getAllByTestId('ticket-row')).toHaveLength(4)
  })

  it('首次加载时显示正在读取状态', async () => {
    const pending = Promise.withResolvers<RpcResult<WorkspaceSnapshot>>()
    const client: PanelClient = {
      get: () => pending.promise,
      refresh: () => pending.promise,
      resolveBlockers: UNUSED_RESOLVE,
      envCheck: () =>
        Promise.resolve({ ok: false, error: { code: 'internal', message: '未使用' } }),
    }
    render(<TaskPanel {...panelProps({ client })} />)

    expect(screen.getByTestId('loading').textContent).toContain('正在读取工单')

    pending.resolve({ ok: true, result: SNAPSHOT })
    await screen.findAllByTestId('ticket-row')
    expect(screen.queryByTestId('loading')).toBeNull()
  })

  it('按状态过滤列表', async () => {
    render(<TaskPanel {...panelProps()} />)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('filter-ready'))
    expect(rowRefs()).toEqual(['#1', '#5'])

    fireEvent.click(screen.getByTestId('filter-blocked'))
    expect(rowRefs()).toEqual(['#2'])

    fireEvent.click(screen.getByTestId('filter-closed'))
    expect(rowRefs()).toEqual(['#3'])

    fireEvent.click(screen.getByTestId('filter-open'))
    expect(rowRefs()).toEqual(['#1', '#5', '#2', '#4'])
  })

  it('按标题和编号排序，再次点击当前排序切换升降序', async () => {
    render(<TaskPanel {...panelProps()} />)
    await screen.findAllByTestId('ticket-row')

    expect(rowRefs()).toEqual(['#1', '#5', '#2', '#4'])

    fireEvent.click(screen.getByTestId('sort-title'))
    expect(rowRefs()).toEqual(['#2', '#1', '#4', '#5'])

    fireEvent.click(screen.getByTestId('sort-title'))
    expect(rowRefs()).toEqual(['#5', '#4', '#1', '#2'])

    fireEvent.click(screen.getByTestId('sort-number'))
    expect(rowRefs()).toEqual(['#5', '#4', '#2', '#1'])

    fireEvent.click(screen.getByTestId('sort-number'))
    expect(rowRefs()).toEqual(['#1', '#2', '#4', '#5'])
  })

  it.each([
    ['github', 'GitHub'],
    ['gitlab', 'GitLab'],
    ['gitea', 'Gitea'],
    ['markdown', '本地'],
  ] as const)('后端徽标显示 %s', async (backend, label) => {
    const client = fakeClient({ ok: true, result: { ...SNAPSHOT, backend } }).client
    render(<TaskPanel {...panelProps({ client })} />)

    await screen.findAllByTestId('ticket-row')
    expect(screen.getByTestId('backend-badge').textContent).toBe(label)
  })

  it('Gitea 快照在顶部显示实例主机，其他后端不显示', async () => {
    const gitea = fakeClient({
      ok: true,
      result: {
        ...SNAPSHOT,
        backend: 'gitea',
        repositoryHost: 'gitea.example.com',
      },
    }).client
    render(<TaskPanel {...panelProps({ client: gitea })} />)

    await screen.findAllByTestId('ticket-row')
    expect(screen.getByTestId('repo-host').textContent).toBe('gitea.example.com')

    cleanup()
    render(<TaskPanel {...panelProps()} />)
    await screen.findAllByTestId('ticket-row')
    expect(screen.queryByTestId('repo-host')).toBeNull()
  })

  it('本地 Markdown 路径过长时中间截断，完整值放在 title 里', async () => {
    const ref = '.scratch/very-long-feature-name/issues/03-session.md'
    const snapshot: WorkspaceSnapshot = {
      backend: 'markdown',
      repository: 'my-workspace',
      repositoryHost: null,
      fetchedAt: NOW - 5_000,
      loaded: 1,
      total: 1,
      blockersFinalized: true,
      tickets: [
        {
          ref,
          number: null,
          title: '会话过期处理',
          state: 'open',
          category: null,
          status: 'ready',
          skillAction: 'implement',
          skillActionReason: 'ready-for-agent',
          createdAt: '2026-11-01T00:00:00Z',
          updatedAt: '2026-11-10T00:00:00Z',
          openBlockers: 0,
        },
      ],
    }
    const injectDraft = vi.fn(() => true)
    render(
      <TaskPanel
        {...panelProps({ client: fakeClient({ ok: true, result: snapshot }).client, injectDraft })}
      />,
    )

    await screen.findAllByTestId('ticket-row')
    const badge = screen.getByTestId('ticket-ref')
    expect(badge.textContent).toContain('…')
    expect(badge.getAttribute('title')).toBe(ref)

    fireEvent.click(screen.getByTestId('skill-badge'))
    expect(injectDraft).toHaveBeenLastCalledWith(
      expect.stringMatching(new RegExp(`^/implement 处理工单 ${ref}`)),
    )
  })

  it('刷新会重新拉取并更新快照', async () => {
    const fake = fakeClient(
      { ok: true, result: SNAPSHOT },
      { ok: true, result: { ...SNAPSHOT, fetchedAt: NOW, total: 31 } },
    )
    render(<TaskPanel {...panelProps({ client: fake.client })} />)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('refresh'))

    await waitFor(() => {
      expect(fake.refreshCalls).toEqual(['/repo'])
    })
    await waitFor(() => {
      expect(screen.getByTestId('loaded-total').textContent).toContain('共 31')
    })
  })

  it('刷新进行中时按钮禁用且不能重复触发', async () => {
    const pending = deferred<RpcResult<WorkspaceSnapshot>>()
    const client: PanelClient = {
      get: () => Promise.resolve({ ok: true, result: SNAPSHOT }),
      refresh: () => pending.promise,
      resolveBlockers: UNUSED_RESOLVE,
      envCheck: () =>
        Promise.resolve({ ok: false, error: { code: 'internal', message: '未使用' } }),
    }
    render(<TaskPanel {...panelProps({ client })} />)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('refresh'))
    const button = screen.getByTestId<HTMLButtonElement>('refresh')
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('刷新中…')

    fireEvent.click(button)
    expect(button.disabled).toBe(true)

    pending.resolve({ ok: true, result: SNAPSHOT })
    await waitFor(() => {
      expect(button.disabled).toBe(false)
    })
  })

  it('刷新失败时保留旧列表并显示失败原因', async () => {
    const fake = fakeClient(
      { ok: true, result: SNAPSHOT },
      { ok: false, error: { code: 'gh-missing', message: '未找到 gh' } },
    )
    render(<TaskPanel {...panelProps({ client: fake.client })} />)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('refresh'))

    await screen.findByTestId('error')
    expect(screen.getByTestId('error').textContent).toContain('未找到 gh 命令')
    expect(screen.getAllByTestId('ticket-row')).toHaveLength(4)
  })

  it.each([
    ['glab-missing', '未找到 glab 命令'],
    ['glab-unauthenticated', 'glab 未登录或令牌已失效'],
    ['tea-missing', '未找到 tea 命令'],
    ['tea-unauthenticated', 'tea 未登录该实例或令牌已失效'],
    ['markdown-read-failed', '读取 .scratch'],
  ] as const)('错误码 %s 显示可操作提示且没有列表', async (code, text) => {
    const fake = fakeClient({
      ok: false,
      error: { code, message: '业务失败' },
    })
    render(<TaskPanel {...panelProps({ client: fake.client })} />)

    await screen.findByTestId('error')
    expect(screen.getByTestId('error').textContent).toContain(text)
    expect(screen.queryAllByTestId('ticket-row')).toHaveLength(0)
  })

  it('新建入口与技能徽标分别填入对应提示词', async () => {
    const injectDraft = vi.fn(() => true)
    render(<TaskPanel {...panelProps({ injectDraft })} />)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('new-feature'))
    expect(injectDraft).toHaveBeenLastCalledWith(NEW_FEATURE_PROMPT)

    fireEvent.click(screen.getByTestId('new-bug'))
    expect(injectDraft).toHaveBeenLastCalledWith(NEW_BUG_PROMPT)

    fireEvent.click(badgeFor('#1'))
    expect(injectDraft).toHaveBeenLastCalledWith(expect.stringMatching(/^\/implement 处理工单 #1/))
  })

  it('没有可用会话时禁用注入按钮并给出提示', async () => {
    const injectDraft = vi.fn(() => true)
    render(<TaskPanel {...panelProps({ canInject: false, injectDraft })} />)
    await screen.findAllByTestId('ticket-row')

    expect(screen.getByTestId<HTMLButtonElement>('new-feature').disabled).toBe(true)
    expect(screen.getByTestId<HTMLButtonElement>('new-bug').disabled).toBe(true)
    expect(screen.getByTestId('no-session-hint').textContent).toContain('没有可用会话')

    const badges = screen.getAllByTestId<HTMLButtonElement>('skill-badge')
    expect(badges).toHaveLength(3)
    expect(badges.every((badge) => badge.disabled)).toBe(true)
    expect(badges[0]?.title).toContain('无法填入提示词')

    fireEvent.click(firstRow())
    fireEvent.click(badgeFor('#1'))
    expect(injectDraft).not.toHaveBeenCalled()
  })

  it('切换工作区后清空旧快照并读取新工作区', async () => {
    const fake = fakeClient((root) => ({
      ok: true,
      result: { ...SNAPSHOT, repository: `${root}/repo` },
    }))
    const { rerender } = render(
      <TaskPanel {...panelProps({ client: fake.client, workspaceRoot: '/one' })} />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('repo-name').textContent).toBe('/one/repo')
    })

    rerender(<TaskPanel {...panelProps({ client: fake.client, workspaceRoot: '/two' })} />)

    await waitFor(() => {
      expect(screen.getByTestId('repo-name').textContent).toBe('/two/repo')
    })
    expect(fake.getCalls).toEqual(['/one', '/two'])
  })
  it('点击「环境检查」切换视图并自动检查当前工作区', async () => {
    const envCheckCalls: string[] = []
    const client: PanelClient = {
      get: () => Promise.resolve({ ok: true, result: SNAPSHOT }),
      refresh: () => Promise.resolve({ ok: true, result: SNAPSHOT }),
      resolveBlockers: UNUSED_RESOLVE,
      envCheck(root) {
        envCheckCalls.push(root)
        return Promise.resolve({ ok: true, result: ENV_REPORT })
      },
    }
    render(<TaskPanel {...panelProps({ client })} />)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('view-env'))

    await screen.findByTestId('env-items')
    expect(envCheckCalls).toEqual(['/repo'])
    expect(screen.getByTestId('env-summary').textContent).toContain('环境检查 1/2')
    expect(screen.getByTestId('env-remedy').textContent).toContain('brew install gh')
    expect(screen.queryAllByTestId('ticket-row')).toHaveLength(0)
  })

  it('列表因环境问题失败时提供「查看环境检查」入口', async () => {
    const client: PanelClient = {
      get: () =>
        Promise.resolve({ ok: false, error: { code: 'gh-missing', message: '未找到 gh' } }),
      refresh: () =>
        Promise.resolve({ ok: false, error: { code: 'gh-missing', message: '未找到 gh' } }),
      resolveBlockers: UNUSED_RESOLVE,
      envCheck: () => Promise.resolve({ ok: true, result: ENV_REPORT }),
    }
    render(<TaskPanel {...panelProps({ client })} />)

    await screen.findByTestId('error')
    fireEvent.click(screen.getByTestId('open-env-check'))

    await screen.findByTestId('env-items')
    expect(screen.getByTestId('env-summary').textContent).toContain('环境检查 1/2')
  })

  it('列表因 Gitea 环境问题失败时也提供「查看环境检查」入口', async () => {
    const client: PanelClient = {
      get: () =>
        Promise.resolve({ ok: false, error: { code: 'tea-missing', message: '未找到 tea' } }),
      refresh: () =>
        Promise.resolve({ ok: false, error: { code: 'tea-missing', message: '未找到 tea' } }),
      resolveBlockers: UNUSED_RESOLVE,
      envCheck: () => Promise.resolve({ ok: true, result: GITEA_ENV_REPORT }),
    }
    render(<TaskPanel {...panelProps({ client })} />)

    await screen.findByTestId('error')
    fireEvent.click(screen.getByTestId('open-env-check'))

    await screen.findByTestId('env-items')
    const giteaFailure = screen
      .getAllByTestId('env-item')
      .find((entry) => entry.dataset.subject === 'gitea' && entry.dataset.status === 'fail')
    await waitFor(() => {
      expect(giteaFailure?.dataset.highlighted).toBe('true')
    })
  })

  it('与环境无关的错误不提供环境检查入口', async () => {
    const client: PanelClient = {
      get: () =>
        Promise.resolve({
          ok: false,
          error: { code: 'markdown-read-failed', message: '读取失败' },
        }),
      refresh: () =>
        Promise.resolve({
          ok: false,
          error: { code: 'markdown-read-failed', message: '读取失败' },
        }),
      resolveBlockers: UNUSED_RESOLVE,
      envCheck: () => Promise.resolve({ ok: true, result: ENV_REPORT }),
    }
    render(<TaskPanel {...panelProps({ client })} />)

    await screen.findByTestId('error')
    expect(screen.queryByTestId('open-env-check')).toBeNull()
  })
})
