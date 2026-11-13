import { describe, expect, it } from 'vitest'

import { countNativeBlockers, encodeProjectPath, parseIssuesPage } from './parse.ts'

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
      },
      description: '# 目标\n',
    })
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

  it('原生链接只统计未关闭的 is_blocked_by', () => {
    const output = JSON.stringify([
      { iid: 15, state: 'opened', link_type: 'is_blocked_by' },
      { iid: 7, state: 'closed', link_type: 'is_blocked_by' },
      { iid: 8, state: 'opened', link_type: 'relates_to' },
    ])

    expect(countNativeBlockers(output)).toBe(1)
  })

  it('嵌套 group 的项目路径编码成单个路径段', () => {
    expect(encodeProjectPath('group/sub/repo')).toBe('group%2Fsub%2Frepo')
  })
})
