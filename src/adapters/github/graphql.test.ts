import { describe, expect, it } from 'vitest'

import { TrackerError } from '../../core/tracker-error.ts'
import { GH_ISSUES_OUTPUT } from './fixtures.ts'
import { parseIssueGraphql } from './graphql.ts'

describe('GraphQL 工单解析', () => {
  it('解析总数与每张票的字段', () => {
    const parsed = parseIssueGraphql(GH_ISSUES_OUTPUT)

    expect(parsed.total).toBe(30)
    expect(parsed.tickets).toHaveLength(5)
    expect(parsed.tickets[0]).toEqual({
      ref: '#15',
      number: 15,
      title: '右侧栏任务面板 MVP',
      state: 'open',
      labels: ['enhancement', 'ready-for-agent'],
      author: {
        login: 'cnzgray',
        displayName: 'Cnzgray',
        avatarUrl: 'https://avatars.githubusercontent.com/u/1234?v=4',
      },
      createdAt: '2026-11-12T14:11:22Z',
      updatedAt: '2026-11-12T14:11:38Z',
      openBlockers: 0,
    })
  })

  it('把阻塞汇总映射成未关闭阻塞数', () => {
    const parsed = parseIssueGraphql(GH_ISSUES_OUTPUT)

    expect(parsed.tickets.find((ticket) => ticket.number === 16)?.openBlockers).toBe(1)
    expect(parsed.tickets.find((ticket) => ticket.number === 7)?.openBlockers).toBe(2)
  })

  it('缺少依赖汇总时按 0 处理', () => {
    const output = JSON.stringify({
      data: {
        repository: {
          issues: {
            totalCount: 1,
            nodes: [
              {
                number: 1,
                title: '没有依赖',
                state: 'OPEN',
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
                labels: { nodes: [] },
              },
            ],
          },
        },
      },
    })

    expect(parseIssueGraphql(output).tickets[0]?.openBlockers).toBe(0)
  })

  it('缺少创建人时整张票仍然可用，创建人为 null', () => {
    const output = JSON.stringify({
      data: {
        repository: {
          issues: {
            totalCount: 1,
            nodes: [
              {
                number: 1,
                title: '没有创建人',
                state: 'OPEN',
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
                labels: { nodes: [] },
                author: null,
              },
            ],
          },
        },
      },
    })

    expect(parseIssueGraphql(output).tickets[0]?.author).toBeNull()
  })

  it('输出不是 JSON 时返回抓取失败', () => {
    expect(() => parseIssueGraphql('not json')).toThrow(TrackerError)
  })

  it('仓库不存在时返回抓取失败', () => {
    expect(() => parseIssueGraphql(JSON.stringify({ data: { repository: null } }))).toThrow(
      /找不到这个仓库/,
    )
  })

  it('缺少 totalCount 时返回数据格式错误，而不是静默当成已加载数', () => {
    const output = JSON.stringify({
      data: { repository: { issues: { nodes: [] } } },
    })

    expect(() => parseIssueGraphql(output)).toThrow(/totalCount/)
  })

  it('状态不是 open/closed 时返回数据格式错误', () => {
    const output = JSON.stringify({
      data: {
        repository: {
          issues: {
            totalCount: 1,
            nodes: [
              {
                number: 1,
                title: '状态坏了',
                state: 'MERGED',
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
              },
            ],
          },
        },
      },
    })

    expect(() => parseIssueGraphql(output)).toThrow(/状态不合法/)
  })

  it('阻塞数不是非负数时返回数据格式错误', () => {
    const output = JSON.stringify({
      data: {
        repository: {
          issues: {
            totalCount: 1,
            nodes: [
              {
                number: 1,
                title: '阻塞数坏了',
                state: 'OPEN',
                createdAt: '2026-01-01T00:00:00Z',
                updatedAt: '2026-01-01T00:00:00Z',
                issueDependenciesSummary: { blockedBy: -1 },
              },
            ],
          },
        },
      },
    })

    expect(() => parseIssueGraphql(output)).toThrow(/blockedBy/)
  })

  it('带上 http(s) 网页地址，缺失或不是 http(s) 时省略', () => {
    const node = (number: number, url: unknown): Record<string, unknown> => ({
      number,
      title: `票 ${String(number)}`,
      url,
      state: 'OPEN',
      createdAt: '2026-11-12T14:11:22Z',
      updatedAt: '2026-11-12T14:11:38Z',
      labels: { nodes: [] },
    })
    const output = JSON.stringify({
      data: {
        repository: {
          issues: {
            totalCount: 3,
            nodes: [
              node(1, 'https://github.com/cnzgray/dsh-mattpocock-workflow/issues/1'),
              node(2, 'javascript:alert(1)'),
              node(3, undefined),
            ],
          },
        },
      },
    })

    const tickets = parseIssueGraphql(output).tickets

    expect(tickets.map((ticket) => ticket.url)).toEqual([
      'https://github.com/cnzgray/dsh-mattpocock-workflow/issues/1',
      undefined,
      undefined,
    ])
    expect(Object.hasOwn(tickets[1] ?? {}, 'url')).toBe(false)
  })
})
