/**
 * 工单行的元信息：创建人（用户名 + 头像 / 色块）、全部标签与相对创建时间。
 * 直接渲染列表视图，只断言可见文本、alt / aria-label 与 data-* 标记。
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
import { wrapRefresh } from './task-panel-test-support.ts'
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
  hierarchy: 'native',
  libraryVersion: 1,
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
    refresh: () => wrapRefresh(Promise.resolve({ ok: true, result: snapshot })),
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

async function renderRows(
  tickets: readonly TicketSnapshot[] = TICKETS,
  options: {
    readonly backend?: WorkspaceSnapshot['backend']
    readonly onOpenTicket?: (ticket: TicketSnapshot) => void
    readonly client?: PanelClient
  } = {},
): Promise<void> {
  const snapshot: WorkspaceSnapshot = {
    ...SNAPSHOT,
    tickets,
    loaded: tickets.length,
    total: tickets.length,
    backend: options.backend ?? SNAPSHOT.backend,
  }
  render(
    <TicketsViewWithRequest
      client={options.client ?? fakeClient(snapshot)}
      workspaceRoot="/repo"
      injection={fakeInjection()}
      now={() => NOW}
      onOpenEnvCheck={() => undefined}
      onOpenTicket={options.onOpenTicket ?? (() => undefined)}
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

/** 行内显示开关收在图标浮层里：断言或点击前先展开，已展开时不再点。 */
function openDisplayMenu(): void {
  if (screen.queryByTestId('display-updated') !== null) return
  fireEvent.click(screen.getByTestId('display-settings'))
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

  it('没有创建人的票不渲染创建人区，创建时间单独带前缀显示', async () => {
    await renderRows()

    const row = rowFor('#5')
    expect(within(row).queryByTestId('ticket-author')).toBeNull()
    expect(within(row).queryByTestId('ticket-avatar')).toBeNull()
    // 创建时间不再依附创建人：没有创建人时仍显示，并加「创建」前缀说明来源。
    expect(within(row).getByTestId('ticket-age').textContent).toBe('创建 2 小时前')
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

describe('工单行的可选字段', () => {
  it('默认不显示更新时间与分配人，与加入开关前一致', async () => {
    await renderRows([ticket({ ref: '#20', title: '默认显示', author: ALICE, assignees: ['bob'] })])

    const row = rowFor('#20')
    openDisplayMenu()
    expect(screen.getByTestId('display-author').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('display-created').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('display-updated').getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByTestId('display-assignees').getAttribute('aria-pressed')).toBe('false')
    expect(within(row).getByTestId('ticket-age').textContent).toBe('2 小时前')
    expect(within(row).queryByTestId('ticket-assignees')).toBeNull()
  })

  it('打开更新时间后，有创建人的行显示创建与更新两段', async () => {
    await renderRows([ticket({ ref: '#21', title: '两段时间', author: ALICE })])

    openDisplayMenu()
    fireEvent.click(screen.getByTestId('display-updated'))

    const row = rowFor('#21')
    expect(screen.getByTestId('display-updated').getAttribute('aria-pressed')).toBe('true')
    expect(within(row).getByTestId('ticket-age').textContent).toBe('创建 2 小时前 · 更新 1 小时前')
  })

  it('关闭创建人后只留创建时间，并带上「创建」前缀', async () => {
    await renderRows([ticket({ ref: '#2a', title: '只看时间', author: ALICE })])

    openDisplayMenu()
    fireEvent.click(screen.getByTestId('display-author'))

    const row = rowFor('#2a')
    expect(within(row).queryByTestId('ticket-author')).toBeNull()
    expect(within(row).queryByTestId('ticket-avatar')).toBeNull()
    expect(within(row).getByTestId('ticket-age').textContent).toBe('创建 2 小时前')
  })

  it('关闭创建时间后保留创建人，时间区整段消失', async () => {
    await renderRows([ticket({ ref: '#2b', title: '只看人', author: ALICE })])

    openDisplayMenu()
    fireEvent.click(screen.getByTestId('display-created'))

    const row = rowFor('#2b')
    expect(within(row).getByTestId('ticket-author').textContent).toBe('Alice Zhang')
    expect(within(row).queryByTestId('ticket-age')).toBeNull()
  })

  it('没有创建人的行打开更新时间后同时显示创建与更新两段', async () => {
    await renderRows([ticket({ ref: '#22', title: '本地票', author: null, assignees: [] })])

    openDisplayMenu()
    fireEvent.click(screen.getByTestId('display-updated'))

    const row = rowFor('#22')
    expect(within(row).getByTestId('ticket-age').textContent).toBe('创建 2 小时前 · 更新 1 小时前')
    expect(within(row).queryByTestId('ticket-author')).toBeNull()
  })

  it('更新时间无法解析时省略更新段，创建时间照常显示', async () => {
    await renderRows([
      ticket({ ref: '#23', title: '更新时间坏了', author: ALICE, updatedAt: 'not-a-date' }),
    ])

    openDisplayMenu()
    fireEvent.click(screen.getByTestId('display-updated'))

    const age = within(rowFor('#23')).getByTestId('ticket-age')
    expect(age.textContent).toBe('创建 2 小时前')
    expect(age.textContent).not.toContain('更新')
  })

  it('创建与更新时间都无法解析且没有创建人时，整个时间区不渲染', async () => {
    await renderRows([
      ticket({
        ref: '#24',
        title: '两段时间都坏了',
        author: null,
        createdAt: 'not-a-date',
        updatedAt: 'also-bad',
      }),
    ])

    openDisplayMenu()
    fireEvent.click(screen.getByTestId('display-updated'))

    expect(within(rowFor('#24')).queryByTestId('ticket-age')).toBeNull()
  })

  it('打开分配人后显示裸登录名，两个以内不折叠', async () => {
    await renderRows([ticket({ ref: '#25', title: '两个分配人', assignees: ['alice', 'bob'] })])

    openDisplayMenu()
    fireEvent.click(screen.getByTestId('display-assignees'))

    const group = within(rowFor('#25')).getByTestId('ticket-assignees')
    expect(within(group).getByTestId('ticket-assignee').textContent).toBe('alice, bob')
    expect(within(group).queryByTestId('ticket-assignee-more')).toBeNull()
    expect(group.getAttribute('title')).toContain('alice, bob')
  })

  it('分配人超过两个时折成 +N，悬停说明列出全部登录名', async () => {
    await renderRows([
      ticket({ ref: '#26', title: '三个分配人', assignees: ['alice', 'bob', 'carol'] }),
    ])

    openDisplayMenu()
    fireEvent.click(screen.getByTestId('display-assignees'))

    const group = within(rowFor('#26')).getByTestId('ticket-assignees')
    expect(within(group).getByTestId('ticket-assignee').textContent).toBe('alice, bob')
    const more = within(group).getByTestId('ticket-assignee-more')
    expect(more.textContent).toBe('+1')
    expect(more.getAttribute('title')).toContain('alice, bob, carol')
  })

  it('没有分配人的行打开开关后不渲染图标或占位', async () => {
    await renderRows([ticket({ ref: '#27', title: '无人分配', assignees: [] })])

    openDisplayMenu()
    fireEvent.click(screen.getByTestId('display-assignees'))

    expect(within(rowFor('#27')).queryByTestId('ticket-assignees')).toBeNull()
  })

  it('本地 Markdown 后端不出现分配人开关，更新时间开关仍在', async () => {
    await renderRows([ticket({ ref: '#28', title: '本地票', author: null })], {
      backend: 'markdown',
    })

    openDisplayMenu()
    expect(screen.queryByTestId('display-assignees')).toBeNull()
    expect(screen.getByTestId('display-updated')).toBeTruthy()
  })

  it('平铺与父子布局下都显示可选字段', async () => {
    await renderRows([ticket({ ref: '#29', title: '两种布局', author: ALICE })])

    fireEvent.click(screen.getByTestId('layout-tree'))
    openDisplayMenu()
    fireEvent.click(screen.getByTestId('display-updated'))

    const row = rowFor('#29')
    expect(within(row).getByTestId('ticket-age').textContent).toBe('创建 2 小时前 · 更新 1 小时前')
  })

  it('点开关不会打开详情', async () => {
    const opened: string[] = []
    await renderRows([ticket({ ref: '#30', title: '别开详情', author: ALICE })], {
      onOpenTicket: (picked) => {
        opened.push(picked.ref)
      },
    })

    openDisplayMenu()
    fireEvent.click(screen.getByTestId('display-updated'))
    fireEvent.click(screen.getByTestId('display-assignees'))

    expect(opened).toEqual([])
  })

  it('切换显示开关不改变筛选与排序，也不发起快照请求', async () => {
    const snapshot: WorkspaceSnapshot = {
      ...SNAPSHOT,
      tickets: TICKETS,
      loaded: TICKETS.length,
      total: TICKETS.length,
    }
    const client = fakeClient(snapshot)
    const get = vi.fn((workspaceRoot: string) => client.get(workspaceRoot))
    await renderRows(TICKETS, { client: { ...client, get } })
    const before = screen.queryAllByTestId('ticket-row').map((row) => row.getAttribute('data-ref'))
    get.mockClear()

    openDisplayMenu()
    fireEvent.click(screen.getByTestId('display-updated'))
    fireEvent.click(screen.getByTestId('display-assignees'))

    expect(get).not.toHaveBeenCalled()
    expect(screen.getByTestId('filter-open').getAttribute('aria-pressed')).toBe('true')
    expect(
      screen.queryAllByTestId('ticket-row').map((row) => row.getAttribute('data-ref')),
    ).toEqual(before)
  })

  it('开关按工作区持久化，重新挂载后恢复', async () => {
    await renderRows()
    openDisplayMenu()
    fireEvent.click(screen.getByTestId('display-updated'))
    fireEvent.click(screen.getByTestId('display-assignees'))

    cleanup()
    await renderRows()

    openDisplayMenu()
    expect(screen.getByTestId('display-updated').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('display-assignees').getAttribute('aria-pressed')).toBe('true')
    expect(within(rowFor('#1')).getByTestId('ticket-age').textContent).toContain('更新')
  })

  it('显示配置收在图标入口里，展开后可连续切换，Esc 收起并归还焦点', async () => {
    await renderRows()

    expect(screen.queryByTestId('display-updated')).toBeNull()
    expect(screen.getByTestId('display-settings').getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(screen.getByTestId('display-settings'))
    expect(screen.getByTestId('display-settings').getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(screen.getByTestId('display-updated'))
    // 切换一项后浮层仍开着，方便继续勾另一项。
    expect(screen.getByTestId('display-assignees')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('display-updated')).toBeNull()
    expect(screen.getByTestId('display-settings').getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(screen.getByTestId('display-settings'))
  })

  it('点浮层外部收起', async () => {
    await renderRows()

    fireEvent.click(screen.getByTestId('display-settings'))
    fireEvent.pointerDown(document.body)

    expect(screen.queryByTestId('display-updated')).toBeNull()
  })
})
