/**
 * 父子布局的列表视图集成测试：真实视图 + 假客户端 + 固定时钟，
 * 断言用户看到的行序、缩进、折叠、父级提示与降级说明。
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  type RenderResult,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'

import type { EnvCheckReport } from '../protocol/env-check.ts'
import { emptyMetrics } from '../protocol/snapshot-test-support.ts'
import type { RpcResult, TicketSnapshot, WorkspaceSnapshot } from '../protocol/tracker.ts'
import { fakeInjection } from './injection-test-support.ts'
import type { PanelClient } from './rpc.ts'
import { chooseSort, flipSortDirection, wrapRefresh } from './task-panel-test-support.ts'
import { TicketsViewWithRequest } from './tickets-view-test-support.tsx'
import { DEFAULT_VIEW, writeViewPreference } from './view-preference.ts'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const NOW = Date.parse('2026-11-12T15:00:00Z')

function ticket(
  ref: string,
  title: string,
  overrides: Partial<TicketSnapshot> = {},
): TicketSnapshot {
  return {
    ref,
    number: Number.parseInt(ref.slice(1), 10),
    title,
    state: 'open',
    category: null,
    status: 'ready',
    labels: [],
    author: null,
    assignees: [],
    skillAction: 'implement',
    skillActionReason: 'ready-for-agent',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-05T00:00:00Z',
    openBlockers: 0,
    ...overrides,
  }
}

const TICKETS: readonly TicketSnapshot[] = [
  ticket('#1', '父票'),
  ticket('#2', '子票一', { parent: '#1' }),
  ticket('#3', '子票二', { parent: '#1' }),
  ticket('#4', '另一个父票'),
  ticket('#5', '外部子票', { parent: '#99' }),
  ticket('#6', '已关闭子票', {
    state: 'closed',
    status: 'closed',
    skillAction: 'none',
    skillActionReason: 'closed',
    parent: '#4',
  }),
]

function snapshot(overrides: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    backend: 'gitlab',
    repository: 'cyit/harness',
    repositoryHost: 'gitlab.com',
    viewer: null,
    fetchedAt: NOW - 15_000,
    loaded: TICKETS.length,
    total: 10,
    windowLimit: 100,
    hierarchy: 'native',
    libraryVersion: 1,
    tickets: TICKETS,
    metrics: emptyMetrics(),
    blockersFinalized: true,
    source: 'live',
    stale: false,
    refreshError: null,
    ...overrides,
  }
}

const UNUSED_ENV_CHECK = (): Promise<RpcResult<EnvCheckReport>> =>
  Promise.resolve({
    ok: true,
    result: { checkedAt: NOW, backend: null, repository: null, items: [], capabilities: [] },
  })

function fakeClient(result: WorkspaceSnapshot): PanelClient {
  const ok = { ok: true as const, result }
  return {
    get: () => Promise.resolve(ok),
    more: () => Promise.resolve(ok),
    refresh: () => wrapRefresh(Promise.resolve(ok)),
    resolveBlockers: () => Promise.resolve(ok),
    cache: () =>
      Promise.resolve({
        ok: true,
        result: {
          location: '~/.dsh/cache/dsh-mattpocock-workflow/',
          entries: 0,
          lastWrittenAt: null,
          cleared: 0,
        },
      }),
    getDetail: () => Promise.reject(new Error('未使用')),
    updateTicket: () => Promise.reject(new Error('未使用')),
    getOptions: () =>
      Promise.resolve({ ok: false, error: { code: 'capability-unsupported', message: '未使用' } }),
    deleteTicket: () => Promise.reject(new Error('未使用')),
    getAttachment: () => Promise.reject(new Error('未使用')),
    envCheck: UNUSED_ENV_CHECK,
  }
}

interface RenderOptions {
  readonly workspaceRoot?: string
  readonly focusRef?: string | null
  readonly inject?: (text: string) => 'filled' | 'requested'
}

function viewElement(client: PanelClient, options: RenderOptions = {}): React.ReactElement {
  return (
    <TicketsViewWithRequest
      client={client}
      workspaceRoot={options.workspaceRoot ?? '/repo'}
      injection={fakeInjection(
        options.inject === undefined
          ? {}
          : { inject: (text: string) => options.inject?.(text) ?? 'filled' },
      )}
      now={() => NOW}
      onOpenEnvCheck={() => undefined}
      onOpenTicket={() => undefined}
      focusRef={options.focusRef ?? null}
    />
  )
}

function renderView(client: PanelClient, options: RenderOptions = {}): RenderResult {
  return render(viewElement(client, options))
}

function rows(): readonly HTMLElement[] {
  return screen.getAllByTestId('ticket-row')
}

function rowRefs(): readonly (string | null)[] {
  return rows().map((row) => row.getAttribute('data-ref'))
}

function row(ref: string): HTMLElement {
  const found = rows().find((element) => element.getAttribute('data-ref') === ref)
  if (found === undefined) throw new Error(`缺少工单行 ${ref}`)
  return found
}

function depth(ref: string): string | null {
  return row(ref).getAttribute('data-depth')
}

async function treeView(client: PanelClient = fakeClient(snapshot())): Promise<RenderResult> {
  const view = renderView(client)
  await screen.findAllByTestId('ticket-row')
  fireEvent.click(screen.getByTestId('layout-tree'))
  await waitFor(() => {
    expect(depth('#2')).toBe('1')
  })
  return view
}

describe('平铺与父子布局', () => {
  it('默认平铺，没有折叠按钮、子票数或父级徽标', async () => {
    renderView(fakeClient(snapshot()))
    await screen.findAllByTestId('ticket-row')

    expect(rowRefs()).toEqual(['#1', '#2', '#3', '#4', '#5'])
    expect(screen.queryAllByTestId('tree-toggle')).toHaveLength(0)
    expect(screen.queryAllByTestId('tree-child-count')).toHaveLength(0)
    expect(screen.queryAllByTestId('parent-badge')).toHaveLength(0)
    expect(rows().every((element) => element.getAttribute('data-depth') === null)).toBe(true)
    expect(screen.getByTestId('layout-flat').getAttribute('aria-pressed')).toBe('true')
  })

  it('切到父子后子票缩进挂在父票下，外部父级显示徽标', async () => {
    await treeView()

    expect(rowRefs()).toEqual(['#1', '#2', '#3', '#4', '#5'])
    expect([depth('#1'), depth('#2'), depth('#3'), depth('#4'), depth('#5')]).toEqual([
      '0',
      '1',
      '1',
      '0',
      '0',
    ])
    expect(row('#1').textContent).toContain('2 张子票')
    expect(row('#5').textContent).toContain('父级 #99')
    expect(screen.getAllByTestId('parent-badge')).toHaveLength(1)
  })

  it('折叠父票隐藏整棵子树，再展开恢复原排序', async () => {
    await treeView()

    fireEvent.click(screen.getByTestId('tree-toggle'))
    await waitFor(() => {
      expect(rowRefs()).toEqual(['#1', '#4', '#5'])
    })
    expect(screen.getByTestId('tree-toggle').getAttribute('aria-expanded')).toBe('false')
    expect(row('#1').textContent).toContain('2 张子票')

    fireEvent.click(screen.getByTestId('tree-toggle'))
    await waitFor(() => {
      expect(rowRefs()).toEqual(['#1', '#2', '#3', '#4', '#5'])
    })
    expect(screen.getByTestId('tree-toggle').getAttribute('aria-expanded')).toBe('true')
  })

  it('父票被筛掉时子票升到顶层并标出父级引用', async () => {
    await treeView()

    fireEvent.click(screen.getByTestId('filter-closed'))

    await waitFor(() => {
      expect(rowRefs()).toEqual(['#6'])
    })
    expect(depth('#6')).toBe('0')
    expect(row('#6').textContent).toContain('父级 #4')
  })

  it('折叠、刷新与排序不改变父子结构', async () => {
    const client = fakeClient(snapshot())
    const view = await treeView(client)
    fireEvent.click(screen.getByTestId('tree-toggle'))
    await waitFor(() => {
      expect(rowRefs()).toEqual(['#1', '#4', '#5'])
    })

    chooseSort('number')
    flipSortDirection()
    fireEvent.click(screen.getByTestId('refresh'))
    await waitFor(() => {
      expect(rowRefs()).toEqual(['#1', '#4', '#5'])
    })
    expect(view.getByTestId('layout-tree').getAttribute('aria-pressed')).toBe('true')
  })

  it('样本被截断时说明父子关系只覆盖已加载票', async () => {
    await treeView()

    expect(screen.getByTestId('tree-coverage').textContent).toContain('6')

    fireEvent.click(screen.getByTestId('layout-flat'))
    expect(screen.queryByTestId('tree-coverage')).toBeNull()
  })
})

describe('父子能力与降级', () => {
  it('父子能力为无时切换禁用并说明原因', async () => {
    renderView(fakeClient(snapshot({ backend: 'gitea', hierarchy: 'none' })))
    await screen.findAllByTestId('ticket-row')

    const toggle = screen.getByTestId<HTMLButtonElement>('layout-tree')
    expect(toggle.disabled).toBe(true)
    // Gitea 的「无」只来自升级前的旧缓存，给通用说明，不再说暂不支持子工单。
    expect(toggle.getAttribute('title')).toBe('当前后端不提供父子关系')
    expect(screen.getByTestId('tree-unavailable').textContent).toContain('当前后端不提供父子关系')
    expect(screen.getByTestId('tree-unavailable').textContent).not.toContain('Gitea')
    expect(rowRefs()).toEqual(['#1', '#2', '#3', '#4', '#5'])
  })

  it('偏好是父子但能力为无时按平铺显示并说明，偏好保留', async () => {
    writeViewPreference(window.localStorage, '/repo', { ...DEFAULT_VIEW, layout: 'tree' })
    renderView(fakeClient(snapshot({ backend: 'gitlab', hierarchy: 'none' })))
    await screen.findAllByTestId('ticket-row')

    expect(screen.getByTestId('tree-degraded')).toBeTruthy()
    expect(screen.getByTestId('layout-tree').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId<HTMLButtonElement>('layout-tree').disabled).toBe(true)
    expect(rows().every((element) => element.getAttribute('data-depth') === null)).toBe(true)
    expect(screen.queryAllByTestId('tree-toggle')).toHaveLength(0)
  })

  it('布局按工作区记住，切换回来仍是父子', async () => {
    const client = fakeClient(snapshot())
    const view = await treeView(client)

    view.rerender(viewElement(client, { workspaceRoot: '/two' }))
    await waitFor(() => {
      expect(screen.getByTestId('layout-flat').getAttribute('aria-pressed')).toBe('true')
    })
    expect(depth('#2')).toBeNull()

    view.rerender(viewElement(client, { workspaceRoot: '/repo' }))
    await waitFor(() => {
      expect(depth('#2')).toBe('1')
    })
    expect(screen.getByTestId('layout-tree').getAttribute('aria-pressed')).toBe('true')
  })

  it('父子行上的技能徽标、计数与排序与平铺一致', async () => {
    const injected: string[] = []
    const client = fakeClient(snapshot())
    const view = renderView(client, {
      inject: (text) => {
        injected.push(text)
        return 'filled'
      },
    })
    await screen.findAllByTestId('ticket-row')
    expect(screen.getByTestId('stat-ready').textContent).toContain('5')
    const flatOrder = rowRefs()

    fireEvent.click(screen.getByTestId('layout-tree'))
    await waitFor(() => {
      expect(depth('#2')).toBe('1')
    })
    expect(rowRefs()).toEqual(flatOrder)
    expect(screen.getByTestId('stat-ready').textContent).toContain('5')
    expect(screen.getAllByTestId('skill-badge')).toHaveLength(5)

    const badge = screen.getAllByTestId('skill-badge')[0]
    if (badge === undefined) throw new Error('缺少技能徽标')
    fireEvent.click(badge)
    expect(injected).toHaveLength(1)
    expect(view.getByTestId('tickets-view')).toBeTruthy()
  })

  it('从概览定位被折叠的子票时自动展开祖先链', async () => {
    const client = fakeClient(snapshot())
    const view = await treeView(client)
    fireEvent.click(screen.getByTestId('tree-toggle'))
    await waitFor(() => {
      expect(rowRefs()).toEqual(['#1', '#4', '#5'])
    })

    view.rerender(viewElement(client, { focusRef: '#2' }))

    await waitFor(() => {
      expect(rowRefs()).toContain('#2')
    })
    expect(screen.getByTestId('tree-toggle').getAttribute('aria-expanded')).toBe('true')
    expect(row('#2').getAttribute('data-focused')).toBe('true')
  })
})

/** `to-tickets` 在 Gitea 上发布的一组票：来源 spec 与它的直接子票。 */
const GITEA_SPEC_TICKETS: readonly TicketSnapshot[] = [
  ticket('#15', '来源 spec'),
  ticket('#16', 'ticket 一', { parent: '#15' }),
  ticket('#17', 'ticket 二', {
    parent: '#15',
    status: 'blocked',
    skillActionReason: 'blocked',
    openBlockers: 1,
  }),
  ticket('#9', '无关的票'),
]

