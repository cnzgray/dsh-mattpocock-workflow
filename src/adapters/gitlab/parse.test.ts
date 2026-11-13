import { describe, expect, it } from 'vitest'

import {
  encodeProjectPath,
  hasNativeBlockingLinks,
  parseBlockedByCounts,
  parseIssuesPage,
  parseNativeBlockers,
} from './parse.ts'

describe('GitLab 工单解析', () => {
  it('把一页 issue 映射成 ref、状态与标签', () => {
    const parsed = parseIssuesPage(
      JSON.stringify([
        {
          iid: 15,
          title: '右侧栏任务面板 MVP',
          state: 'opened',
          labels: ['enhancement', 'ready-for-agent'],
          description: '# 目标\n',
          created_at: '2026-11-12T14:11:22Z',
          updated_at: '2026-11-21T14:11:38Z',
        },
      ]),
    )

    expect(parsed[0]).toEqual({
      ticket: {
        ref: '#15',
        number: 15,
        title: '右侧栏任务面板 MVP',
        state: 'open',
        labels: ['enhancement', 'ready-for-agent'],
        createdAt: '2026-11-12T14:11:22Z',
        updatedAt: '2026-11-21T14:11:38Z',
        openBlockers: 0,
        blockedBy: [],
      },
      description: '# 目标\n',
      hasBlockingIssuesCount: false,
    })
  })

  it('记录列表里是否带 blocking_issues_count 能力字段', () => {
    const output = JSON.stringify([
      {
        iid: 15,
        title: '带字段的票',
        state: 'opened',
        blocking_issues_count: 0,
        created_at: '2026-11-12T14:11:22Z',
        updated_at: '2026-11-21T14:11:38Z',
      },
    ])

    expect(parseIssuesPage(output)[0]?.hasBlockingIssuesCount).toBe(true)
  })

  it('状态不是 opened/closed 时返回数据格式错误', () => {
    const output = JSON.stringify([
      {
        iid: 1,
        title: '状态坏了',
        state: 'merged',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ])

    expect(() => parseIssuesPage(output)).toThrow(/状态不合法/)
  })

  it('嵌套 group 的项目路径编码成单个路径段', () => {
    expect(encodeProjectPath('group/sub/repo')).toBe('group%2Fsub%2Frepo')
  })

  it('原生链接给出未关闭数与全部 is_blocked_by 编号', () => {
    const output = JSON.stringify([
      { iid: 15, state: 'opened', link_type: 'is_blocked_by' },
      { iid: 7, state: 'closed', link_type: 'is_blocked_by' },
      { iid: 8, state: 'opened', link_type: 'relates_to' },
    ])

    expect(parseNativeBlockers(output)).toEqual({ open: 1, refs: [15, 7] })
  })
})

describe('GitLab 原生阻塞能力探测', () => {
  it('空数组判定为不支持', () => {
    expect(hasNativeBlockingLinks('[]')).toBe(false)
  })

  it('只有 relates_to 链接时仍判定为不支持', () => {
    const output = JSON.stringify([{ iid: 15, state: 'opened', link_type: 'relates_to' }])

    expect(hasNativeBlockingLinks(output)).toBe(false)
  })

  it('is_blocked_by 或 blocks 链接证明实例支持原生阻塞', () => {
    const blockedBy = JSON.stringify([{ iid: 15, state: 'opened', link_type: 'is_blocked_by' }])
    const blocks = JSON.stringify([{ iid: 15, state: 'closed', link_type: 'blocks' }])

    expect(hasNativeBlockingLinks(blockedBy)).toBe(true)
    expect(hasNativeBlockingLinks(blocks)).toBe(true)
  })

  it('链接响应不是数组时返回格式错误', () => {
    expect(() => hasNativeBlockingLinks('{"message":"404 Not Found"}')).toThrow(/工单链接不是数组/)
  })
})

describe('GitLab 批量阻塞计数解析', () => {
  it('读取每张票的未关闭阻塞数', () => {
    const output = JSON.stringify({
      data: {
        project: {
          issues: {
            nodes: [
              { iid: '15', blockedByCount: 0 },
              { iid: '16', blockedByCount: 2 },
            ],
          },
        },
      },
    })

    expect(parseBlockedByCounts(output)).toEqual(
      new Map([
        [15, 0],
        [16, 2],
      ]),
    )
  })

  it('blockedByCount 缺失或为 null 的票跳过，交给描述回退', () => {
    const output = JSON.stringify({
      data: {
        project: {
          issues: {
            nodes: [
              { iid: '15', blockedByCount: null },
              { iid: '16' },
              { iid: '17', blockedByCount: 1 },
            ],
          },
        },
      },
    })

    expect(parseBlockedByCounts(output)).toEqual(new Map([[17, 1]]))
  })

  it('GraphQL 返回 errors 时按格式错误抛出', () => {
    const output = JSON.stringify({
      errors: [{ message: "Field 'blockedByCount' doesn't exist on type 'Issue'" }],
    })

    expect(() => parseBlockedByCounts(output)).toThrow(/blockedByCount/)
  })

  it('计数字段不是非负整数时返回格式错误', () => {
    const output = JSON.stringify({
      data: { project: { issues: { nodes: [{ iid: '15', blockedByCount: -1 }] } } },
    })

    expect(() => parseBlockedByCounts(output)).toThrow(/blockedByCount/)
  })
})
