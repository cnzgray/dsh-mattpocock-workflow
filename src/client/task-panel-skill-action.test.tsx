/**
 * 工单行的技能徽标：徽标文字、悬停依据、点击注入、不可开工的原因徽标。
 * 直接渲染列表视图，注入文本与徽标都从同一个界面接缝观察。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'

import type { EnvCheckReport } from '../protocol/env-check.ts'
import { emptyMetrics } from '../protocol/snapshot-test-support.ts'
import type { RpcResult, TicketSnapshot, WorkspaceSnapshot } from '../protocol/tracker.ts'
import type { InjectionOutcome, InjectionTarget, PromptInjection } from './injection.ts'
import { fakeInjection } from './injection-test-support.ts'
import type { PanelClient } from './rpc.ts'
import { TicketsViewWithRequest } from './tickets-view-test-support.tsx'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const NOW = Date.parse('2026-11-12T15:00:00Z')

function ticket(overrides: Partial<TicketSnapshot> & Pick<TicketSnapshot, 'ref'>): TicketSnapshot {
  const number = Number.parseInt(overrides.ref.slice(1), 10)
  return {
    number,
    title: `票 ${String(number)}`,
    state: 'open',
    category: null,
    status: 'open',
    skillAction: 'triage',
    skillActionReason: 'untriaged',
    labels: [],
    author: null,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    openBlockers: 0,
    ...overrides,
  }
}

const TICKETS: readonly TicketSnapshot[] = [
  ticket({
    ref: '#10',
    title: '可接的需求',
    category: 'enhancement',
    status: 'ready',
    skillAction: 'implement',
    skillActionReason: 'ready-for-agent',
    updatedAt: '2026-11-10T00:00:00Z',
  }),
  ticket({
    ref: '#11',
    title: '可接的缺陷',
    category: 'bug',
    status: 'ready',
    skillAction: 'diagnose',
    skillActionReason: 'bug',
    updatedAt: '2026-11-09T00:00:00Z',
  }),
  ticket({
    ref: '#12',
    title: '待定性',
    skillAction: 'triage',
    skillActionReason: 'needs-triage',
    updatedAt: '2026-11-08T00:00:00Z',
  }),
  ticket({
    ref: '#13',
    title: '缺信息',
    skillAction: 'triage',
    skillActionReason: 'needs-info',
    updatedAt: '2026-11-07T00:00:00Z',
  }),
  ticket({
    ref: '#14',
    title: '已关闭的票',
    state: 'closed',
    category: 'bug',
    status: 'closed',
    skillAction: 'none',
    skillActionReason: 'closed',
    updatedAt: '2026-11-06T00:00:00Z',
  }),
  ticket({
    ref: '#15',
    title: '被阻塞的票',
    status: 'blocked',
    skillAction: 'none',
    skillActionReason: 'blocked',
    openBlockers: 2,
    updatedAt: '2026-11-05T00:00:00Z',
  }),
  ticket({
    ref: '#16',
    title: '决定不做',
    category: 'enhancement',
    status: 'ready',
    skillAction: 'none',
    skillActionReason: 'wontfix',
    updatedAt: '2026-11-04T00:00:00Z',
  }),
  ticket({
    ref: '#17',
    title: '需要人工',
    category: 'enhancement',
    status: 'ready',
    skillAction: 'none',
    skillActionReason: 'ready-for-human',
    updatedAt: '2026-11-03T00:00:00Z',
  }),
  ticket({
    ref: '#18',
    title: '可接但未分类',
    status: 'ready',
    skillAction: 'implement',
    skillActionReason: 'ready-for-agent',
    updatedAt: '2026-11-02T00:00:00Z',
  }),
]

const SNAPSHOT: WorkspaceSnapshot = {
  backend: 'github',
  repository: 'cnzgray/repo',
  repositoryHost: 'github.com',
  fetchedAt: NOW - 5_000,
  loaded: TICKETS.length,
  total: TICKETS.length,
  tickets: TICKETS,
  metrics: emptyMetrics(),
  blockersFinalized: true,
  source: 'live',
  stale: false,
  refreshError: null,
}

const UNUSED_ENV_CHECK = (): Promise<RpcResult<EnvCheckReport>> =>
  Promise.resolve({
    ok: true,
    result: { checkedAt: NOW, backend: null, repository: null, items: [], capabilities: [] },
  })

function fakeClient(): PanelClient {
  return {
    get: () => Promise.resolve({ ok: true, result: SNAPSHOT }),
    refresh: () => Promise.resolve({ ok: true, result: SNAPSHOT }),
    resolveBlockers: () => Promise.resolve({ ok: true, result: SNAPSHOT }),
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
    envCheck: UNUSED_ENV_CHECK,
  }
}

function renderView(
  options: {
    readonly injection?: PromptInjection
    readonly onOpenTicket?: (ticket: TicketSnapshot) => void
  } = {},
): void {
  render(
    <TicketsViewWithRequest
      client={fakeClient()}
      workspaceRoot="/repo"
      injection={options.injection ?? fakeInjection()}
      now={() => NOW}
      onOpenEnvCheck={() => undefined}
      onOpenTicket={options.onOpenTicket ?? (() => undefined)}
    />,
  )
}

function rowFor(ref: string): HTMLElement {
  const row = screen
    .queryAllByTestId('ticket-row')
    .find((item) => item.getAttribute('data-ref') === ref)
  if (row === undefined) throw new Error(`缺少 ${ref} 的工单行`)
  return row
}

function badgeFor(ref: string): HTMLButtonElement {
  const badge = screen
    .queryAllByTestId<HTMLButtonElement>('skill-badge')
    .find((item) => item.getAttribute('data-ref') === ref)
  if (badge === undefined) throw new Error(`缺少 ${ref} 的技能徽标`)
  return badge
}

function reasonFor(ref: string): HTMLElement {
  const badge = screen
    .queryAllByTestId('action-reason')
    .find((item) => item.getAttribute('data-ref') === ref)
  if (badge === undefined) throw new Error(`缺少 ${ref} 的原因徽标`)
  return badge
}

describe('工单行的技能徽标', () => {
  it('可接的需求显示 implement 徽标，点徽标填入实现提示词', async () => {
    const injectDraft = vi.fn<(text: string, target: InjectionTarget) => InjectionOutcome>(
      () => 'filled',
    )
    renderView({ injection: fakeInjection({ inject: injectDraft }) })
    await screen.findAllByTestId('ticket-row')

    const badge = badgeFor('#10')
    expect(badge.textContent).toBe('implement')
    expect(badge.title).toContain('ready-for-agent')

    fireEvent.click(badge)

    expect(injectDraft).toHaveBeenCalledTimes(1)
    expect(injectDraft).toHaveBeenLastCalledWith('/implement #10', 'current-session')
  })

  it('可接的缺陷显示 diagnosing-bugs 徽标并填入对应技能的提示词', async () => {
    const injectDraft = vi.fn<(text: string, target: InjectionTarget) => InjectionOutcome>(
      () => 'filled',
    )
    renderView({ injection: fakeInjection({ inject: injectDraft }) })
    await screen.findAllByTestId('ticket-row')

    const badge = badgeFor('#11')
    expect(badge.textContent).toBe('diagnosing-bugs')

    fireEvent.click(badge)

    expect(injectDraft).toHaveBeenLastCalledWith('/diagnosing-bugs #11', 'current-session')
  })

  it('带 needs-triage 的票显示 triage 徽标并填入对应技能的提示词', async () => {
    const injectDraft = vi.fn<(text: string, target: InjectionTarget) => InjectionOutcome>(
      () => 'filled',
    )
    renderView({ injection: fakeInjection({ inject: injectDraft }) })
    await screen.findAllByTestId('ticket-row')

    const badge = badgeFor('#12')
    expect(badge.textContent).toBe('triage')

    fireEvent.click(badge)

    expect(injectDraft).toHaveBeenLastCalledWith('/triage #12', 'current-session')
  })

  it('带 needs-info 的票用同一段 triage 提示词，追问由技能正文负责', async () => {
    const injectDraft = vi.fn<(text: string, target: InjectionTarget) => InjectionOutcome>(
      () => 'filled',
    )
    renderView({ injection: fakeInjection({ inject: injectDraft }) })
    await screen.findAllByTestId('ticket-row')

    const badge = badgeFor('#13')
    expect(badge.textContent).toBe('triage')
    expect(badge.title).toContain('needs-info')

    fireEvent.click(badge)

    expect(injectDraft).toHaveBeenLastCalledWith('/triage #13', 'current-session')
  })

  it('可接但没有分类标签的票仍然显示 implement 徽标', async () => {
    renderView()
    await screen.findAllByTestId('ticket-row')

    expect(badgeFor('#18').textContent).toBe('implement')
  })

  it('点击工单行只打开详情，不填入提示词', async () => {
    const injectDraft = vi.fn<(text: string, target: InjectionTarget) => InjectionOutcome>(
      () => 'filled',
    )
    const onOpenTicket = vi.fn<(ticket: TicketSnapshot) => void>()
    renderView({ injection: fakeInjection({ inject: injectDraft }), onOpenTicket })
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(rowFor('#10'))

    expect(onOpenTicket).toHaveBeenCalledWith(expect.objectContaining({ ref: '#10' }))
    expect(injectDraft).not.toHaveBeenCalled()
  })

  it.each([
    ['#14', '已关闭', '已关闭'],
    ['#15', '阻塞 2', '阻塞工单'],
    ['#16', 'wontfix', 'wontfix'],
    ['#17', '需人工实现', 'ready-for-human'],
  ] as const)('%s 显示原因徽标且没有注入入口', async (ref, label, hint) => {
    const injectDraft = vi.fn<(text: string, target: InjectionTarget) => InjectionOutcome>(
      () => 'filled',
    )
    renderView({ injection: fakeInjection({ inject: injectDraft }) })
    await screen.findAllByTestId('ticket-row')
    // 默认视图只看未关闭工单；原因徽标要覆盖已关闭的票，先放开筛选。
    fireEvent.click(screen.getByTestId('filter-all'))

    const reason = reasonFor(ref)
    expect(reason.textContent).toBe(label)
    expect(reason.title).toContain(hint)
    expect(
      screen
        .queryAllByTestId('skill-badge')
        .some((badge) => badge.getAttribute('data-ref') === ref),
    ).toBe(false)

    fireEvent.click(rowFor(ref))
    expect(injectDraft).not.toHaveBeenCalled()
  })

  it('没有可用会话时技能徽标不可点', async () => {
    const injectDraft = vi.fn<(text: string, target: InjectionTarget) => InjectionOutcome>(
      () => 'filled',
    )
    renderView({ injection: fakeInjection({ canInjectCurrent: false, inject: injectDraft }) })
    await screen.findAllByTestId('ticket-row')

    const badges = screen.getAllByTestId<HTMLButtonElement>('skill-badge')
    expect(badges).toHaveLength(5)
    expect(badges.every((badge) => badge.disabled)).toBe(true)
    expect(badgeFor('#10').title).toContain('无法填入提示词')
    expect(screen.getByTestId('no-session-hint').textContent).toContain('没有可用会话')

    fireEvent.click(badgeFor('#10'))
    expect(injectDraft).not.toHaveBeenCalled()
  })

  it('新建入口会清掉工单的已填入标记', async () => {
    const injectDraft = vi.fn<(text: string, target: InjectionTarget) => InjectionOutcome>(
      () => 'filled',
    )
    renderView({ injection: fakeInjection({ inject: injectDraft }) })
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(badgeFor('#10'))
    expect(badgeFor('#10').getAttribute('data-injected')).toBe('true')

    fireEvent.click(screen.getByTestId('new-bug'))

    expect(injectDraft).toHaveBeenLastCalledWith(
      expect.stringContaining('/mattwf-bug'),
      'current-session',
    )
    expect(badgeFor('#10').getAttribute('data-injected')).toBeNull()
  })

  it('注入标记只跟着最近一次填入的票走', async () => {
    renderView()
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(badgeFor('#10'))
    expect(badgeFor('#10').getAttribute('data-injected')).toBe('true')

    fireEvent.click(badgeFor('#13'))
    expect(badgeFor('#13').getAttribute('data-injected')).toBe('true')
    expect(badgeFor('#10').getAttribute('data-injected')).toBeNull()
  })
})
