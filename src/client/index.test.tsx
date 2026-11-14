/**
 * 客户端入口的接缝：真实面板组件 + 假 DSH 服务。
 * 断言只落在「点了哪个按钮 → 宿主收到了什么调用」上，不碰组件内部状态。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'

import { emptyMetrics } from '../protocol/snapshot-test-support.ts'
import { ACTIVITY_SETTLE_MS } from './agent-activity.ts'
import { apply } from './index.tsx'
import { createFakeRightColumn } from './panel-follow-test-support.ts'

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

const TICKETS = [
  {
    ref: '#7',
    number: 7,
    title: '可接的需求',
    state: 'open',
    category: 'enhancement',
    status: 'ready',
    labels: ['enhancement', 'ready-for-agent'],
    author: null,
    skillAction: 'implement',
    skillActionReason: 'ready-for-agent',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    openBlockers: 0,
  },
]

const SNAPSHOT = {
  backend: 'github',
  repository: 'owner/repo',
  repositoryHost: 'github.com',
  fetchedAt: 1,
  loaded: TICKETS.length,
  total: TICKETS.length,
  tickets: TICKETS,
  metrics: emptyMetrics(),
  blockersFinalized: true,
  source: 'live',
  stale: false,
  refreshError: null,
}

/** 与 DSH 客户端根上下文一致的最小形状。 */
interface ContextLike {
  get(name: string): unknown
  inject(deps: readonly string[], callback: (scope: ContextLike) => unknown): unknown
  effect(setup: () => () => void, label?: string): unknown
}

interface SessionsState {
  readonly byId: Record<string, SessionRow | undefined>
}

interface SessionRow {
  readonly cwd: string
  readonly running: boolean
  readonly updatedAt: number
}

type UseSessions = <T>(selector: (state: SessionsState) => T) => T | undefined

/** 一次面板发往宿主的 RPC 请求。 */
interface RequestRecord {
  readonly method: string
  readonly params: unknown
}

interface StartCall {
  readonly workspaceId: string | undefined
  readonly options: { readonly prompt?: string; readonly whenDraftExists?: string } | undefined
}

interface Harness {
  readonly drafts: readonly { readonly sessionId: string; readonly text: string }[]
  readonly startCalls: readonly StartCall[]
  readonly submits: { count: number }
  /** 面板发往宿主的 RPC，按发生顺序。 */
  readonly requests: readonly RequestRecord[]
  /** 宿主右栏收到的 openTab 调用，按发生顺序。 */
  readonly tabOpens: readonly string[]
  /** 模拟会话切换：右栏在屏会话变化的通知。 */
  readonly showSession: (sessionId: string | undefined) => void
  /** 设置右栏的页签清单。 */
  readonly setRightTabs: (
    tabs: readonly { readonly sessionId: string; readonly kind: string }[],
  ) => void
  /** 让会话与对话服务晚一步就绪，用来观察注入能力的恢复。 */
  readonly addConversation: () => void
  /** 改会话的运行状态与最近活动时间，模拟 agent 跑完一轮。 */
  readonly setActivity: (row: { readonly running: boolean; readonly updatedAt: number }) => void
}

/**
 * 装配真实入口与真实面板，只把会话、对话与工作区导航换成可记录调用的假实现。
 * @param options - 关掉 `withUiWorkspace` 模拟宿主缺新建会话能力；关掉
 * `withConversation` 模拟服务晚就绪。
 * @returns 记录下来的宿主调用。
 */
