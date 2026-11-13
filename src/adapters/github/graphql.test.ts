import { describe, expect, it } from 'vitest'

import { TrackerError } from '../../core/tracker-error.ts'
import { GH_CHANGES_OUTPUT, GH_ISSUES_OUTPUT, GH_TRUNCATED_CHANGES_OUTPUT } from './fixtures.ts'
import { parseIssueChangesGraphql, parseIssueGraphql } from './graphql.ts'

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
})

describe('GraphQL 增量解析', () => {
  it('解析窗口内变更过的工单与仓库总数', () => {
    const parsed = parseIssueChangesGraphql(GH_CHANGES_OUTPUT)

    expect(parsed.tickets.map((ticket) => ticket.ref)).toEqual(['#16', '#12'])
    expect(parsed.truncated).toBe(false)
    expect(parsed.total).toBe(30)
  })

  it('后端还有下一页时标记为截断', () => {
    expect(parseIssueChangesGraphql(GH_TRUNCATED_CHANGES_OUTPUT).truncated).toBe(true)
  })

  it('拿不到分页信息时按可能不完整处理，让宿主退回全量重拉', () => {
    const output = JSON.stringify({ data: { repository: { issues: { nodes: [] } } } })

    expect(parseIssueChangesGraphql(output).truncated).toBe(true)
  })

  it('仓库总数给不出时不报总数，宿主沿用上次的', () => {
    const output = JSON.stringify({
      data: { repository: { issues: { pageInfo: { hasNextPage: false }, nodes: [] } } },
    })

    expect(parseIssueChangesGraphql(output).total).toBeUndefined()
  })

  it('输出不是 JSON 时返回抓取失败', () => {
    expect(() => parseIssueChangesGraphql('not json')).toThrow(TrackerError)
  })
})
