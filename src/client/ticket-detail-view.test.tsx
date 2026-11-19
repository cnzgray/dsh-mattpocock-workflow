import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RpcResult, TicketDetail } from '../protocol/tracker.ts'
import { clearDetailCache } from './detail-cache.ts'
import { fakeInjection } from './injection-test-support.ts'
import type { PanelClient } from './rpc.ts'
import {
  DETAIL,
  EMPTY_SNAPSHOT,
  button,
  detail,
  element,
  fakeBackend,
  renderView,
  snapshotTicket,
  target,
  view,
} from './ticket-detail-view-test-support.tsx'

afterEach(() => {
  cleanup()
  clearDetailCache()
  Reflect.deleteProperty(navigator, 'clipboard')
})

/** 分配人小块里的用户名（不含头像首字母）。 */
function assigneeNames(): (string | null)[] {
  return screen
    .getAllByTestId('assignee-chip')
    .map((chip) => chip.querySelector('[data-token-name]')?.textContent ?? null)
}

function input(testId: string): HTMLInputElement {
  return screen.getByTestId<HTMLInputElement>(testId)
}

function firstElement(testId: string): HTMLElement {
  const node = screen.getAllByTestId(testId)[0]
  if (node === undefined) throw new Error(`缺少 ${testId}`)
  return node
}

