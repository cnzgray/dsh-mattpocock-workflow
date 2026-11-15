import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'

import type { WorkspaceSnapshot } from '../protocol/tracker.ts'
import { fakeClient, panelProps, SNAPSHOT } from './task-panel-test-support.ts'
import { TaskPanel } from './task-panel.tsx'

const URL_1 = 'https://github.com/cnzgray/dsh-mattpocock-workflow/issues/1'

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(navigator, 'clipboard')
})

/** 只给 #1 带上网页地址，其余票保持没有地址。 */
function snapshotWithUrl(): WorkspaceSnapshot {
  return {
    ...SNAPSHOT,
    tickets: SNAPSHOT.tickets.map((ticket) =>
      ticket.ref === '#1' ? { ...ticket, url: URL_1 } : ticket,
    ),
  }
}

function refOf(ref: string): HTMLElement {
  const row = screen
    .getAllByTestId('ticket-row')
    .find((element) => element.getAttribute('data-ref') === ref)
  const ticketRef = row?.parentElement?.querySelector('[data-testid="ticket-ref"]')
  if (!(ticketRef instanceof HTMLElement)) throw new Error(`找不到 ${ref} 的编号`)
  return ticketRef
}

describe('工单行编号', () => {
  it('点击编号复制网页地址，不打开详情', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const fake = fakeClient({ ok: true, result: snapshotWithUrl() })
    render(<TaskPanel {...panelProps({ client: fake.client })} />)
    await screen.findAllByTestId('ticket-row')

    const number = refOf('#1')
    expect(number.tagName).toBe('BUTTON')
    expect(number.textContent).toBe('#1')
    fireEvent.click(number)

    await screen.findByText('已复制链接地址。')
    expect(writeText).toHaveBeenCalledWith(URL_1)
    expect(refOf('#1').getAttribute('data-copy')).toBe('copied')
    expect(screen.queryByTestId('detail-content')).toBeNull()
    expect(fake.detailCalls).toEqual([])
  })

  it('剪贴板写入失败时编号把原因放进悬停说明', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) },
    })
    const fake = fakeClient({ ok: true, result: snapshotWithUrl() })
    render(<TaskPanel {...panelProps({ client: fake.client })} />)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(refOf('#1'))

    await vi.waitFor(() => {
      expect(refOf('#1').getAttribute('data-copy')).toBe('failed')
    })
    expect(refOf('#1').getAttribute('title')).toContain('denied')
  })

  it('没有网页地址的票编号只是文字，点击照常打开详情', async () => {
    const fake = fakeClient({ ok: true, result: snapshotWithUrl() })
    render(<TaskPanel {...panelProps({ client: fake.client })} />)
    await screen.findAllByTestId('ticket-row')

    const number = refOf('#2')
    expect(number.tagName).toBe('SPAN')
    fireEvent.click(number)

    await screen.findByTestId('detail-content')
  })
})
