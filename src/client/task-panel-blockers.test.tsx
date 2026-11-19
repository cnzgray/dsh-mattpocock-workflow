/**
 * 面板里的详情阻塞项导航：从列表打开被阻塞票、跳到阻塞票、逐层返回，
 * 以及按引用打开未加载的票、刷新后标题同步、换工作区清空返回栈。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceSnapshot } from '../protocol/tracker.ts'
import { fakeInjection } from './injection-test-support.ts'
import type { PanelClient } from './rpc.ts'
import { fakeClient, panelProps, rowRefs, SNAPSHOT } from './task-panel-test-support.ts'
import { TaskPanel } from './task-panel.tsx'

afterEach(() => {
  cleanup()
})

function rowFor(ref: string): HTMLElement {
  const row = screen
    .getAllByTestId('ticket-row')
    .find((element) => element.getAttribute('data-ref') === ref)
  if (row === undefined) throw new Error(`缺少 ${ref} 的工单行`)
  return row
}

function blockerFor(ref: string): HTMLElement {
  const item = screen
    .getAllByTestId('blocker-item')
    .find((element) => element.getAttribute('data-ref') === ref)
  if (item === undefined) throw new Error(`缺少阻塞项 ${ref}`)
  return item
}

describe('详情里的阻塞项导航', () => {
  it('从列表打开被阻塞票，跳到阻塞票后逐层返回列表', async () => {
    const injectDraft = vi.fn(() => 'filled' as const)
    const fake = fakeClient({ ok: true, result: SNAPSHOT })
    render(
      <TaskPanel
        {...panelProps({ client: fake.client, injection: fakeInjection({ inject: injectDraft }) })}
      />,
    )
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('filter-blocked'))
    expect(rowRefs()).toEqual(['#2'])
    fireEvent.click(rowFor('#2'))

    await screen.findByTestId('detail-content')
    expect(screen.getByTestId('detail-ref').textContent).toBe('#2')
    expect(screen.getByTestId('detail-back').textContent).toContain('返回列表')

    fireEvent.click(screen.getByTestId('blockers-toggle'))
    fireEvent.click(blockerFor('#1'))

    await waitFor(() => {
      expect(screen.getByTestId('detail-ref').textContent).toBe('#1')
    })
    expect(fake.detailCalls).toEqual([
      ['/repo', '#2', 2],
      ['/repo', '#1', 1],
    ])
    expect(screen.getByTestId('detail-back').textContent).toContain('返回 #2')

    fireEvent.click(screen.getByTestId('detail-back'))
    await waitFor(() => {
      expect(screen.getByTestId('detail-ref').textContent).toBe('#2')
    })
    expect(screen.getByTestId('detail-back').textContent).toContain('返回列表')
    // 从返回栈回到被阻塞票也算重新打开：阻塞项收起，需要时再展开。
    expect(screen.queryByTestId('detail-blockers')).toBeNull()
    expect(screen.getByTestId('blockers-toggle').getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(screen.getByTestId('detail-back'))
    await screen.findAllByTestId('ticket-row')
    expect(screen.getByTestId('filter-blocked').getAttribute('aria-pressed')).toBe('true')
    expect(rowRefs()).toEqual(['#2'])
    // 浏览阻塞项只导航，不往会话输入框写提示词。
    expect(injectDraft).not.toHaveBeenCalled()
  })

  it('按引用打开不在当前快照里的阻塞票', async () => {
    const snapshot: WorkspaceSnapshot = {
      ...SNAPSHOT,
      tickets: SNAPSHOT.tickets.map((ticket) =>
        ticket.ref === '#2' ? { ...ticket, blockedBy: ['#9'] } : ticket,
      ),
    }
    const fake = fakeClient({ ok: true, result: snapshot })
    render(<TaskPanel {...panelProps({ client: fake.client })} />)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(rowFor('#2'))
    await screen.findByTestId('detail-content')
    fireEvent.click(screen.getByTestId('blockers-toggle'))

    const blocker = blockerFor('#9')
    expect(blocker.textContent).toContain('未加载')
    fireEvent.click(blocker)

    await waitFor(() => {
      expect(screen.getByTestId('detail-ref').textContent).toBe('#9')
    })
    expect(fake.detailCalls).toEqual([
      ['/repo', '#2', 2],
      ['/repo', '#9', 9],
    ])
    // 没有列表快照行：不编造技能徽标与阻塞入口。
    expect(screen.queryByTestId('skill-badge')).toBeNull()
    expect(screen.queryByTestId('action-reason')).toBeNull()
    expect(screen.queryByTestId('blockers-toggle')).toBeNull()
    expect(screen.getByTestId('detail-back').textContent).toContain('返回 #2')
  })

  it('跨仓库阻塞项带仓库段打开详情，并回到上一张票', async () => {
    const snapshot: WorkspaceSnapshot = {
      ...SNAPSHOT,
      tickets: SNAPSHOT.tickets.map((ticket) =>
        ticket.ref === '#2'
          ? {
              ...ticket,
              openBlockers: 1,
              blockedBy: ['cyit-platform/cyit-harness#33'],
            }
          : ticket,
      ),
    }
    const fake = fakeClient({ ok: true, result: snapshot })
    render(<TaskPanel {...panelProps({ client: fake.client })} />)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(rowFor('#2'))
    await screen.findByTestId('detail-content')
    const toggle = screen.getByTestId('blockers-toggle')
    expect(toggle.textContent).toContain('阻塞 1')
    fireEvent.click(toggle)

    const blocker = blockerFor('cyit-platform/cyit-harness#33')
    fireEvent.click(blocker)

    await waitFor(() => {
      expect(screen.getByTestId('detail-ref').textContent).toBe('cyit-platform/cyit-harness#33')
    })
    expect(fake.detailCalls).toEqual([
      ['/repo', '#2', 2],
      ['/repo', 'cyit-platform/cyit-harness#33', 33, 'cyit-platform/cyit-harness'],
    ])
    expect(screen.getByTestId('detail-back').textContent).toContain('返回 #2')
  })

  it('Esc 与返回按钮走同一条返回路径', async () => {
    const fake = fakeClient({ ok: true, result: SNAPSHOT })
    render(<TaskPanel {...panelProps({ client: fake.client })} />)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(rowFor('#2'))
    await screen.findByTestId('detail-content')
    fireEvent.click(screen.getByTestId('blockers-toggle'))
    fireEvent.click(blockerFor('#1'))
    await waitFor(() => {
      expect(screen.getByTestId('detail-ref').textContent).toBe('#1')
    })

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.getByTestId('detail-ref').textContent).toBe('#2')
    })

    fireEvent.keyDown(window, { key: 'Escape' })
    await screen.findAllByTestId('ticket-row')
    expect(screen.queryByTestId('detail-content')).toBeNull()
  })

  it('详情刷新后返回栈保留，阻塞项标题跟着快照更新', async () => {
    const retitled: WorkspaceSnapshot = {
      ...SNAPSHOT,
      tickets: SNAPSHOT.tickets.map((ticket) =>
        ticket.ref === '#1' ? { ...ticket, title: 'Bravo 改过标题' } : ticket,
      ),
    }
    const fake = fakeClient({ ok: true, result: SNAPSHOT }, { ok: true, result: retitled })
    render(<TaskPanel {...panelProps({ client: fake.client })} />)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(rowFor('#2'))
    await screen.findByTestId('detail-content')
    fireEvent.click(screen.getByTestId('blockers-toggle'))
    fireEvent.click(blockerFor('#1'))
    await waitFor(() => {
      expect(screen.getByTestId('detail-ref').textContent).toBe('#1')
    })

    // 在阻塞票上刷新：返回栈保留，快照落地后回到被阻塞票仍能看到新的阻塞项标题。
    fireEvent.click(screen.getByTestId('detail-refresh'))
    await waitFor(() => {
      expect(fake.refreshCalls).toEqual(['/repo'])
    })
    expect(screen.getByTestId('detail-back').textContent).toContain('返回 #2')

    fireEvent.click(screen.getByTestId('detail-back'))
    await waitFor(() => {
      expect(screen.getByTestId('detail-ref').textContent).toBe('#2')
    })
    fireEvent.click(screen.getByTestId('blockers-toggle'))
    expect(blockerFor('#1').textContent).toContain('Bravo 改过标题')
    expect(screen.getByTestId('detail-back').textContent).toContain('返回列表')
  })

  it('切换工作区后返回栈清空', async () => {
    const fake = fakeClient((root) => ({
      ok: true,
      result: { ...SNAPSHOT, repository: `${root}/repo` },
    }))
    const { rerender } = render(
      <TaskPanel {...panelProps({ client: fake.client, workspaceRoot: '/one' })} />,
    )
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(rowFor('#2'))
    await screen.findByTestId('detail-content')
    fireEvent.click(screen.getByTestId('blockers-toggle'))
    fireEvent.click(blockerFor('#1'))
    await waitFor(() => {
      expect(screen.getByTestId('detail-ref').textContent).toBe('#1')
    })

    rerender(<TaskPanel {...panelProps({ client: fake.client, workspaceRoot: '/two' })} />)
    await waitFor(() => {
      expect(screen.getByTestId('repo-name').textContent).toBe('/two/repo')
    })

    // 回到旧工作区时旧详情可以重新打开，但上一个仓库的票不再充当“上一张”。
    rerender(<TaskPanel {...panelProps({ client: fake.client, workspaceRoot: '/one' })} />)
    await screen.findByTestId('detail-content')
    expect(screen.getByTestId('detail-ref').textContent).toBe('#1')
    expect(screen.getByTestId('detail-back').textContent).toContain('返回列表')
  })

  it('跳到阻塞票时不保留上一张的写操作状态', async () => {
    const base = fakeClient({ ok: true, result: SNAPSHOT })
    const client: PanelClient = {
      ...base.client,
      updateTicket: () =>
        Promise.resolve({
          ok: false,
          error: { code: 'fetch-failed', message: '写失败' },
        }),
    }
    render(<TaskPanel {...panelProps({ client })} />)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(rowFor('#2'))
    await screen.findByTestId('detail-content')
    fireEvent.click(screen.getByTestId('detail-state-toggle'))
    await screen.findByTestId('detail-error')
    expect(screen.getByTestId('detail-error').textContent).toContain('写失败')

    fireEvent.click(screen.getByTestId('blockers-toggle'))
    fireEvent.click(blockerFor('#1'))
    await waitFor(() => {
      expect(screen.getByTestId('detail-ref').textContent).toBe('#1')
    })

    expect(screen.queryByTestId('detail-error')).toBeNull()
    expect(screen.getByTestId<HTMLButtonElement>('detail-state-toggle').disabled).toBe(false)
  })

  it('从页签栏回列表后，再次打开详情从列表开始', async () => {
    const fake = fakeClient({ ok: true, result: SNAPSHOT })
    render(<TaskPanel {...panelProps({ client: fake.client })} />)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(rowFor('#2'))
    await screen.findByTestId('detail-content')
    fireEvent.click(screen.getByTestId('blockers-toggle'))
    fireEvent.click(blockerFor('#1'))
    await waitFor(() => {
      expect(screen.getByTestId('detail-ref').textContent).toBe('#1')
    })

    fireEvent.click(screen.getByTestId('view-tickets'))
    await screen.findAllByTestId('ticket-row')
    fireEvent.click(rowFor('#2'))

    await screen.findByTestId('detail-content')
    expect(screen.getByTestId('detail-back').textContent).toContain('返回列表')
  })
})
