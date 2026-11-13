import { describe, expect, it } from 'vitest'

import { countDescriptionBlockers } from './blocked-by.ts'
import type { TicketState } from './ticket.ts'

const STATES = new Map<number, TicketState>([
  [15, 'open'],
  [9, 'closed'],
])

describe('Blocked by 行', () => {
  it('统计未关闭的被引用票，已关闭的不算', () => {
    expect(countDescriptionBlockers('# 票\nBlocked by: #15, #9, #99', STATES)).toBe(2)
  })

  it('忽略 Comments 标题之后的内容', () => {
    expect(countDescriptionBlockers('# 票\n\n## Comments\n\nBlocked by: #15\n', STATES)).toBe(0)
  })

  it('重复引用只算一次，没有该行时为 0', () => {
    expect(countDescriptionBlockers('Blocked by: #15, #15', STATES)).toBe(1)
    expect(countDescriptionBlockers('没有阻塞关系', STATES)).toBe(0)
  })
})
