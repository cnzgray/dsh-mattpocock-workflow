import { describe, expect, it } from 'vitest'

import { TrackerError } from '../../core/tracker-error.ts'
import { parseWorkItemHierarchy } from './hierarchy.ts'

function output(nodes: readonly unknown[]): string {
  return JSON.stringify({ data: { project: { workItems: { nodes } } } })
}

describe('GitLab 工作项层级解析', () => {
  it('任务父级是工单时存 #iid，工单父级是 epic 时存 &iid', () => {
    const parsed = parseWorkItemHierarchy(
      output([
        {
          iid: '16',
          widgets: [{ type: 'HIERARCHY', parent: { iid: '15', workItemType: { name: 'Issue' } } }],
        },
        {
          iid: '17',
          widgets: [{ type: 'HIERARCHY', parent: { iid: '3', workItemType: { name: 'Epic' } } }],
        },
      ]),
    )

    expect(parsed).toEqual(
      new Map([
        [16, '#15'],
        [17, '&3'],
      ]),
    )
  })

  it('没有父级或父级类型不在列表内时忽略', () => {
    const parsed = parseWorkItemHierarchy(
      output([
        { iid: '15', widgets: [{ type: 'HIERARCHY', parent: null }] },
        {
          iid: '16',
          widgets: [
            { type: 'HIERARCHY', parent: { iid: '8', workItemType: { name: 'Objective' } } },
          ],
        },
        { iid: '17', widgets: [{ type: 'DESCRIPTION' }] },
      ]),
    )

    expect(parsed.size).toBe(0)
  })

  it('GraphQL 返回 errors 时按格式错误抛出', () => {
    const raw = JSON.stringify({ errors: [{ message: 'workItems 不可用' }] })

    expect(() => parseWorkItemHierarchy(raw)).toThrow(TrackerError)
    expect(() => parseWorkItemHierarchy(raw)).toThrow(/workItems/)
  })

  it('节点编号不合法时返回格式错误', () => {
    expect(() => parseWorkItemHierarchy(output([{ iid: 'x' }]))).toThrow(/编号/)
  })
})
