import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import * as React from 'react'

import { emptyMetrics } from '../protocol/snapshot-test-support.ts'
import type { RpcResult, WorkspaceSnapshot } from '../protocol/tracker.ts'
import type { InjectionOutcome, InjectionTarget } from './injection.ts'
import { fakeInjection } from './injection-test-support.ts'
import { gestures } from './prompt-test-support.ts'
import {
  badgeFor,
  chooseSort,
  clientWith,
  deferred,
  ENV_REPORT,
  fakeClient,
  firstRow,
  flipSortDirection,
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

/** 最近一次注入的文本。 */
function lastInjection(injectDraft: Mock): string {
  const calls = injectDraft.mock.calls
  const last: unknown = calls.at(-1)?.[0]
  if (typeof last !== 'string') throw new Error('没有注入文本')
  return last
}

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
    const pending = deferred<RpcResult<WorkspaceSnapshot>>()
    const client = clientWith({
      get: () => pending.promise,
      refresh: () => pending.promise,
      resolveBlockers: UNUSED_RESOLVE,
    })
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

    chooseSort('title')
    expect(rowRefs()).toEqual(['#2', '#1', '#4', '#5'])

    flipSortDirection()
    expect(rowRefs()).toEqual(['#5', '#4', '#1', '#2'])

    chooseSort('number')
    expect(rowRefs()).toEqual(['#5', '#4', '#2', '#1'])

    flipSortDirection()
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
      viewer: null,
      fetchedAt: NOW - 5_000,
      loaded: 1,
      total: 1,
      windowLimit: 1,
      metrics: emptyMetrics(),
      blockersFinalized: true,
      source: 'live',
      stale: false,
      refreshError: null,
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
          labels: ['ready-for-agent'],
          author: null,
          assignees: [],
          createdAt: '2026-11-01T00:00:00Z',
          updatedAt: '2026-11-10T00:00:00Z',
          openBlockers: 0,
        },
      ],
    }
    const injectDraft = vi.fn<(text: string, target: InjectionTarget) => InjectionOutcome>(
      () => 'filled',
    )
    const fake = fakeClient({ ok: true, result: snapshot })
    render(
      <TaskPanel
        {...panelProps({ client: fake.client, injection: fakeInjection({ inject: injectDraft }) })}
      />,
    )

    await screen.findAllByTestId('ticket-row')
    const badge = screen.getByTestId('ticket-ref')
    expect(badge.textContent).toContain('…')
    expect(badge.getAttribute('title')).toBe(ref)

    fireEvent.click(screen.getByTestId('skill-badge'))
    expect(injectDraft).toHaveBeenLastCalledWith(`/implement ${ref}`, 'current-session')

    fireEvent.click(firstRow())
    await screen.findByTestId('detail-content')
    expect(fake.detailCalls).toEqual([['/repo', ref, null]])
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
    const client = clientWith({
      get: () => Promise.resolve({ ok: true, result: SNAPSHOT }),
      refresh: () => pending.promise,
      resolveBlockers: UNUSED_RESOLVE,
    })
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

    // 失败原因贴在数据旁边，不用整屏横幅盖住还在的列表。
    await screen.findByTestId('refresh-error')
    expect(screen.getByTestId('refresh-error').textContent).toContain('未找到 gh')
    expect(screen.queryByTestId('error')).toBeNull()
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

  it('三个按钮填入各自提示词，技能徽标填入实现提示词', async () => {
    const injectDraft = vi.fn<(text: string, target: InjectionTarget) => InjectionOutcome>(
      () => 'filled',
    )
    render(<TaskPanel {...panelProps({ injection: fakeInjection({ inject: injectDraft }) })} />)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('new-feature'))
    expect(gestures(lastInjection(injectDraft))).toEqual(['mattwf-feature'])
    expect(lastInjection(injectDraft)).toContain('需求（一句话）：')

    fireEvent.click(screen.getByTestId('new-bug'))
    expect(gestures(lastInjection(injectDraft))).toEqual(['mattwf-bug'])
    for (const slot of ['现象：', '复现步骤：', '预期行为：']) {
      expect(lastInjection(injectDraft)).toContain(slot)
    }

    fireEvent.click(screen.getByTestId('new-spec'))
    expect(gestures(lastInjection(injectDraft))).toEqual(['to-spec'])
    expect(lastInjection(injectDraft)).toContain('需求描述：')
    expect(injectDraft).toHaveBeenLastCalledWith(
      expect.stringMatching(/^\/to-spec/),
      'current-session',
    )

    // 新按钮说清它用 /to-spec 直接建需求票，不是把需求写进原始票。
    const specButton = screen.getByTestId('new-spec')
    expect(specButton.title).toContain('/to-spec')
    expect(specButton.title).toContain('直接创建需求票')
    expect(specButton.getAttribute('aria-label')).toContain('/to-spec')

    fireEvent.click(badgeFor('#1'))
    expect(injectDraft).toHaveBeenLastCalledWith('/implement #1', 'current-session')
  })

  it('快照还没加载出来时三个按钮也能填草稿', () => {
    const pending = deferred<RpcResult<WorkspaceSnapshot>>()
    const client = clientWith({
      get: () => pending.promise,
      refresh: () => pending.promise,
      resolveBlockers: UNUSED_RESOLVE,
    })
    const injectDraft = vi.fn<(text: string, target: InjectionTarget) => InjectionOutcome>(
      () => 'filled',
    )
    render(
      <TaskPanel {...panelProps({ client, injection: fakeInjection({ inject: injectDraft }) })} />,
    )

    fireEvent.click(screen.getByTestId('new-feature'))
    expect(gestures(lastInjection(injectDraft))).toEqual(['mattwf-feature'])

    fireEvent.click(screen.getByTestId('new-bug'))
    expect(gestures(lastInjection(injectDraft))).toEqual(['mattwf-bug'])
    expect(lastInjection(injectDraft)).not.toContain('跟踪器')

    fireEvent.click(screen.getByTestId('new-spec'))
    expect(gestures(lastInjection(injectDraft))).toEqual(['to-spec'])
    expect(lastInjection(injectDraft)).toContain('需求描述：')
  })

  it('没有可用会话时禁用注入按钮并给出提示', async () => {
    const injectDraft = vi.fn<(text: string, target: InjectionTarget) => InjectionOutcome>(
      () => 'filled',
    )
    render(
      <TaskPanel
        {...panelProps({
          injection: fakeInjection({ canInjectCurrent: false, inject: injectDraft }),
        })}
      />,
    )
    await screen.findAllByTestId('ticket-row')

    expect(screen.getByTestId<HTMLButtonElement>('new-feature').disabled).toBe(true)
    expect(screen.getByTestId<HTMLButtonElement>('new-bug').disabled).toBe(true)
    expect(screen.getByTestId<HTMLButtonElement>('new-spec').disabled).toBe(true)
    expect(screen.getByTestId('no-session-hint').textContent).toContain('没有可用会话')

    const badges = screen.getAllByTestId<HTMLButtonElement>('skill-badge')
    expect(badges).toHaveLength(3)
    expect(badges.every((badge) => badge.disabled)).toBe(true)
    expect(badges[0]?.title).toContain('无法填入提示词')

    fireEvent.click(firstRow())
    await screen.findByTestId('detail-content')
    const detailBadge = screen.getByTestId<HTMLButtonElement>('skill-badge')
    expect(detailBadge.disabled).toBe(true)
    expect(detailBadge.title).toContain('无法填入提示词')
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

  it('默认仍是列表，切换概览后显示指标与关注清单', async () => {
    const overview: WorkspaceSnapshot = {
      ...SNAPSHOT,
      metrics: emptyMetrics({
        attention: [{ ref: '#1', title: 'Bravo', reason: 'most-blocking', evidence: 2 }],
      }),
    }
    const client = fakeClient({ ok: true, result: overview }).client
    render(<TaskPanel {...panelProps({ client })} />)
    await screen.findAllByTestId('ticket-row')

    expect(screen.getByTestId('view-tickets').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('view-overview'))

    expect(await screen.findByTestId('overview-view')).toBeTruthy()
    expect(screen.getByTestId('metric-grid')).toBeTruthy()
    expect(screen.getByTestId('attention-item').textContent).toContain('Bravo')
    expect(screen.queryAllByTestId('ticket-row')).toHaveLength(0)
  })

  it('列表与概览共用一份快照，切视图不重新读取', async () => {
    const fake = fakeClient({ ok: true, result: SNAPSHOT })
    render(<TaskPanel {...panelProps({ client: fake.client })} />)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('view-overview'))
    expect(await screen.findByTestId('overview-view')).toBeTruthy()
    fireEvent.click(screen.getByTestId('view-tickets'))

    await screen.findAllByTestId('ticket-row')
    expect(fake.getCalls).toEqual(['/repo'])
  })

  it('点击关注清单跳到列表并定位该票，不写入提示词', async () => {
    const injectDraft = vi.fn<(text: string, target: InjectionTarget) => InjectionOutcome>(
      () => 'filled',
    )
    const overview: WorkspaceSnapshot = {
      ...SNAPSHOT,
      metrics: emptyMetrics({
        attention: [{ ref: '#1', title: 'Bravo', reason: 'most-blocking', evidence: 2 }],
      }),
    }
    const client = fakeClient({ ok: true, result: overview }).client
    render(
      <TaskPanel {...panelProps({ client, injection: fakeInjection({ inject: injectDraft }) })} />,
    )
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('view-overview'))
    fireEvent.click(await screen.findByTestId('attention-item'))

    await screen.findAllByTestId('ticket-row')
    expect(screen.getByTestId('view-tickets').getAttribute('aria-pressed')).toBe('true')
    const located = screen
      .getAllByTestId('ticket-row')
      .find((row) => row.getAttribute('data-ref') === '#1')
    expect(located?.getAttribute('data-focused')).toBe('true')
    expect(injectDraft).not.toHaveBeenCalled()
  })

  it('点击「环境检查」切换视图并自动检查当前工作区', async () => {
    const envCheckCalls: string[] = []
    const client = clientWith({
      get: () => Promise.resolve({ ok: true, result: SNAPSHOT }),
      refresh: () => Promise.resolve({ ok: true, result: SNAPSHOT }),
      resolveBlockers: UNUSED_RESOLVE,
      envCheck(root) {
        envCheckCalls.push(root)
        return Promise.resolve({ ok: true, result: ENV_REPORT })
      },
    })
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
    const client = clientWith({
      get: () =>
        Promise.resolve({ ok: false, error: { code: 'gh-missing', message: '未找到 gh' } }),
      refresh: () =>
        Promise.resolve({ ok: false, error: { code: 'gh-missing', message: '未找到 gh' } }),
      resolveBlockers: UNUSED_RESOLVE,
      envCheck: () => Promise.resolve({ ok: true, result: ENV_REPORT }),
    })
    render(<TaskPanel {...panelProps({ client })} />)

    await screen.findByTestId('error')
    fireEvent.click(screen.getByTestId('open-env-check'))

    await screen.findByTestId('env-items')
    expect(screen.getByTestId('env-summary').textContent).toContain('环境检查 1/2')
  })

  it('列表因 Gitea 环境问题失败时也提供「查看环境检查」入口', async () => {
    const client = clientWith({
      get: () =>
        Promise.resolve({ ok: false, error: { code: 'tea-missing', message: '未找到 tea' } }),
      refresh: () =>
        Promise.resolve({ ok: false, error: { code: 'tea-missing', message: '未找到 tea' } }),
      resolveBlockers: UNUSED_RESOLVE,
      envCheck: () => Promise.resolve({ ok: true, result: GITEA_ENV_REPORT }),
    })
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
    const client = clientWith({
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
    })
    render(<TaskPanel {...panelProps({ client })} />)

    await screen.findByTestId('error')
    expect(screen.queryByTestId('open-env-check')).toBeNull()
  })

  it('点击工单行打开详情，点击返回回到列表且筛选保持不变', async () => {
    const fake = fakeClient({ ok: true, result: SNAPSHOT })
    render(<TaskPanel {...panelProps({ client: fake.client })} />)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('filter-ready'))
    fireEvent.click(firstRow())

    await screen.findByTestId('detail-content')
    expect(screen.getByTestId('detail-ref').textContent).toBe('#1')
    expect(fake.detailCalls).toEqual([['/repo', '#1', 1]])
    expect(screen.queryAllByTestId('ticket-row')).toHaveLength(0)

    fireEvent.click(screen.getByTestId('detail-back'))

    await screen.findAllByTestId('ticket-row')
    expect(screen.getByTestId('filter-ready').getAttribute('aria-pressed')).toBe('true')
    expect(rowRefs()).toEqual(['#1', '#5'])
  })

  it('打开详情再返回后人员筛选仍然生效', async () => {
    const fake = fakeClient({ ok: true, result: SNAPSHOT })
    render(<TaskPanel {...panelProps({ client: fake.client })} />)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('mine-assigned'))
    expect(rowRefs()).toEqual(['#1'])

    fireEvent.click(firstRow())
    await screen.findByTestId('detail-content')
    fireEvent.click(screen.getByTestId('detail-back'))

    await screen.findAllByTestId('ticket-row')
    expect(screen.getByTestId('mine-assigned').getAttribute('aria-pressed')).toBe('true')
    expect(rowRefs()).toEqual(['#1'])
  })

  it('agent 活动信号在详情态也刷新列表，返回列表后筛选与数据都是新的', async () => {
    const retitled = {
      ...SNAPSHOT,
      tickets: SNAPSHOT.tickets.map((ticket) =>
        ticket.ref === '#1' ? { ...ticket, title: 'Bravo 改过标题' } : ticket,
      ),
    }
    const fake = fakeClient({ ok: true, result: SNAPSHOT }, { ok: true, result: retitled })
    const view = render(<TaskPanel {...panelProps({ client: fake.client, refreshSignal: 0 })} />)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('filter-ready'))
    fireEvent.click(firstRow())
    await screen.findByTestId('detail-content')

    view.rerender(<TaskPanel {...panelProps({ client: fake.client, refreshSignal: 1 })} />)

    await waitFor(() => {
      expect(fake.refreshCalls).toEqual(['/repo'])
    })
    // 刷新期间详情不被打断。
    expect(screen.getByTestId('detail-content')).toBeTruthy()

    fireEvent.click(screen.getByTestId('detail-back'))

    await screen.findAllByTestId('ticket-row')
    expect(screen.getByTestId('filter-ready').getAttribute('aria-pressed')).toBe('true')
    expect(
      screen
        .getAllByTestId('ticket-row')
        .map((row) => row.textContent)
        .join(),
    ).toContain('Bravo 改过标题')
    // 列表数据在面板层，回到列表不再重读一次。
    expect(fake.getCalls).toEqual(['/repo'])
  })

  it('Esc 从详情返回列表', async () => {
    const fake = fakeClient({ ok: true, result: SNAPSHOT })
    render(<TaskPanel {...panelProps({ client: fake.client })} />)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(firstRow())
    await screen.findByTestId('detail-content')

    fireEvent.keyDown(window, { key: 'Escape' })

    await screen.findAllByTestId('ticket-row')
    expect(screen.queryByTestId('detail-content')).toBeNull()
  })

  it('切换工作区时详情自动关闭', async () => {
    const fake = fakeClient((root) => ({
      ok: true,
      result: { ...SNAPSHOT, repository: `${root}/repo` },
    }))
    const { rerender } = render(
      <TaskPanel {...panelProps({ client: fake.client, workspaceRoot: '/one' })} />,
    )
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(firstRow())
    await screen.findByTestId('detail-content')

    rerender(<TaskPanel {...panelProps({ client: fake.client, workspaceRoot: '/two' })} />)

    await waitFor(() => {
      expect(screen.getByTestId('repo-name').textContent).toBe('/two/repo')
    })
    expect(screen.queryByTestId('detail-content')).toBeNull()
    // 不会拿新工作区去读上一张票：详情只请求过一次。
    expect(fake.detailCalls).toHaveLength(1)
  })

  it('详情里的技能按钮填入这张票的开工提示词', async () => {
    const injectDraft = vi.fn<(text: string, target: InjectionTarget) => InjectionOutcome>(
      () => 'filled',
    )
    const fake = fakeClient({ ok: true, result: SNAPSHOT })
    render(
      <TaskPanel
        {...panelProps({ client: fake.client, injection: fakeInjection({ inject: injectDraft }) })}
      />,
    )
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(firstRow())
    await screen.findByTestId('detail-content')
    fireEvent.click(screen.getByTestId('skill-badge'))

    expect(injectDraft).toHaveBeenCalledWith('/implement #1', 'current-session')
  })
})