describe('工单详情视图', () => {
  it('加载完成后显示标题、编号、状态、正文、标签、分配人与链接', async () => {
    renderView(fakeBackend().client)

    expect(element('detail-loading').textContent).toContain('正在读取工单详情')

    await screen.findByTestId('detail-title')
    expect(element('detail-title').textContent).toBe('任务面板：工单详情视图')
    expect(element('detail-ref').textContent).toBe('#25')
    expect(element('detail-state').textContent).toBe('开放')
    expect(element('detail-meta').textContent).toContain('2026-11-12 09:00')
    expect(element('detail-body').textContent).toContain('正文保留了原始 Markdown。')
    expect(screen.getAllByTestId('label-chip').map((chip) => chip.textContent)).toEqual([
      'enhancement',
      'ready-for-agent',
    ])
    expect(assigneeNames()).toEqual(['alice'])
    expect(element('detail-ref').getAttribute('href')).toBe(DETAIL.url)
  })

  it('评论按时间顺序显示作者与时间', async () => {
    renderView(fakeBackend().client)

    await screen.findByTestId('detail-title')
    const authors = screen.getAllByTestId('comment-author').map((node) => node.textContent)

    expect(authors).toEqual(['bob 评论于 2026-11-13 09:00', 'carol 评论于 2026-11-13 10:00'])
    const comments = screen.getAllByTestId('detail-comment')
    expect(comments.map((node) => node.querySelector('[data-markdown]')?.textContent)).toEqual([
      '补充验收标准',
      '上一次失败的原因',
    ])
    // carol 是工单作者，她的评论带“作者”徽标；bob 的不带。
    expect(
      comments.map((node) => node.querySelector('[data-testid="author-badge"]') !== null),
    ).toEqual([false, true])
  })

  it('GitLab 正文与评论里的上传图片经宿主取回显示，同一张图只取一次', async () => {
    const path = '/uploads/f0fbf025e4c7f2a49dbc24c93a22f055/gzt-1.png'
    const backend = fakeBackend(
      detail({
        backend: 'gitlab',
        body: `![工资明细](${path})`,
        uploadsBaseUrl: 'https://gitlab.chyait.top/-/project/216/uploads/',
        comments: [{ author: 'bob', body: `再看一次 ![工资明细](${path})`, createdAt: null }],
      }),
      undefined,
      { [path]: { ok: true, result: { mediaType: 'image/png', base64: 'iVBORw0KGgo=' } } },
    )
    renderView(backend.client)

    await screen.findByTestId('detail-title')
    await waitFor(() => {
      expect(element('detail-body').querySelector('img')?.getAttribute('src')).toBe(
        'data:image/png;base64,iVBORw0KGgo=',
      )
    })
    await waitFor(() => {
      expect(element('detail-comments').querySelector('img')?.getAttribute('src')).toBe(
        'data:image/png;base64,iVBORw0KGgo=',
      )
    })
    expect(backend.attachmentCalls).toEqual([['/repo', path]])
  })

  it('非 GitLab 详情不请求附件', async () => {
    const backend = fakeBackend(detail({ body: '![图](/uploads/abc/a.png)' }))
    renderView(backend.client)

    await screen.findByTestId('detail-title')
    expect(element('detail-body').querySelector('img')?.getAttribute('src')).toBe(
      '/uploads/abc/a.png',
    )
    expect(backend.attachmentCalls).toEqual([])
  })

  it('没有评论时显示空状态', async () => {
    renderView(fakeBackend(detail({ comments: [] })).client)

    await screen.findByTestId('detail-no-comments')
    expect(screen.queryAllByTestId('detail-comment')).toHaveLength(0)
  })

  it('添加标签后详情立即显示新值并刷新列表快照', async () => {
    const backend = fakeBackend()
    renderView(backend.client)
    await screen.findByTestId('detail-title')

    fireEvent.click(element('label-edit'))
    fireEvent.change(element('label-input'), { target: { value: 'bug' } })
    fireEvent.click(element('label-add'))

    await waitFor(() => {
      expect(backend.updateCalls).toEqual([
        ['/repo', '#25', 25, { labels: ['enhancement', 'ready-for-agent', 'bug'] }],
      ])
    })
    await waitFor(() => {
      expect(screen.getAllByTestId('label-chip').map((chip) => chip.textContent)).toContain('bug')
    })
    await waitFor(() => {
      expect(backend.refreshCalls).toEqual(['/repo'])
    })
    expect(backend.detailCalls).toHaveLength(2)
  })

  it('移除标签发出剩下的目标集合', async () => {
    const backend = fakeBackend()
    renderView(backend.client)
    await screen.findByTestId('detail-title')

    fireEvent.click(firstElement('label-remove'))

    await waitFor(() => {
      expect(backend.updateCalls).toEqual([['/repo', '#25', 25, { labels: ['ready-for-agent'] }]])
    })
    await waitFor(() => {
      expect(screen.getAllByTestId('label-chip')).toHaveLength(1)
    })
  })

  it('添加与移除分配人，以及一键分配给我', async () => {
    const backend = fakeBackend()
    renderView(backend.client)
    await screen.findByTestId('detail-title')

    fireEvent.click(element('assignee-edit'))
    fireEvent.change(element('assignee-input'), { target: { value: 'bob' } })
    fireEvent.click(element('assignee-add'))
    await waitFor(() => {
      expect(backend.updateCalls.at(-1)?.[3]).toEqual({ assignees: ['alice', 'bob'] })
    })

    await waitFor(() => {
      expect(screen.getAllByTestId('assignee-chip')).toHaveLength(2)
    })
    fireEvent.click(firstElement('assignee-remove'))
    await waitFor(() => {
      expect(backend.updateCalls.at(-1)?.[3]).toEqual({ assignees: ['bob'] })
    })

    await waitFor(() => {
      expect(screen.getAllByTestId('assignee-chip')).toHaveLength(1)
    })
    fireEvent.click(element('assignee-edit'))
    fireEvent.click(element('assign-self'))
    await waitFor(() => {
      expect(backend.updateCalls.at(-1)?.[3]).toEqual({ assignSelf: true })
    })
    await waitFor(() => {
      expect(assigneeNames()).toEqual(['bob', 'me'])
    })
  })

  it('关闭工单后按钮变成重新打开，重开回到开放', async () => {
    const backend = fakeBackend()
    renderView(backend.client)
    await screen.findByTestId('detail-title')

    fireEvent.click(element('detail-state-toggle'))

    await waitFor(() => {
      expect(backend.updateCalls.at(-1)?.[3]).toEqual({ state: 'closed' })
    })
    await waitFor(() => {
      expect(element('detail-state').textContent).toBe('已关闭')
    })
    expect(element('detail-state-toggle').textContent).toBe('重新打开')

    fireEvent.click(element('detail-state-toggle'))

    await waitFor(() => {
      expect(backend.updateCalls.at(-1)?.[3]).toEqual({ state: 'open' })
    })
    await waitFor(() => {
      expect(element('detail-state').textContent).toBe('开放')
    })
  })

  it('写操作失败时保留原值并显示后端错误', async () => {
    const backend = fakeBackend()
    backend.failNextUpdate({ code: 'gh-unauthenticated', message: 'gh 未登录' })
    renderView(backend.client)
    await screen.findByTestId('detail-title')

    fireEvent.click(firstElement('label-remove'))

    await screen.findByTestId('detail-error')
    expect(element('detail-error').textContent).toContain('gh 未登录，请运行 gh auth login')
    expect(screen.getAllByTestId('label-chip')).toHaveLength(2)
    expect(backend.refreshCalls).toEqual([])
  })

  it('写操作进行中时控件禁用，避免重复提交', async () => {
    const pending = Promise.withResolvers<RpcResult<{ readonly applied: true }>>()
    const client: PanelClient = {
      ...fakeBackend().client,
      updateTicket: () => pending.promise,
    }
    renderView(client)
    await screen.findByTestId('detail-title')

    fireEvent.click(element('detail-state-toggle'))

    await waitFor(() => {
      expect(button('detail-state-toggle').disabled).toBe(true)
    })
    expect(button('detail-refresh').disabled).toBe(true)
    expect(button('label-edit').disabled).toBe(true)

    pending.resolve({ ok: true, result: { applied: true } })

    await waitFor(() => {
      expect(button('detail-state-toggle').disabled).toBe(false)
    })
  })

  it('写成功但复查失败时仍刷新列表并显示读取错误', async () => {
    const backend = fakeBackend()
    let reads = 0
    const client: PanelClient = {
      ...backend.client,
      getDetail: () => {
        reads += 1
        return reads === 1
          ? Promise.resolve({ ok: true, result: DETAIL })
          : Promise.resolve({ ok: false, error: { code: 'fetch-failed', message: '复查失败' } })
      },
    }
    renderView(client)
    await screen.findByTestId('detail-title')

    fireEvent.click(button('detail-state-toggle'))

    await screen.findByTestId('detail-error')
    expect(element('detail-error').textContent).toContain('复查失败')
    await waitFor(() => {
      expect(backend.refreshCalls).toEqual(['/repo'])
    })
    // 详情保留原值，不假装写成功。
    expect(element('detail-state').textContent).toBe('开放')
  })

  it('加载失败时显示错误与重试入口', async () => {
    const backend = fakeBackend()
    backend.failDetail({ code: 'fetch-failed', message: '网络失败' })
    renderView(backend.client)

    await screen.findByTestId('detail-load-error')
    expect(element('detail-load-error').textContent).toContain('网络失败')
    expect(screen.queryByTestId('detail-title')).toBeNull()
    // 首次加载失败只有「重试」，刷新按钮只在详情已加载后出现。
    expect(screen.queryByTestId('detail-refresh')).toBeNull()

    fireEvent.click(element('detail-retry'))

    await screen.findByTestId('detail-title')
    expect(backend.detailCalls).toHaveLength(2)
  })

  it('切换到另一张票时重新按需加载，不显示上一张的残留内容', async () => {
    const backend = fakeBackend()
    const { rerender } = render(view(backend.client))
    await screen.findByTestId('detail-title')
    expect(element('detail-ref').textContent).toBe('#25')

    rerender(view(backend.client, { target: target(snapshotTicket({ ref: '#26', number: 26 })) }))

    await waitFor(() => {
      expect(element('detail-ref').textContent).toBe('#26')
    })
    expect(backend.detailCalls).toEqual([
      ['/repo', '#25', 25],
      ['/repo', '#26', 26],
    ])
  })
})