function giteaSnapshot(tickets: readonly TicketSnapshot[]): WorkspaceSnapshot {
  return snapshot({
    backend: 'gitea',
    repository: 'cnzgray/dsh-workflow',
    repositoryHost: 'gitea.example.com',
    hierarchy: 'convention',
    tickets,
    loaded: tickets.length,
    total: tickets.length,
  })
}

describe('Gitea 正文约定的父子布局', () => {
  it('to-tickets 的 ticket 缩进挂在来源 spec 下，说明写明 Part of 约定', async () => {
    renderView(fakeClient(giteaSnapshot(GITEA_SPEC_TICKETS)))
    await screen.findAllByTestId('ticket-row')

    const toggle = screen.getByTestId<HTMLButtonElement>('layout-tree')
    expect(toggle.disabled).toBe(false)
    expect(toggle.getAttribute('title')).toContain('Part of')
    expect(screen.queryByTestId('tree-unavailable')).toBeNull()

    fireEvent.click(toggle)
    await waitFor(() => {
      expect(depth('#16')).toBe('1')
    })
    expect([depth('#15'), depth('#17'), depth('#9')]).toEqual(['0', '1', '0'])
    expect(row('#15').textContent).toContain('2 张子票')
    expect(screen.queryAllByTestId('parent-badge')).toHaveLength(0)
  })

  it('来源 spec 不在当前窗口时 ticket 升到顶层并带父级徽标', async () => {
    renderView(fakeClient(giteaSnapshot(GITEA_SPEC_TICKETS.filter((item) => item.ref !== '#15'))))
    await screen.findAllByTestId('ticket-row')
    fireEvent.click(screen.getByTestId('layout-tree'))

    await waitFor(() => {
      expect(screen.getAllByTestId('parent-badge')).toHaveLength(2)
    })
    expect([depth('#16'), depth('#17')]).toEqual(['0', '0'])
    expect(row('#16').textContent).toContain('父级 #15')
    expect(rowRefs()).not.toContain('#15')
  })

  it('没有父级的 Gitea 票以顶层行显示，切换仍可用', async () => {
    renderView(fakeClient(giteaSnapshot([ticket('#1', '平铺一'), ticket('#2', '平铺二')])))
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('layout-tree'))

    await waitFor(() => {
      expect(depth('#1')).toBe('0')
    })
    expect(depth('#2')).toBe('0')
    expect(screen.queryAllByTestId('tree-toggle')).toHaveLength(0)
  })
})