function setup(
  options: { readonly withUiWorkspace?: boolean; readonly withConversation?: boolean } = {},
): Harness {
  const drafts: { sessionId: string; text: string }[] = []
  const startCalls: StartCall[] = []
  const submits = { count: 0 }
  let registered: React.ComponentType<Record<string, unknown>> | undefined

  const rightColumn = createFakeRightColumn()

  const services: Record<string, unknown> = {
    slots: {
      inject: (_name: string, factory: () => () => void) => {
        factory()
        return () => undefined
      },
      register: (registration: { readonly name: string }, component: unknown) => {
        if (registration.name === 'sidebar.right.pane.tab') {
          registered = component as React.ComponentType<Record<string, unknown>>
        }
        return () => undefined
      },
    },
    sidebarRightTabs: { register: () => () => undefined },
    sidebarRight: rightColumn.service,
  }
  if (options.withUiWorkspace !== false) {
    services.uiWorkspace = {
      startSession: (workspaceId: string | undefined, startOptions: StartCall['options']) => {
        startCalls.push({ workspaceId, options: startOptions })
      },
    }
  }

  const pending: {
    readonly deps: readonly string[]
    readonly callback: (s: ContextLike) => unknown
  }[] = []
  const scope: ContextLike = {
    get: (name) => services[name],
    inject: (deps, callback) => {
      if (deps.every((dep) => services[dep] !== undefined)) callback(scope)
      else pending.push({ deps, callback })
      return () => undefined
    },
    effect: (setupEffect) => {
      setupEffect()
      return () => undefined
    },
  }

  const addConversation = (): void => {
    services.sessions = { scope: (id: string) => ({ id }) }
    services.conversation = {
      input: {
        for: (sessionScope: { readonly id: string }) => ({
          setDraft: (text: string) => {
            drafts.push({ sessionId: sessionScope.id, text })
          },
          submit: () => {
            submits.count += 1
          },
        }),
      },
    }
    for (const item of pending.splice(0)) item.callback(scope)
  }
  if (options.withConversation !== false) addConversation()

  const requests: RequestRecord[] = []
  vi.stubGlobal('fetch', (_input: string, init: { readonly body: string }) => {
    requests.push(JSON.parse(init.body) as RequestRecord)
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true, result: SNAPSHOT }),
    })
  })

  apply({
    get: (name) => services[name],
    inject: (_deps, callback) => {
      callback(scope)
      return undefined
    },
    effect: () => undefined,
  })

  const Tab = registered
  if (Tab === undefined) throw new Error('页签内容未注册')

  const row: { cwd: string; running: boolean; updatedAt: number } = {
    cwd: '/repo',
    running: false,
    updatedAt: 1,
  }
  const sessions: UseSessions = (selector) => selector({ byId: { s1: row } })
  const view = render(React.createElement(Tab, { sessionId: 's1', useSessions: sessions }))
  const setActivity = (next: { readonly running: boolean; readonly updatedAt: number }): void => {
    row.running = next.running
    row.updatedAt = next.updatedAt
    view.rerender(React.createElement(Tab, { sessionId: 's1', useSessions: sessions }))
  }

  return {
    drafts,
    startCalls,
    submits,
    requests,
    tabOpens: rightColumn.opens,
    showSession: (sessionId) => {
      rightColumn.show(sessionId)
    },
    setRightTabs: (tabs) => {
      rightColumn.setTabs(tabs)
    },
    addConversation,
    setActivity,
  }
}

