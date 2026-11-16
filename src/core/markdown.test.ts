import { describe, expect, it } from 'vitest'

import {
  markdownLabels,
  markdownState,
  parseMarkdownDetail,
  parseMarkdownTickets,
  titleFromFileName,
  workspaceName,
  type MarkdownTicketFile,
} from './markdown.ts'

function file(
  feature: string,
  name: string,
  content: string,
  overrides: Partial<MarkdownTicketFile> = {},
): MarkdownTicketFile {
  return {
    path: `.scratch/${feature}/issues/${name}`,
    feature,
    name,
    content,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  }
}

describe('本地 Markdown 工单解析', () => {
  it('标题取第一个一级标题，ref 用相对路径，number 为空', () => {
    const tickets = parseMarkdownTickets([
      file('login', '03-session.md', '# 会话过期处理\n\nStatus: ready-for-agent\n'),
    ])

    expect(tickets).toEqual([
      {
        ref: '.scratch/login/issues/03-session.md',
        number: null,
        title: '会话过期处理',
        state: 'open',
        labels: ['ready-for-agent'],
        author: null,
        assignees: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        openBlockers: 0,
        blockedBy: [],
      },
    ])
  })

  it('没有一级标题时退回去掉编号与扩展名的文件名', () => {
    const tickets = parseMarkdownTickets([
      file('login', '01-refresh-token-design.md', 'Status: ready-for-agent\n'),
      file('login', '02-plain.md', '没有标题\n'),
    ])

    expect(tickets.map((ticket) => ticket.title)).toEqual(['refresh-token-design', 'plain'])
  })

  it('Status: resolved 算已关闭，其余状态算开放', () => {
    const tickets = parseMarkdownTickets([
      file('a', '01-done.md', '# 完成\nStatus: resolved\n'),
      file('a', '02-claimed.md', '# 进行中\nStatus: claimed\n'),
      file('a', '03-none.md', '# 没有状态\n'),
    ])

    expect(tickets.map((ticket) => [ticket.state, ticket.labels])).toEqual([
      ['closed', ['resolved']],
      ['open', ['claimed']],
      ['open', []],
    ])
  })

  it('Status 行取第一个词并转小写', () => {
    const tickets = parseMarkdownTickets([
      file('a', '01-ready.md', '# 准备开工\nStatus: Ready-For-Agent — 规格已确认\n'),
    ])

    expect(tickets[0]?.labels).toEqual(['ready-for-agent'])
  })

  it('Blocked by 只解析同一 feature 内被引用文件的当前状态', () => {
    const tickets = parseMarkdownTickets([
      file('login', '01-open.md', '# 开放\nStatus: claimed\n'),
      file('login', '02-resolved.md', '# 完成\nStatus: resolved\n'),
      file('login', '03-blocked.md', '# 被阻塞\nStatus: ready-for-agent\nBlocked by: 01, 02\n'),
      file('login', '04-waiting.md', '# 等外部\nStatus: ready-for-agent\nBlocked by: #05\n'),
    ])

    expect(tickets.map((ticket) => ticket.openBlockers)).toEqual([0, 0, 1, 1])
    expect(tickets[2]?.blockedBy).toEqual([
      '.scratch/login/issues/01-open.md',
      '.scratch/login/issues/02-resolved.md',
    ])
    // 引用的文件不在同一 feature 里时没有可指向的票，链深度只沿已知票走。
    expect(tickets[3]?.blockedBy).toEqual([])
  })

  it('被引用文件不存在时按未关闭处理', () => {
    const ticket = parseMarkdownTickets([
      file('login', '03-blocked.md', '# 被阻塞\nBlocked by: 07\n'),
    ])[0]

    expect(ticket?.openBlockers).toBe(1)
  })

  it('其他 feature 里的同名编号不算本 feature 的阻塞票', () => {
    const ticket = parseMarkdownTickets([
      file('login', '03-blocked.md', '# 被阻塞\nBlocked by: 01\n'),
      file('billing', '01-unrelated.md', '# 无关\nStatus: resolved\n'),
    ])[0]

    expect(ticket?.openBlockers).toBe(1)
  })

  it('忽略 Comments 里的 Status 与 Blocked by', () => {
    const tickets = parseMarkdownTickets([
      file('a', '01-open.md', '# 开放\n\n## Comments\n\nStatus: resolved\nBlocked by: 02\n'),
      file('a', '02-open-blocker.md', '# 仍然是开放的阻塞票\nStatus: claimed\n'),
    ])

    expect(tickets[0]?.state).toBe('open')
    expect(tickets[0]?.openBlockers).toBe(0)
  })

  it('保持输入顺序', () => {
    const tickets = parseMarkdownTickets([
      file('a', '03-c.md', '# C\n'),
      file('a', '01-a.md', '# A\n'),
      file('b', '02-b.md', '# B\n'),
    ])

    expect(tickets.map((ticket) => ticket.ref)).toEqual([
      '.scratch/a/issues/03-c.md',
      '.scratch/a/issues/01-a.md',
      '.scratch/b/issues/02-b.md',
    ])
  })
})

describe('工作区显示名', () => {
  it.each([
    ['/Users/zgray/projects/repo', 'repo'],
    ['/Users/zgray/projects/repo/', 'repo'],
    ['/repo', 'repo'],
    ['repo', 'repo'],
    ['C:\\work\\repo', 'repo'],
  ])('%s 的显示名是 %s', (root, expected) => {
    expect(workspaceName(root)).toBe(expected)
  })
})

describe('本地 Markdown 工单详情', () => {
  it('正文取标题之后、Comments 之前，保留原始 Markdown', () => {
    const content = [
      '# 会话过期处理',
      '',
      'Status: ready-for-agent',
      '',
      '## 复现步骤',
      '',
      '1. 打开面板',
      '2. 刷新',
      '',
      '## Comments',
      '',
      '维护者补充：先修列表。',
    ].join('\n')

    expect(parseMarkdownDetail(content, '回退标题')).toEqual({
      title: '会话过期处理',
      body: 'Status: ready-for-agent\n\n## 复现步骤\n\n1. 打开面板\n2. 刷新',
      comments: ['维护者补充：先修列表。'],
    })
  })

  it('评论段按空行拆成多条并保持顺序', () => {
    const content = ['# 标题', '', '## Comments', '', '第一条评论', '', '第二条评论'].join('\n')

    expect(parseMarkdownDetail(content, '回退标题').comments).toEqual(['第一条评论', '第二条评论'])
  })

  it('没有标题行时用回退标题，没有 Comments 段时评论为空', () => {
    const parsed = parseMarkdownDetail('正文内容\n', '03-session')

    expect(parsed.title).toBe('03-session')
    expect(parsed.body).toBe('正文内容')
    expect(parsed.comments).toEqual([])
  })

  it('Status 行同时决定状态与标签', () => {
    expect(markdownState('Status: resolved\n')).toBe('closed')
    expect(markdownState('Status: ready-for-agent\n')).toBe('open')
    expect(markdownLabels('Status: resolved\n')).toEqual(['resolved'])
    expect(markdownLabels('没有状态行\n')).toEqual([])
  })

  it('文件名回退去掉编号与扩展名', () => {
    expect(titleFromFileName('03-session.md')).toBe('session')
    expect(titleFromFileName('.md')).toBe('')
  })
})