describe('技能按钮', () => {
  it('详情顶部显示技能按钮，点击填入与列表同一份提示词', async () => {
    const injectDraft = vi.fn(() => 'filled' as const)
    renderView(fakeBackend().client, { injection: fakeInjection({ inject: injectDraft }) })

    await screen.findByTestId('detail-title')
    expect(injectDraft).not.toHaveBeenCalled()
    expect(element('skill-badge').textContent).toContain('implement')
    // 开工入口在导航头部，不在滚动的正文里。
    expect(element('skill-badge').closest('header')).not.toBeNull()

    fireEvent.click(element('skill-badge'))

    expect(injectDraft).toHaveBeenCalledWith('/implement #25', 'current-session')
    expect(element('skill-badge').dataset.injected).toBe('true')
  })

  it('不可开工的票显示原因徽标而不是按钮', async () => {
    const injectDraft = vi.fn(() => 'filled' as const)
    renderView(fakeBackend().client, {
      injection: fakeInjection({ inject: injectDraft }),
      target: target(
        snapshotTicket({
          status: 'blocked',
          skillAction: 'none',
          skillActionReason: 'blocked',
          openBlockers: 2,
        }),
      ),
    })

    await screen.findByTestId('detail-title')
    expect(screen.queryByTestId('skill-badge')).toBeNull()
    expect(element('action-reason').textContent).toBe('阻塞 2')
    expect(element('action-reason').title).toContain('未关闭的阻塞')
    expect(injectDraft).not.toHaveBeenCalled()
  })

  it('没有可用会话时禁用技能按钮并说明原因', async () => {
    const injectDraft = vi.fn(() => 'filled' as const)
    renderView(fakeBackend().client, {
      injection: fakeInjection({ canInjectCurrent: false, inject: injectDraft }),
    })

    await screen.findByTestId('detail-title')
    expect(button('skill-badge').disabled).toBe(true)
    expect(button('skill-badge').title).toContain('无法填入提示词')

    fireEvent.click(button('skill-badge'))
    expect(injectDraft).not.toHaveBeenCalled()
  })

  it('填入失败时在详情里显示原因', async () => {
    const injectDraft = vi.fn(() => 'unavailable' as const)
    renderView(fakeBackend().client, { injection: fakeInjection({ inject: injectDraft }) })

    await screen.findByTestId('detail-title')
    fireEvent.click(element('skill-badge'))

    await screen.findByTestId('inject-notice')
    expect(element('inject-notice').textContent).toContain('没有找到当前会话的输入框')
  })

  it('写操作后按刷新后的快照更新技能徽标', async () => {
    const closed = snapshotTicket({
      state: 'closed',
      status: 'closed',
      skillAction: 'none',
      skillActionReason: 'closed',
    })
    const backend = fakeBackend(DETAIL, { ...EMPTY_SNAPSHOT, tickets: [closed] })
    renderView(backend.client)
    await screen.findByTestId('detail-title')
    expect(element('skill-badge')).toBeTruthy()

    fireEvent.click(element('detail-state-toggle'))

    await screen.findByTestId('action-reason')
    expect(element('action-reason').textContent).toBe('已关闭')
  })
})

