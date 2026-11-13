import { describe, expect, it } from 'vitest'

import { giteaIssue, includeHeaders } from './fixtures.ts'
import { parseApiResponse, parseDependencies, parseIssuesPage } from './parse.ts'

describe('Gitea API 响应解析', () => {
  it('从标准错误里读出状态码与总条数', () => {
    const response = parseApiResponse('[]', includeHeaders({ total: 42 }))

    expect(response.status).toBe(200)
    expect(response.total).toBe(42)
  })

  it('没有状态行时按成功处理，没有总条数时为 undefined', () => {
    const response = parseApiResponse('[]', '')

    expect(response.status).toBe(200)
    expect(response.total).toBeUndefined()
  })

  it('非 2xx 的状态码原样保留', () => {
    const response = parseApiResponse('{"message":"nope"}', includeHeaders({ status: 404 }))

    expect(response.status).toBe(404)
    expect(response.body).toBe('{"message":"nope"}')
  })
})

describe('Gitea 工单解析', () => {
  it('把一页 issue 映射成 ref、状态与标签', () => {
    const parsed = parseIssuesPage(
      JSON.stringify([
        giteaIssue({
          number: 15,
          title: '右侧栏任务面板 MVP',
          labels: ['enhancement', 'ready-for-agent'],
          body: '# 目标\n',
          createdAt: '2026-11-12T14:11:22Z',
          updatedAt: '2026-11-21T14:11:38Z',
        }),
      ]),
    )

    expect(parsed).toEqual([
      {
        ticket: {
          ref: '#15',
          number: 15,
          title: '右侧栏任务面板 MVP',
          state: 'open',
          labels: ['enhancement', 'ready-for-agent'],
          createdAt: '2026-11-12T14:11:22Z',
          updatedAt: '2026-11-21T14:11:38Z',
          openBlockers: 0,
        },
        body: '# 目标\n',
      },
    ])
  })

  it('跳过带 pull_request 字段的条目', () => {
    const parsed = parseIssuesPage(
      JSON.stringify([
        giteaIssue({ number: 15, title: '真正的工单' }),
        giteaIssue({ number: 21, title: '一个合并请求', pullRequest: true }),
      ]),
    )

    expect(parsed.map((issue) => issue.ticket.ref)).toEqual(['#15'])
  })

  it('状态不是 open/closed 时返回数据格式错误', () => {
    const output = JSON.stringify([{ number: 1, title: '状态坏了', state: 'merged' }])

    expect(() => parseIssuesPage(output)).toThrow(/状态不合法/)
  })

  it('依赖列表只统计未关闭的票', () => {
    const output = JSON.stringify([
      giteaIssue({ number: 15, title: '开放的前置任务' }),
      giteaIssue({ number: 7, title: '已关闭的前置任务', state: 'closed' }),
      // 没有读取权限的依赖在 API 里只剩标题，按未关闭处理。
      { number: 0, title: 'HIDDEN' },
    ])

    expect(parseDependencies(output)).toEqual({ received: 3, open: 2 })
  })

  it('依赖列表不是数组时返回数据格式错误', () => {
    expect(() => parseDependencies('{"message":"Not Found"}')).toThrow(/依赖/)
  })
})
