import { describe, expect, it } from 'vitest'

import { giteaIssue, includeHeaders } from './fixtures.ts'
import { parseApiResponse, parseDependencies, parseIssuesPage, parseViewer } from './parse.ts'

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
  it('把一页 issue 映射成 ref、状态、标签与创建人', () => {
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
      'https://gitea.example.com',
    )

    expect(parsed).toEqual([
      {
        ticket: {
          ref: '#15',
          number: 15,
          title: '右侧栏任务面板 MVP',
          state: 'open',
          labels: ['enhancement', 'ready-for-agent'],
          author: {
            login: 'cnzgray',
            displayName: 'Cnzgray',
            avatarUrl: 'https://gitea.example.com/avatars/1',
          },
          assignees: [],
          createdAt: '2026-11-12T14:11:22Z',
          updatedAt: '2026-11-21T14:11:38Z',
          openBlockers: 0,
          blockedBy: [],
        },
        body: '# 目标\n',
      },
    ])
  })

  it('把 assignees[].login 映射成登录名数组，脏条目跳过', () => {
    const parsed = parseIssuesPage(
      JSON.stringify([
        giteaIssue({
          number: 15,
          title: '分配人字段',
          assignees: ['alice', 'bob'],
        }),
      ]),
    )

    expect(parsed[0]?.ticket.assignees).toEqual(['alice', 'bob'])
  })

  it('缺 assignees 时按空数组处理', () => {
    const parsed = parseIssuesPage(
      JSON.stringify([
        {
          number: 15,
          title: '没有分配人',
          state: 'open',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ]),
    )

    expect(parsed[0]?.ticket.assignees).toEqual([])
  })

  it('从 /user 响应里读当前登录用户', () => {
    expect(parseViewer(JSON.stringify({ login: 'cnzgray' }))).toBe('cnzgray')
    expect(parseViewer(JSON.stringify({ login: '' }))).toBeNull()
    expect(parseViewer(JSON.stringify({}))).toBeNull()
  })

  it('实例内的相对头像补成绝对地址，绝对地址原样保留', () => {
    const parsed = parseIssuesPage(
      JSON.stringify([
        giteaIssue({
          number: 15,
          title: '相对头像',
          user: { login: 'alice', avatar_url: '/avatars/alice' },
        }),
        giteaIssue({
          number: 16,
          title: '绝对头像',
          user: { login: 'bob', avatar_url: 'https://cdn.example.com/bob.png' },
        }),
        giteaIssue({
          number: 17,
          title: '非法头像',
          user: { login: 'carol', avatar_url: 'javascript:alert(1)' },
        }),
      ]),
      'https://gitea.example.com',
    )

    expect(parsed.map((issue) => issue.ticket.author?.avatarUrl)).toEqual([
      'https://gitea.example.com/avatars/alice',
      'https://cdn.example.com/bob.png',
      null,
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

    expect(parseDependencies(output)).toEqual({
      received: 3,
      open: 2,
      refs: [{ number: 15 }, { number: 7 }],
    })
  })

  it('依赖条目带 repository.full_name 时保留仓库，非法仓库按同仓库处理', () => {
    const output = JSON.stringify([
      {
        ...giteaIssue({ number: 33, title: '跨仓库前置任务' }),
        repository: { full_name: 'cyit-platform/cyit-harness' },
      },
      {
        ...giteaIssue({ number: 34, title: '缺仓库' }),
      },
      {
        ...giteaIssue({ number: 35, title: '非法仓库' }),
        repository: { full_name: 'https://gitea.example.com/cyit-platform/cyit-harness' },
      },
    ])

    expect(parseDependencies(output).refs).toEqual([
      { number: 33, repository: 'cyit-platform/cyit-harness' },
      { number: 34 },
      { number: 35 },
    ])
  })

  it('依赖列表不是数组时返回数据格式错误', () => {
    expect(() => parseDependencies('{"message":"Not Found"}')).toThrow(/依赖/)
  })

  it('把 html_url 读成工单网页地址', () => {
    const parsed = parseIssuesPage(
      JSON.stringify([
        {
          ...giteaIssue({ number: 15, title: '右侧栏任务面板 MVP' }),
          html_url: 'https://gitea.example.com/cnzgray/dsh-workflow/issues/15',
        },
      ]),
      'https://gitea.example.com',
    )

    expect(parsed[0]?.ticket.url).toBe('https://gitea.example.com/cnzgray/dsh-workflow/issues/15')
  })
})

describe('Gitea 父级约定解析', () => {
  /** 用一组正文构造一页工单，返回每张票的父级引用。 */
  function parentsOf(bodies: readonly string[]): (string | undefined)[] {
    const parsed = parseIssuesPage(
      JSON.stringify(
        bodies.map((body, index) =>
          giteaIssue({ number: 20 + index, title: `票 ${String(index)}`, body }),
        ),
      ),
    )
    return parsed.map((issue) => issue.ticket.parent)
  }

  it('正文首个非空行的 Part of 读成父级引用', () => {
    expect(
      parentsOf([
        'Part of #15\n\n## 目标\n',
        '\n\n  \nPart of #15\n',
        'part OF #15',
        '  Part of #15  \r\n## 目标',
        'Part of #015',
      ]),
    ).toEqual(['#15', '#15', '#15', '#15', '#15'])
  })

  it('不在首个非空行或格式不合法时没有父级', () => {
    expect(
      parentsOf([
        '## 目标\n\nPart of #15\n',
        '> Part of #15',
        '## Part of #15',
        '- Part of #15',
        'Part of #15，见父票',
        'Part of cnzgray/other#15',
        'Part of #',
        'Part of #0',
        'Part of 15',
        'Part of #99999999999999999999',
        '',
      ]),
    ).toEqual(Array.from({ length: 11 }, () => undefined))
  })

  it('指向自己时没有父级', () => {
    const parsed = parseIssuesPage(
      JSON.stringify([giteaIssue({ number: 16, title: '自引用', body: 'Part of #16' })]),
    )

    expect(parsed[0]?.ticket.parent).toBeUndefined()
  })

  it('父级与正文里的 Blocked by 行互不干扰', () => {
    const parsed = parseIssuesPage(
      JSON.stringify([
        giteaIssue({ number: 16, title: '子票', body: 'Part of #15\n\nBlocked by: #17\n' }),
        giteaIssue({ number: 17, title: '阻塞在首行', body: 'Blocked by: #15\n' }),
      ]),
    )

    expect(parsed.map((issue) => issue.ticket.parent)).toEqual(['#15', undefined])
    expect(parsed[0]?.body).toBe('Part of #15\n\nBlocked by: #17\n')
  })
})