describe('工单详情的后端能力', () => {
  it('本地 Markdown 不显示写控件，并用一句话说明缺哪些能力', async () => {
    const local = detail({
      backend: 'markdown',
      number: null,
      ref: '.scratch/login/issues/03-session.md',
      url: null,
      assignees: [],
      labels: ['ready-for-agent'],
      comments: [{ author: null, body: '本地讨论记录', createdAt: null }],
      capabilities: { labels: false, assignees: false, state: false, link: false, delete: false },
    })
    const backend = fakeBackend(local)
    renderView(backend.client, {
      target: target(snapshotTicket({ ref: local.ref, number: null })),
    })

    await screen.findByTestId('detail-title')
    // 本地 Markdown 没有数字编号，读取详情时传 null。
    expect(backend.detailCalls).toEqual([['/repo', local.ref, null]])
    expect(element('detail-unsupported-note').textContent).toBe(
      '当前后端（本地）不支持修改标签、修改分配人、关闭或重开、提供链接地址。',
    )
    expect(screen.queryByTestId('label-edit')).toBeNull()
    expect(screen.queryByTestId('assignee-edit')).toBeNull()
    expect(screen.getAllByTestId('label-chip').map((chip) => chip.textContent)).toEqual([
      'ready-for-agent',
    ])
    expect(screen.queryByTestId('label-remove')).toBeNull()
    expect(screen.queryByTestId('detail-state-toggle')).toBeNull()
    expect(screen.queryByTestId('detail-copy')).toBeNull()

    // 本地评论没有作者与时间，也不伪造。
    expect(screen.getAllByTestId('comment-author')[0]?.textContent).toBe('未署名')
  })

  it('按 Esc 返回列表', async () => {
    const onBack = vi.fn()
    renderView(fakeBackend().client, { onBack })
    await screen.findByTestId('detail-title')

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('在添加输入框里按 Esc 只收起输入框，不返回列表', async () => {
    const onBack = vi.fn()
    renderView(fakeBackend().client, { onBack })
    await screen.findByTestId('detail-title')

    fireEvent.click(element('label-edit'))
    fireEvent.keyDown(element('label-input'), { key: 'Escape' })

    expect(screen.queryByTestId('label-input')).toBeNull()
    expect(element('label-edit')).toBeTruthy()
    expect(onBack).not.toHaveBeenCalled()
  })

  it('正文与评论按 Markdown 渲染', async () => {
    renderView(
      fakeBackend(
        detail({
          body: '## 规格\n\n- 第一条\n- 第二条',
          comments: [{ author: 'bob', body: '见 `src/core`', createdAt: null }],
        }),
      ).client,
    )
    await screen.findByTestId('detail-title')

    const body = element('detail-body')
    expect(body.querySelector('h2')?.textContent).toBe('规格')
    expect([...body.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
      '第一条',
      '第二条',
    ])
    expect(element('detail-comment').querySelector('code')?.textContent).toBe('src/core')
  })
})

describe('复制链接', () => {
  it('剪贴板可用时写入地址并提示已复制', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderView(fakeBackend().client)
    await screen.findByTestId('detail-title')

    fireEvent.click(element('detail-copy'))

    await screen.findByTestId('copy-notice')
    expect(writeText).toHaveBeenCalledWith(DETAIL.url)
    expect(screen.queryByTestId('copy-error')).toBeNull()
  })

  it('剪贴板写入失败时保留可全选的地址并显示原因', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) },
    })
    renderView(fakeBackend().client)
    await screen.findByTestId('detail-title')

    fireEvent.click(element('detail-copy'))

    await screen.findByTestId('copy-error')
    expect(element('copy-error').textContent).toContain('复制失败')
    expect(input('detail-link').value).toBe(DETAIL.url)
    expect(input('detail-link').readOnly).toBe(true)
  })

  it('没有剪贴板 API 时地址仍以只读文本显示并说明原因', async () => {
    renderView(fakeBackend().client)
    await screen.findByTestId('detail-title')

    fireEvent.click(element('detail-copy'))

    await screen.findByTestId('copy-error')
    expect(element('copy-error').textContent).toContain('没有剪贴板 API')
    expect(input('detail-link').value).toBe(DETAIL.url)
  })
})