describe('客户端入口', () => {
  it('注入能力就绪前禁用面板动作，就绪后恢复', async () => {
    const harness = setup({ withConversation: false })
    await screen.findByTestId('new-feature')
    expect(screen.getByTestId<HTMLButtonElement>('new-feature').disabled).toBe(true)

    act(() => {
      harness.addConversation()
    })

    await waitFor(() => {
      expect(screen.getByTestId<HTMLButtonElement>('new-feature').disabled).toBe(false)
    })
  })

  it('主键填当前会话，小箭头把同一段提示词交给新会话且不自动发送', async () => {
    const harness = setup()
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('new-feature'))

    expect(harness.drafts).toHaveLength(1)
    const prompt = harness.drafts[0]?.text ?? ''
    expect(prompt).toMatch(/^\/mattwf-feature/)
    expect(harness.startCalls).toEqual([])
    expect(screen.getByTestId('inject-notice').textContent).toContain('已填入')

    fireEvent.click(screen.getByTestId('new-feature-new-session'))

    expect(harness.startCalls).toEqual([
      {
        workspaceId: undefined,
        options: { prompt, whenDraftExists: 'append' },
      },
    ])
    // 当前会话的输入框没有被改写，也没有任何路径触发发送。
    expect(harness.drafts).toHaveLength(1)
    expect(harness.submits.count).toBe(0)
    expect(screen.getByTestId('inject-notice').textContent).toContain('已请求')

    fireEvent.click(screen.getByTestId('new-bug-new-session'))

    expect(harness.startCalls).toHaveLength(2)
    expect(harness.startCalls[1]?.options?.prompt).toMatch(/^\/mattwf-bug/)
    expect(harness.startCalls[1]?.options?.whenDraftExists).toBe('append')
    expect(harness.drafts).toHaveLength(1)

    fireEvent.click(screen.getByTestId('new-spec'))

    expect(harness.drafts).toHaveLength(2)
    const specPrompt = harness.drafts[1]?.text ?? ''
    expect(specPrompt).toMatch(/^\/to-spec/)
    expect(harness.startCalls).toHaveLength(2)

    fireEvent.click(screen.getByTestId('new-spec-new-session'))

    expect(harness.startCalls).toHaveLength(3)
    expect(harness.startCalls[2]?.options?.prompt).toBe(specPrompt)
    expect(harness.startCalls[2]?.options?.whenDraftExists).toBe('append')
    // 当前会话只有自己那一次注入，也没有任何路径触发发送。
    expect(harness.drafts).toHaveLength(2)
    expect(harness.submits.count).toBe(0)
  })

  it('工单徽标的两个目标拿到同一段提示词，只有主键标记已填入', async () => {
    const harness = setup()
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('skill-badge-new-session'))

    expect(harness.drafts).toEqual([])
    const prompt = harness.startCalls[0]?.options?.prompt ?? ''
    expect(prompt).toBe('/implement #7')
    expect(screen.getByTestId('skill-badge').getAttribute('data-injected')).toBeNull()

    fireEvent.click(screen.getByTestId('skill-badge'))

    expect(harness.drafts).toHaveLength(1)
    expect(harness.drafts[0]?.text).toBe(prompt)
    expect(screen.getByTestId('skill-badge').getAttribute('data-injected')).toBe('true')

    fireEvent.click(screen.getByTestId('skill-badge-new-session'))
    expect(harness.startCalls).toHaveLength(2)
    // 小箭头没有动当前输入框，标记保持。
    expect(screen.getByTestId('skill-badge').getAttribute('data-injected')).toBe('true')
    expect(harness.submits.count).toBe(0)
  })

  it('宿主缺新建会话能力时小箭头禁用并说明原因，主键照常可用', async () => {
    const harness = setup({ withUiWorkspace: false })
    await screen.findAllByTestId('ticket-row')

    const arrow = screen.getByTestId<HTMLButtonElement>('new-feature-new-session')
    expect(arrow.disabled).toBe(true)
    expect(arrow.title).toContain('宿主未提供新建会话能力')
    expect(arrow.getAttribute('aria-label')).toContain('宿主未提供新建会话能力')

    // 三个分裂动作的小箭头同一套规则：只禁用箭头，主键仍能填当前会话。
    const specArrow = screen.getByTestId<HTMLButtonElement>('new-spec-new-session')
    expect(specArrow.disabled).toBe(true)
    expect(specArrow.title).toContain('宿主未提供新建会话能力')

    fireEvent.click(screen.getByTestId('new-feature'))
    expect(harness.drafts).toHaveLength(1)

    fireEvent.click(screen.getByTestId('new-spec'))
    expect(harness.drafts).toHaveLength(2)
    expect(harness.drafts[1]?.text).toMatch(/^\/to-spec/)
  })

  it('agent 这一轮停下来之后，面板自己增量刷新一次工单', async () => {
    const harness = setup()
    await screen.findAllByTestId('ticket-row')
    expect(harness.requests.map((request) => request.method)).toEqual(['snapshot.get'])

    act(() => {
      harness.setActivity({ running: true, updatedAt: 2 })
    })
    act(() => {
      harness.setActivity({ running: false, updatedAt: 3 })
    })

    // 活动停下后等一个安静窗口再刷新；刷新走增量，不重拉整表。
    await act(async () => {
      const settled = Promise.withResolvers<number>()
      setTimeout(() => {
        settled.resolve(0)
      }, ACTIVITY_SETTLE_MS + 200)
      await settled.promise
    })

    const refreshes = harness.requests.filter((request) => request.method === 'snapshot.refresh')
    expect(refreshes).toHaveLength(1)
    expect(refreshes[0]?.params).toEqual({ workspaceRoot: '/repo' })
    expect(harness.requests.filter((request) => request.method === 'snapshot.get')).toHaveLength(1)
  })

  it('新会话到来时把 MattWorkflow 页签带过去', async () => {
    const harness = setup()
    await screen.findAllByTestId('ticket-row')

    act(() => {
      harness.setRightTabs([{ sessionId: 's0', kind: 'dsh-mattpocock-workflow' }])
      harness.showSession('s0')
    })
    act(() => {
      harness.showSession('s1')
    })

    await waitFor(() => {
      expect(harness.tabOpens).toEqual(['dsh-mattpocock-workflow'])
    })
  })
})
