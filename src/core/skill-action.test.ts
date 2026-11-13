import { describe, expect, it } from 'vitest'

import { decideSkillAction, withSkillActions } from './skill-action.ts'
import type { Ticket, TicketLabelNames } from './ticket.ts'

const NAMES: TicketLabelNames = {
  readyForAgent: 'ready-for-agent',
  needsTriage: 'needs-triage',
  needsInfo: 'needs-info',
  readyForHuman: 'ready-for-human',
  wontfix: 'wontfix',
  bug: 'bug',
  enhancement: 'enhancement',
}

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    ref: '#1',
    number: 1,
    title: '一张票',
    state: 'open',
    labels: [],
    author: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    openBlockers: 0,
    ...overrides,
  }
}

describe('技能动作判定', () => {
  it('已关闭的票不提供注入，即使带可接标签或 wontfix', () => {
    expect(
      decideSkillAction(
        ticket({ state: 'closed', labels: ['ready-for-agent', 'enhancement'] }),
        NAMES,
      ),
    ).toEqual({ skillAction: 'none', skillActionReason: 'closed' })
  })

  it('有未关闭阻塞的票不提供注入，阻塞优先于状态标签', () => {
    expect(
      decideSkillAction(
        ticket({
          labels: ['ready-for-agent', 'enhancement'],
          openBlockers: 2,
        }),
        NAMES,
      ),
    ).toEqual({ skillAction: 'none', skillActionReason: 'blocked' })
  })

  it('wontfix 优先于可接与分类标签', () => {
    expect(
      decideSkillAction(ticket({ labels: ['wontfix', 'ready-for-agent', 'bug'] }), NAMES),
    ).toEqual({ skillAction: 'none', skillActionReason: 'wontfix' })
  })

  it('ready-for-human 优先于可接与分类标签', () => {
    expect(
      decideSkillAction(
        ticket({ labels: ['ready-for-human', 'ready-for-agent', 'enhancement'] }),
        NAMES,
      ),
    ).toEqual({ skillAction: 'none', skillActionReason: 'ready-for-human' })
  })

  it('needs-triage 指向 triage，优先于 needs-info', () => {
    expect(decideSkillAction(ticket({ labels: ['needs-info', 'needs-triage'] }), NAMES)).toEqual({
      skillAction: 'triage',
      skillActionReason: 'needs-triage',
    })
  })

  it('needs-info 指向 triage', () => {
    expect(decideSkillAction(ticket({ labels: ['needs-info'] }), NAMES)).toEqual({
      skillAction: 'triage',
      skillActionReason: 'needs-info',
    })
  })

  it('可接的缺陷指向先诊断，bug 与 enhancement 同时出现时按 bug', () => {
    expect(
      decideSkillAction(ticket({ labels: ['ready-for-agent', 'enhancement', 'bug'] }), NAMES),
    ).toEqual({ skillAction: 'diagnose', skillActionReason: 'bug' })
  })

  it('可接的需求指向按规格实现', () => {
    expect(
      decideSkillAction(ticket({ labels: ['ready-for-agent', 'enhancement'] }), NAMES),
    ).toEqual({ skillAction: 'implement', skillActionReason: 'ready-for-agent' })
  })

  it('可接但没有分类标签时仍然指向实现', () => {
    expect(decideSkillAction(ticket({ labels: ['ready-for-agent'] }), NAMES)).toEqual({
      skillAction: 'implement',
      skillActionReason: 'ready-for-agent',
    })
  })

  it('没有 triage 标签的开放票落到先分流，例如本地 Markdown 工单', () => {
    expect(decideSkillAction(ticket({ labels: ['Blocked by: #1'] }), NAMES)).toEqual({
      skillAction: 'triage',
      skillActionReason: 'untriaged',
    })
  })

  it('批量附加动作时保持输入顺序', () => {
    const result = withSkillActions(
      [
        ticket({ number: 2, labels: ['ready-for-agent', 'bug'] }),
        ticket({ number: 1, state: 'closed', labels: [] }),
      ],
      NAMES,
    )

    expect(result.map((item) => [item.number, item.skillAction, item.skillActionReason])).toEqual([
      [2, 'diagnose', 'bug'],
      [1, 'none', 'closed'],
    ])
  })
})