describe('添加标签与分配人时的补全', () => {
  it('候选排除已选中的标签，按输入过滤，回车添加高亮的候选', async () => {
    const backend = fakeBackend()
    renderView(backend.client)
    await screen.findByTestId('detail-title')

    fireEvent.click(element('label-edit'))
    await waitFor(() => {
      expect(optionNames('label')).toEqual(['bug', 'needs-triage'])
    })
    expect(backend.optionsCalls).toEqual(['/repo'])

    fireEvent.change(element('label-input'), { target: { value: '分流' } })
    expect(optionNames('label')).toEqual(['needs-triage'])
    fireEvent.keyDown(element('label-input'), { key: 'Enter' })

    await waitFor(() => {
      expect(backend.updateCalls.at(-1)?.[3]).toEqual({
        labels: ['enhancement', 'ready-for-agent', 'needs-triage'],
      })
    })
  })

  it('方向键移动高亮，点击候选也能添加分配人', async () => {
    const backend = fakeBackend()
    renderView(backend.client)
    await screen.findByTestId('detail-title')

    fireEvent.click(element('assignee-edit'))
    await waitFor(() => {
      expect(optionNames('assignee')).toEqual(['bob'])
    })
    const input = element('assignee-input')
    expect(input.getAttribute('aria-activedescendant')).not.toBeNull()

    fireEvent.click(screen.getByText('bob', { selector: '[data-option-name]' }))

    await waitFor(() => {
      expect(backend.updateCalls.at(-1)?.[3]).toEqual({ assignees: ['alice', 'bob'] })
    })
  })

  it('没有匹配的候选时回车添加输入的原文', async () => {
    const backend = fakeBackend()
    renderView(backend.client)
    await screen.findByTestId('detail-title')

    fireEvent.click(element('label-edit'))
    await screen.findAllByTestId('label-option')
    fireEvent.change(element('label-input'), { target: { value: 'docs' } })
    expect(screen.queryAllByTestId('label-option')).toHaveLength(0)
    expect(element('label-suggestions').textContent).toContain('回车添加“docs”')
    fireEvent.keyDown(element('label-input'), { key: 'Enter' })

    await waitFor(() => {
      expect(backend.updateCalls.at(-1)?.[3]).toEqual({
        labels: ['enhancement', 'ready-for-agent', 'docs'],
      })
    })
  })

  it('读取候选失败时说明原因，仍可手动输入', async () => {
    const backend = fakeBackend()
    const client: PanelClient = {
      ...backend.client,
      getOptions: () =>
        Promise.resolve({ ok: false, error: { code: 'fetch-failed', message: '网络断了' } }),
    }
    renderView(client)
    await screen.findByTestId('detail-title')

    fireEvent.click(element('label-edit'))

    await waitFor(() => {
      expect(element('label-suggestions').textContent).toContain('读取候选失败：网络断了')
    })
    fireEvent.change(element('label-input'), { target: { value: 'bug' } })
    fireEvent.keyDown(element('label-input'), { key: 'Enter' })
    await waitFor(() => {
      expect(backend.updateCalls).toHaveLength(1)
    })
  })

  it('后端不能改标签时不读取候选', async () => {
    const backend = fakeBackend(
      detail({
        capabilities: { labels: false, assignees: false, state: false, link: true, delete: false },
      }),
    )
    renderView(backend.client)
    await screen.findByTestId('detail-title')

    expect(backend.optionsCalls).toEqual([])
  })
})

