/**
 * 父子布局在真实面板里的会话行为：折叠跨视图保留，
 * 从概览定位被折叠的票时自动展开祖先链。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import * as React from 'react'

import type { WorkspaceSnapshot } from '../protocol/tracker.ts'
import { TaskPanel } from './task-panel.tsx'
import { SNAPSHOT, fakeClient, panelProps, rowRefs } from './task-panel-test-support.ts'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const TREE_SNAPSHOT: WorkspaceSnapshot = {
  ...SNAPSHOT,
  hierarchy: 'native',
  tickets: SNAPSHOT.tickets.map((ticket) => {
    if (ticket.ref === '#2') return { ...ticket, parent: '#1' }
    if (ticket.ref === '#5') return { ...ticket, parent: '#99' }
    return ticket
  }),
  metrics: {
    ...SNAPSHOT.metrics,
    attention: [{ ref: '#2', title: 'Alpha', reason: 'most-blocking', evidence: 1 }],
  },
}

function depthOf(ref: string): string | null {
  const row = screen
    .getAllByTestId('ticket-row')
    .find((element) => element.getAttribute('data-ref') === ref)
  return row?.getAttribute('data-depth') ?? null
}

describe('面板里的父子布局', () => {
  it('折叠跨概览保留，从关注清单定位时展开祖先链', async () => {
    const client = fakeClient({ ok: true, result: TREE_SNAPSHOT }).client
    const view = render(<TaskPanel {...panelProps({ client })} />)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('layout-tree'))
    await waitFor(() => {
      expect(depthOf('#2')).toBe('1')
    })

    fireEvent.click(screen.getByTestId('tree-toggle'))
    await waitFor(() => {
      expect(rowRefs()).toEqual(['#1', '#5', '#4'])
    })

    fireEvent.click(screen.getByTestId('view-overview'))
    fireEvent.click(await screen.findByTestId('attention-item'))

    await screen.findAllByTestId('ticket-row')
    await waitFor(() => {
      expect(rowRefs()).toContain('#2')
    })
    expect(screen.getByTestId('tree-toggle').getAttribute('aria-expanded')).toBe('true')
    expect(
      screen
        .getAllByTestId('ticket-row')
        .find((element) => element.getAttribute('data-ref') === '#2')
        ?.getAttribute('data-focused'),
    ).toBe('true')

    view.rerender(<TaskPanel {...panelProps({ client })} />)
    await screen.findAllByTestId('ticket-row')
    expect(depthOf('#2')).toBe('1')
  })

  it('切换工作区清空折叠，切回来不再保留', async () => {
    const client = fakeClient({ ok: true, result: TREE_SNAPSHOT }).client
    const view = render(<TaskPanel {...panelProps({ client })} />)
    await screen.findAllByTestId('ticket-row')
    fireEvent.click(screen.getByTestId('layout-tree'))
    await waitFor(() => {
      expect(depthOf('#2')).toBe('1')
    })
    fireEvent.click(screen.getByTestId('tree-toggle'))
    await waitFor(() => {
      expect(rowRefs()).toEqual(['#1', '#5', '#4'])
    })

    view.rerender(<TaskPanel {...panelProps({ client, workspaceRoot: '/two' })} />)
    await waitFor(() => {
      expect(rowRefs()).toContain('#2')
    })

    view.rerender(<TaskPanel {...panelProps({ client, workspaceRoot: '/repo' })} />)
    await waitFor(() => {
      expect(rowRefs()).toContain('#2')
    })
    expect(depthOf('#2')).toBe('1')
  })
})