describe('父级引用只做提示', () => {
  it('父级在列表外时不伪造父行，父级徽标带完整说明', async () => {
    await treeView()

    const badge = screen.getByTestId('parent-badge')
    expect(badge.textContent).toContain('#99')
    expect(badge.getAttribute('title')).toContain('不在当前列表')
    expect(rowRefs()).not.toContain('#99')
  })

  it('自引用与环上的票仍显示为顶层行，不丢票', async () => {
    const cyclic = [
      ticket('#1', '自引用', { parent: '#1' }),
      ticket('#2', '环 A', { parent: '#3' }),
      ticket('#3', '环 B', { parent: '#2' }),
    ]
    const client = fakeClient(
      snapshot({ tickets: cyclic, loaded: cyclic.length, total: cyclic.length }),
    )
    renderView(client)
    await screen.findAllByTestId('ticket-row')
    fireEvent.click(screen.getByTestId('layout-tree'))

    await waitFor(() => {
      expect(rowRefs()).toEqual(['#1', '#2', '#3'])
    })
    expect(rows().every((element) => element.getAttribute('data-depth') === '0')).toBe(true)
  })
})

describe('切换布局不发请求', () => {
  it('点击父子与平铺不触发刷新或加载更多', async () => {
    const client = fakeClient(snapshot())
    const refresh = vi.spyOn(client, 'refresh')
    const more = vi.spyOn(client, 'more')
    renderView(client)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('layout-tree'))
    fireEvent.click(screen.getByTestId('layout-flat'))

    expect(refresh).not.toHaveBeenCalled()
    expect(more).not.toHaveBeenCalled()
  })
})