describe('删除工单', () => {
  const deletable = (): TicketDetail =>
    detail({ capabilities: { ...DETAIL.capabilities, delete: true } })

  function openConfirm(): void {
    fireEvent.click(element('detail-more'))
    fireEvent.click(element('detail-delete'))
  }

  it('没有删除权限时不出现更多菜单', async () => {
    renderView(fakeBackend().client)
    await screen.findByTestId('detail-title')

    expect(screen.queryByTestId('detail-more')).toBeNull()
    expect(screen.queryByTestId('detail-delete')).toBeNull()
  })

  it('入口藏在更多菜单里，输入 delete 之前删除按钮不可用', async () => {
    const backend = fakeBackend(deletable())
    renderView(backend.client)
    await screen.findByTestId('detail-title')

    expect(screen.queryByTestId('detail-delete')).toBeNull()
    openConfirm()

    expect(button('delete-submit').disabled).toBe(true)
    fireEvent.change(element('delete-confirm-input'), { target: { value: 'delet' } })
    expect(button('delete-submit').disabled).toBe(true)
    fireEvent.change(element('delete-confirm-input'), { target: { value: 'DELETE' } })
    expect(button('delete-submit').disabled).toBe(true)
    expect(backend.deleteCalls).toEqual([])
  })

  it('输入 delete 后删除、刷新列表并返回列表', async () => {
    const onBack = vi.fn()
    const backend = fakeBackend(deletable())
    renderView(backend.client, { onBack })
    await screen.findByTestId('detail-title')

    openConfirm()
    fireEvent.change(element('delete-confirm-input'), { target: { value: 'delete' } })
    fireEvent.click(element('delete-submit'))

    await waitFor(() => {
      expect(onBack).toHaveBeenCalledTimes(1)
    })
    expect(backend.deleteCalls).toEqual([['/repo', '#25', 25]])
    expect(backend.refreshCalls).toEqual(['/repo'])
  })

  it('删除失败时留在确认面板里显示原因', async () => {
    const onBack = vi.fn()
    const backend = fakeBackend(deletable())
    const client: PanelClient = {
      ...backend.client,
      deleteTicket: () =>
        Promise.resolve({
          ok: false,
          error: { code: 'fetch-failed', message: '没有删除这张工单的权限。' },
        }),
    }
    renderView(client, { onBack })
    await screen.findByTestId('detail-title')

    openConfirm()
    fireEvent.change(element('delete-confirm-input'), { target: { value: 'delete' } })
    fireEvent.click(element('delete-submit'))

    await screen.findByTestId('delete-error')
    expect(element('delete-error').textContent).toContain('没有删除这张工单的权限')
    expect(onBack).not.toHaveBeenCalled()
    expect(backend.refreshCalls).toEqual([])
  })

  it('删除确认面板打开时刷新按钮不可用', async () => {
    renderView(fakeBackend(deletable()).client)
    await screen.findByTestId('detail-title')

    expect(button('detail-refresh').disabled).toBe(false)
    openConfirm()
    expect(button('detail-refresh').disabled).toBe(true)
  })

  it('在确认面板里按 Esc 只取消删除，不返回列表', async () => {
    const onBack = vi.fn()
    renderView(fakeBackend(deletable()).client, { onBack })
    await screen.findByTestId('detail-title')

    openConfirm()
    fireEvent.keyDown(element('delete-confirm-input'), { key: 'Escape' })

    expect(screen.queryByTestId('delete-confirm')).toBeNull()
    expect(onBack).not.toHaveBeenCalled()
  })
})

