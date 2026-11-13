import { describe, expect, it } from 'vitest'

import {
  countDescriptionBlockers,
  hasDescriptionBlockers,
  resolveOpenBlockers,
} from './blocked-by.ts'
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

  it('只看正文顶部是否有 Blocked by 行，不判断被引用票的状态', () => {
    expect(hasDescriptionBlockers('Blocked by: #9')).toBe(true)
    expect(hasDescriptionBlockers('前情\nBlocked by: #15')).toBe(true)
    expect(hasDescriptionBlockers('没有阻塞关系')).toBe(false)
    expect(hasDescriptionBlockers('## Comments\n\nBlocked by: #15')).toBe(false)
  })
})

describe('远端工单的阻塞数', () => {
  it('原生依赖有未关闭的票时以它为准', () => {
    expect(
      resolveOpenBlockers({
        ticket: { state: 'open', number: 16 },
        nativeBlockers: 2,
        text: 'Blocked by: #15',
        states: STATES,
      }),
    ).toBe(2)
  })

  it('原生依赖为空时退回正文的 Blocked by 行', () => {
    expect(
      resolveOpenBlockers({
        ticket: { state: 'open', number: 16 },
        nativeBlockers: 0,
        text: 'Blocked by: #15, #9',
        states: STATES,
      }),
    ).toBe(1)
  })

  it('依赖功能不可用（undefined）时同样读正文', () => {
    expect(
      resolveOpenBlockers({
        ticket: { state: 'open', number: 16 },
        nativeBlockers: undefined,
        text: 'Blocked by: #15',
        states: STATES,
      }),
    ).toBe(1)
  })

  it('已关闭或没有编号的票没有阻塞数', () => {
    expect(
      resolveOpenBlockers({
        ticket: { state: 'closed', number: 9 },
        nativeBlockers: 3,
        text: 'Blocked by: #15',
        states: STATES,
      }),
    ).toBe(0)
    expect(
      resolveOpenBlockers({
        ticket: { state: 'open', number: null },
        nativeBlockers: 1,
        text: '',
        states: STATES,
      }),
    ).toBe(0)
  })
})
