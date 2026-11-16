/**
 * 工单详情的手动刷新：重读这张票、保留旧内容、失败提示与列表快照联动。
 * 与详情视图的其他用例分开，免得一个测试文件超过行数上限。
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RpcResult, TicketDetail } from '../protocol/tracker.ts'
import { fakeInjection } from './injection-test-support.ts'
import type { PanelClient } from './rpc.ts'
import {
  DETAIL,
  button,
  detail,
  element,
  fakeBackend,
  renderView,
} from './ticket-detail-view-test-support.tsx'

afterEach(() => {
  cleanup()
})

describe('刷新工单', () => {
  it('加载完成后头部出现刷新按钮，名称是刷新工单', async () => {
    renderView(fakeBackend().client)
    await screen.findByTestId('detail-title')

    const refresh = button('detail-refresh')
    expect(refresh.getAttribute('aria-label')).toBe('刷新工单')
    expect(refresh.title).toBe('刷新工单')
    // 在详情头部，技能徽标与关闭/重开之后、复制链接之前。
    expect(refresh.closest('header')).not.toBeNull()
    expect(
      element('skill-badge').compareDocumentPosition(refresh) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      element('detail-state-toggle').compareDocumentPosition(refresh) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      refresh.compareDocumentPosition(element('detail-copy')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('点击后重新读取这张票，并替换标题、状态、评论与标签', async () => {
    const backend = fakeBackend()
    renderView(backend.client)
    await screen.findByTestId('detail-title')

    backend.changeDetail(
      detail({
        title: '远端改过的标题',
        state: 'closed',
        labels: ['bug'],
        comments: [{ author: 'dave', body: '刚补的评论', createdAt: '2026-11-14T09:00:00Z' }],
      }),
    )
    fireEvent.click(element('detail-refresh'))

    await waitFor(() => {
      expect(element('detail-title').textContent).toBe('远端改过的标题')
    })
    expect(element('detail-state').textContent).toBe('已关闭')
    expect(screen.getAllByTestId('label-chip').map((chip) => chip.textContent)).toEqual(['bug'])
    expect(element('detail-comments').textContent).toContain('刚补的评论')
    expect(backend.detailCalls).toEqual([
      ['/repo', '#25', 25],
      ['/repo', '#25', 25],
    ])
  })

  it('刷新期间保留旧内容、按钮禁用且不叠加请求', async () => {
    const backend = fakeBackend()
    const pending = Promise.withResolvers<RpcResult<TicketDetail>>()
    let reads = 0
    const client: PanelClient = {
      ...backend.client,
      getDetail: (_root, ref, number) => {
        reads += 1
        return reads === 1
          ? Promise.resolve({ ok: true, result: { ...DETAIL, ref, number } })
          : pending.promise
      },
    }
    renderView(client)
    await screen.findByTestId('detail-title')

    fireEvent.click(element('detail-refresh'))

    const refresh = button('detail-refresh')
    expect(refresh.disabled).toBe(true)
    expect(refresh.getAttribute('aria-label')).toBe('正在刷新工单…')
    expect(refresh.title).toBe('正在刷新工单…')
    // 不出现首次加载的占位，旧内容仍在；写控件与关闭/重开也禁用。
    expect(screen.queryByTestId('detail-loading')).toBeNull()
    expect(element('detail-title').textContent).toBe(DETAIL.title)
    expect(button('label-edit').disabled).toBe(true)
    expect(button('detail-state-toggle').disabled).toBe(true)

    fireEvent.click(refresh)
    expect(reads).toBe(2)

    pending.resolve({ ok: true, result: detail({ title: '刷新后的标题' }) })
    await waitFor(() => {
      expect(element('detail-title').textContent).toBe('刷新后的标题')
    })
    expect(button('detail-refresh').disabled).toBe(false)
  })

  it('刷新失败保留旧内容，在头部下方说明原因，重试成功自动清除', async () => {
    const backend = fakeBackend()
    renderView(backend.client)
    await screen.findByTestId('detail-title')

    // 一次性失败只作用在刷新这次读取上，首次加载已经成功。
    backend.failDetail({ code: 'fetch-failed', message: '网络失败' })
    backend.changeDetail(detail({ title: '远端新标题' }))
    fireEvent.click(element('detail-refresh'))

    await screen.findByTestId('detail-refresh-error')
    const notice = element('detail-refresh-error')
    expect(notice.textContent).toBe('刷新失败：网络失败')
    expect(notice.getAttribute('role')).toBe('alert')
    // 固定在正文滚动区之外，旧内容完整保留，不切成整页错误。
    expect(notice.closest('[data-testid="detail-content"]')).toBeNull()
    expect(screen.queryByTestId('detail-load-error')).toBeNull()
    expect(element('detail-title').textContent).toBe(DETAIL.title)
    expect(button('detail-refresh').disabled).toBe(false)

    fireEvent.click(element('detail-refresh'))

    await waitFor(() => {
      expect(element('detail-title').textContent).toBe('远端新标题')
    })
    expect(screen.queryByTestId('detail-refresh-error')).toBeNull()
  })

  it('重试在途时保留失败提示，成功后才清除', async () => {
    const backend = fakeBackend()
    const retry = Promise.withResolvers<RpcResult<TicketDetail>>()
    let reads = 0
    const client: PanelClient = {
      ...backend.client,
      getDetail: (_root, ref, number) => {
        reads += 1
        if (reads === 2) {
          return Promise.resolve({
            ok: false,
            error: { code: 'fetch-failed', message: '网络失败' },
          })
        }
        return reads === 3
          ? retry.promise
          : Promise.resolve({ ok: true, result: { ...DETAIL, ref, number } })
      },
    }
    renderView(client)
    await screen.findByTestId('detail-title')

    fireEvent.click(element('detail-refresh'))
    await screen.findByTestId('detail-refresh-error')

    fireEvent.click(element('detail-refresh'))

    // 重试在途：旧原因和「正在刷新」并存，提示不提前消失。
    expect(element('detail-refresh-error').textContent).toBe('刷新失败：网络失败')
    expect(button('detail-refresh').getAttribute('aria-label')).toBe('正在刷新工单…')

    retry.resolve({ ok: true, result: detail({ title: '刷新后的标题' }) })
    await waitFor(() => {
      expect(element('detail-title').textContent).toBe('刷新后的标题')
    })
    expect(screen.queryByTestId('detail-refresh-error')).toBeNull()
  })

  it('点击刷新只重读详情并同步列表快照，不注入提示词也不返回', async () => {
    const injectDraft = vi.fn(() => 'filled' as const)
    const onRefreshSnapshot = vi.fn()
    const onBack = vi.fn()
    renderView(fakeBackend().client, {
      injection: fakeInjection({ inject: injectDraft }),
      onRefreshSnapshot,
      onBack,
    })
    await screen.findByTestId('detail-title')

    fireEvent.click(element('detail-refresh'))

    await waitFor(() => {
      expect(onRefreshSnapshot).toHaveBeenCalledTimes(1)
    })
    expect(injectDraft).not.toHaveBeenCalled()
    expect(onBack).not.toHaveBeenCalled()
  })
})
