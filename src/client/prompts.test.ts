import { describe, expect, it } from 'vitest'

import { INTAKE_COMMANDS } from '../protocol/flow.ts'
import { newBugPrompt, newFeaturePrompt } from './prompts.ts'
import { gestures } from './prompt-test-support.ts'

describe('面板入池提示词', () => {
  it('两个创建按钮的第一行是插件自带的入池命令，草稿里只有这一个手势', () => {
    for (const [text, name] of [
      [newFeaturePrompt(), 'mattwf-feature'],
      [newBugPrompt(), 'mattwf-bug'],
    ] as const) {
      expect(text.split('\n')[0]).toBe(`/${name}`)
      expect(gestures(text)).toEqual([name])
    }
  })

  it('缺陷草稿带三个槽位，需求草稿只带一个一句话需求槽位', () => {
    const bug = newBugPrompt()
    for (const slot of ['现象：', '复现步骤：', '预期行为：']) {
      expect(bug.split('\n')).toContain(slot)
    }
    expect(bug.trimEnd().endsWith('预期行为：')).toBe(true)

    const feature = newFeaturePrompt()
    expect(feature.split('\n')).toContain('需求（一句话）：')
    expect(feature.trimEnd().endsWith('需求（一句话）：')).toBe(true)
    expect(feature.split('\n').filter((line) => line.endsWith('：'))).toHaveLength(1)
  })

  it('槽位与流程定义一致，换一个入池命令不会漏掉槽位', () => {
    for (const intake of Object.values(INTAKE_COMMANDS)) {
      const text = intake.kind === 'bug' ? newBugPrompt() : newFeaturePrompt()
      for (const slot of intake.slots) {
        expect(text).toContain(slot)
      }
    }
  })

  it('草稿里不出现任何 matt 技能的手势，技能正文和阶段说明都交给命令正文', () => {
    for (const text of [newFeaturePrompt(), newBugPrompt()]) {
      for (const skill of [
        'grill-with-docs',
        'to-spec',
        'to-tickets',
        'triage',
        'diagnosing-bugs',
        'wayfinder',
        'implement',
      ]) {
        expect(gestures(text)).not.toContain(skill)
      }
      expect(text).not.toContain('当前阶段')
      expect(text).not.toContain('跟踪器')
    }
  })
})
