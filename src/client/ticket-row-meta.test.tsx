/**
 * 工单行的元信息：创建人（用户名 + 头像 / 色块）、全部标签与相对创建时间。
 * 直接渲染列表视图，只断言可见文本、alt / aria-label 与 data-* 标记。
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import * as React from 'react'

import type { EnvCheckReport } from '../protocol/env-check.ts'
import { emptyMetrics } from '../protocol/snapshot-test-support.ts'
import type {
  RpcResult,
  TicketAuthor,
  TicketSnapshot,
  WorkspaceSnapshot,
} from '../protocol/tracker.ts'
import { fakeInjection } from './injection-test-support.ts'
import type { PanelClient } from './rpc.ts'
import { TicketsViewWithRequest } from './tickets-view-test-support.tsx'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const NOW = Date.parse('2026-11-12T15:00:00Z')
const AVATAR = 'https://avatars.githubusercontent.com/u/1234?v=4'

const ALICE: TicketAuthor = { login: 'alice', displayName: 'Alice Zhang', avatarUrl: AVATAR }
const BOB: TicketAuthor = { login: 'bob', displayName: null, avatarUrl: null }
const CAROL: TicketAuthor = { login: 'carol', displayName: 'Carol', avatarUrl: null }

function ticket(overrides: Partial<TicketSnapshot> & Pick<TicketSnapshot, 'ref'>): TicketSnapshot {
  const number = Number.parseInt(overrides.ref.slice(1), 10)
  return {
    number,
    title: `票 ${String(number)}`,
    state: 'open',
    category: null,
    status: 'open',
    labels: [],
    author: null,
    assignees: [],
    skillAction: 'triage',
    skillActionReason: 'untriaged',
    createdAt: '2026-11-12T13:00:00Z',
    updatedAt: '2026-11-12T14:00:00Z',
    openBlockers: 0,
    ...overrides,
  }
}

const TICKETS: readonly TicketSnapshot[] = [
  ticket({
    ref: '#1',
    title: '带头像的票',
    category: 'enhancement',
    labels: ['enhancement', 'ready-for-agent', 'needs-info'],
    author: ALICE,
  }),
  ticket({ ref: '#2', title: '没有头像的票', author: BOB }),
  ticket({ ref: '#3', title: '同一个人提的另一张票', author: BOB }),
  ticket({ ref: '#4', title: '另一个没头像的用户', author: CAROL }),
  ticket({
    ref: '#5',
    title: '本地 Markdown 票',
    labels: ['ready-for-agent'],
    author: null,
  }),
  ticket({
    ref: '#6',
    title: '标签很多',
    category: 'enhancement',
    labels: ['enhancement', 'area:ui', 'area:core', 'needs-design', 'priority:high'],
    author: CAROL,
  }),
  ticket({
    ref: '#7',
    title: '伪造成头像地址',
    author: { login: 'mallory', displayName: 'Mallory', avatarUrl: 'javascript:alert(1)' },
  }),
]

const SNAPSHOT: WorkspaceSnapshot = {
  backend: 'github',
  repository: 'cnzgray/repo',
  repositoryHost: 'github.com',
  viewer: 'cnzgray',
  fetchedAt: NOW - 15_000,
  loaded: TICKETS.length,
  total: TICKETS.length,
  windowLimit: TICKETS.length,
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

function fakeClient(snapshot: WorkspaceSnapshot = SNAPSHOT): PanelClient {
  return {
    get: () => Promise.resolve({ ok: true, result: snapshot }),
    more: () => Promise.resolve({ ok: true, result: snapshot }),
    refresh: () => Promise.resolve({ ok: true, result: snapshot }),
    resolveBlockers: () => Promise.resolve({ ok: true, result: snapshot }),
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

async function renderRows(tickets: readonly TicketSnapshot[] = TICKETS): Promise<void> {
  const snapshot: WorkspaceSnapshot = {
    ...SNAPSHOT,
    tickets,
    loaded: tickets.length,
    total: tickets.length,
  }
  render(
    <TicketsViewWithRequest
      client={fakeClient(snapshot)}
      workspaceRoot="/repo"
      injection={fakeInjection()}
      now={() => NOW}
      onOpenEnvCheck={() => undefined}
      onOpenTicket={() => undefined}
    />,
  )
  await screen.findAllByTestId('ticket-row')
}

function rowFor(ref: string): HTMLElement {
  const row = screen
    .queryAllByTestId('ticket-row')
    .find((item) => item.getAttribute('data-ref') === ref)
  if (row === undefined) throw new Error(`缺少 ${ref} 的工单行`)
  return row
}

describe('工单行的创建人', () => {
  it('显示用户名、头像与相对创建时间，时间悬停给出完整时间戳', async () => {
    await renderRows()

    const row = rowFor('#1')
    const avatar = within(row).getByRole('img', { name: '创建人：Alice Zhang' })
    expect(avatar.tagName).toBe('IMG')
    expect(avatar.getAttribute('src')).toBe(AVATAR)
    expect(avatar.getAttribute('alt')).toBe('创建人：Alice Zhang')
    expect(within(row).getByTestId('ticket-author').textContent).toBe('Alice Zhang')
    expect(within(row).getByTestId('ticket-author').getAttribute('title')).toContain('alice')

    const age = within(row).getByTestId('ticket-age')
    expect(age.textContent).toBe('2 小时前')
    expect(age.getAttribute('title')).toContain('2026-11-12T13:00:00Z')
    expect(age.getAttribute('title')).toContain('2026-11-12T14:00:00Z')
  })

  it('没有头像时显示首字母色块，没有展示名时退回登录名', async () => {
    await renderRows()

    const row = rowFor('#2')
    const block = within(row).getByRole('img', { name: '创建人：bob' })
    expect(block.tagName).toBe('SPAN')
    expect(block.textContent).toBe('B')
    expect(within(row).getByTestId('ticket-author').textContent).toBe('bob')
  })

  it('同一用户的色块颜色在所有工单上一致', async () => {
    await renderRows()

    const bobOne = within(rowFor('#2')).getByTestId('ticket-avatar')
    const bobTwo = within(rowFor('#3')).getByTestId('ticket-avatar')

    expect(bobOne.style.background).not.toBe('')
    expect(bobOne.style.background).toBe(bobTwo.style.background)
  })

  it('头像加载失败时降级成首字母色块', async () => {
    await renderRows()

    const row = rowFor('#1')
    fireEvent.error(within(row).getByRole('img', { name: '创建人：Alice Zhang' }))

    const fallback = within(row).getByTestId('ticket-avatar')
    expect(fallback.tagName).toBe('SPAN')
    expect(fallback.textContent).toBe('A')
    expect(fallback.getAttribute('aria-label')).toBe('创建人：Alice Zhang')
  })

  it('非 http(s) 的头像地址不加载，直接显示色块', async () => {
    await renderRows()

    const row = rowFor('#7')
    expect(within(row).getByTestId('ticket-avatar').tagName).toBe('SPAN')
    expect(within(row).getByText('Mallory')).toBeTruthy()
  })

  it('没有创建人的票不渲染创建人区，只保留状态与标签', async () => {
    await renderRows()

    const row = rowFor('#5')
    expect(within(row).queryByTestId('ticket-author')).toBeNull()
    expect(within(row).queryByTestId('ticket-avatar')).toBeNull()
    expect(within(row).queryByTestId('ticket-age')).toBeNull()
    expect(row.textContent).toContain('开放')
    expect(within(row).getByTestId('ticket-label').textContent).toBe('ready-for-agent')
  })
})

describe('工单行的标签', () => {
  it('分类之外的标签用中性徽标显示，最多三个，其余折成 +N', async () => {
    await renderRows()

    const row = rowFor('#6')
    expect(row.textContent).toContain('enhancement')
    expect(
      within(row)
        .getAllByTestId('ticket-label')
        .map((item) => item.textContent),
    ).toEqual(['area:ui', 'area:core', 'needs-design'])
    expect(within(row).getByTestId('ticket-label-more').textContent).toBe('+1')
  })

  it('标签多到折成 +N 时，状态标签仍然留在行内', async () => {
    await renderRows([
      ticket({
        ref: '#8',
        title: '状态标签排在后面',
        category: 'enhancement',
        status: 'ready',
        labels: ['enhancement', 'area:ui', 'area:core', 'needs-design', 'ready-for-agent'],
      }),
    ])

    const row = rowFor('#8')
    expect(row.textContent).toContain('可接')
    expect(
      within(row)
        .getAllByTestId('ticket-label')
        .map((item) => item.textContent),
    ).toEqual(['area:ui', 'area:core', 'ready-for-agent'])
    expect(within(row).getByTestId('ticket-label-more').textContent).toBe('+1')
  })

  it.each(['needs-triage', 'needs-info', 'ready-for-human', 'wontfix'])(
    '%s 标签排在最后也能看到原文',
    async (statusLabel) => {
      await renderRows([
        ticket({
          ref: '#9',
          title: '拥挤的状态标签',
          labels: ['area:ui', 'area:core', 'needs-design', statusLabel],
        }),
      ])

      const row = rowFor('#9')
      expect(row.textContent).toContain('开放')
      expect(within(row).getByText(statusLabel)).toBeTruthy()
      expect(within(row).getByTestId('ticket-label-more').textContent).toBe('+1')
    },
  )

  it('没有标签的票不渲染标签徽标，也不显示占位', async () => {
    await renderRows([ticket({ ref: '#10', title: '没有标签' })])

    const row = rowFor('#10')
    expect(within(row).queryAllByTestId('ticket-label')).toHaveLength(0)
    expect(within(row).queryByTestId('ticket-label-more')).toBeNull()
  })
})