describe('详情缓存', () => {
  it('再次打开同一张票且列表时间未变时秒开：不重复请求、不闪加载', async () => {
    const backend = fakeBackend()
    renderView(backend.client)
    await waitFor(() => {
      expect(element('detail-body').textContent).toContain('正文保留了原始 Markdown。')
    })
    expect(backend.detailCalls).toHaveLength(1)

    cleanup()
    renderView(backend.client)

    // 缓存命中：内容立刻在，没有第二次请求，也没有加载态。
    expect(element('detail-body').textContent).toContain('正文保留了原始 Markdown。')
    expect(backend.detailCalls).toHaveLength(1)
    expect(screen.queryByTestId('detail-loading')).toBeNull()
  })

  it('列表时间变了先显示缓存，后台静默拉新并替换内容', async () => {
    const backend = fakeBackend()
    renderView(backend.client)
    await waitFor(() => {
      expect(element('detail-body').textContent).toContain('正文保留了原始 Markdown。')
    })
    cleanup()

    backend.changeDetail({ ...DETAIL, updatedAt: '2026-11-15T00:00:00Z', body: '远端改过的正文' })
    renderView(backend.client, {
      target: target(snapshotTicket({ updatedAt: '2026-11-15T00:00:00Z' })),
      snapshotTickets: [snapshotTicket({ updatedAt: '2026-11-15T00:00:00Z' })],
    })

    // 缓存内容立即显示，不等请求；随后被新内容静默替换。
    expect(element('detail-body').textContent).toContain('正文保留了原始 Markdown。')
    await waitFor(() => {
      expect(element('detail-body').textContent).toContain('远端改过的正文')
    })
    expect(backend.detailCalls).toHaveLength(2)
  })

  it('有缓存时拉新失败保留内容，并在头部给出失败原因', async () => {
    const backend = fakeBackend()
    renderView(backend.client)
    await waitFor(() => {
      expect(element('detail-body').textContent).toContain('正文保留了原始 Markdown。')
    })
    cleanup()

    backend.changeDetail({ ...DETAIL, updatedAt: '2026-11-15T00:00:00Z' })
    backend.failDetail({ code: 'fetch-failed', message: '网络断了' })
    renderView(backend.client, {
      target: target(snapshotTicket({ updatedAt: '2026-11-15T00:00:00Z' })),
      snapshotTickets: [snapshotTicket({ updatedAt: '2026-11-15T00:00:00Z' })],
    })

    await waitFor(() => {
      expect(element('detail-refresh-error').textContent).toContain('网络断了')
    })
    expect(element('detail-body').textContent).toContain('正文保留了原始 Markdown。')
    expect(screen.queryByTestId('detail-load-error')).toBeNull()
  })
})

function optionNames(kind: 'label' | 'assignee'): (string | null)[] {
  return screen
    .queryAllByTestId(`${kind}-option`)
    .map((option) => option.querySelector('[data-option-name]')?.textContent ?? null)
}
