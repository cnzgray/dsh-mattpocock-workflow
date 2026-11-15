import { describe, expect, it } from 'vitest'

import { SKILL_ACTION_SKILLS } from '../protocol/env-check.ts'
import { DIRECT_SPEC_ENTRY, FLOW_COMMANDS, INTAKE_COMMANDS } from '../protocol/flow.ts'
import { builtinZhTranslate } from './i18n-runtime.ts'
import {
  newBugPrompt as newBugPromptWithT,
  newFeaturePrompt as newFeaturePromptWithT,
  newSpecPrompt as newSpecPromptWithT,
  ticketPrompt,
} from './prompts.ts'

import { gestures } from './prompt-test-support.ts'

const newFeaturePrompt = () => newFeaturePromptWithT(builtinZhTranslate)
const newBugPrompt = () => newBugPromptWithT(builtinZhTranslate)
const newSpecPrompt = () => newSpecPromptWithT(builtinZhTranslate)

describe('工单技能提示词', () => {
  it('只有技能手势和工单引用，步骤留给技能正文', () => {
    expect(ticketPrompt({ ref: '#40', skillAction: 'implement' })).toBe('/implement #40')
    expect(ticketPrompt({ ref: '#40', skillAction: 'diagnose' })).toBe('/diagnosing-bugs #40')
    expect(ticketPrompt({ ref: '#40', skillAction: 'triage' })).toBe('/triage #40')
    expect(
      ticketPrompt({ ref: '.scratch/login/issues/01-signup.md', skillAction: 'implement' }),
    ).toBe('/implement .scratch/login/issues/01-signup.md')
  })

  it('技能名与手势一致，DSH 发送时能加载对应技能', () => {
    for (const skillAction of ['implement', 'diagnose', 'triage'] as const) {
      const text = ticketPrompt({ ref: '#40', skillAction }) ?? ''
      expect(gestures(text)).toEqual([SKILL_ACTION_SKILLS[skillAction]])
    }
  })

  it('不可开工的票不生成提示词', () => {
    expect(ticketPrompt({ ref: '#40', skillAction: 'none' })).toBeNull()
  })
})

describe('面板入池提示词', () => {
  it('两个入池按钮的第一行是插件自带的入池命令，草稿里只有这一个手势', () => {
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
    const labels = {
      symptom: '现象：',
      steps: '复现步骤：',
      expected: '预期行为：',
      feature: '需求（一句话）：',
      description: '需求描述：',
    } as const
    for (const intake of Object.values(INTAKE_COMMANDS)) {
      const text = intake.kind === 'bug' ? newBugPrompt() : newFeaturePrompt()
      for (const slot of intake.slots) {
        expect(text).toContain(labels[slot])
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

describe('面板直达规格提示词', () => {
  it('第一行是 to-spec 手势，草稿里只有这一个手势', () => {
    const text = newSpecPrompt()
    expect(text.split('\n')[0]).toBe(`/${FLOW_COMMANDS[DIRECT_SPEC_ENTRY.command].name}`)
    expect(gestures(text)).toEqual(['to-spec'])
  })

  it('槽位来自直达规格入口定义，只有一处需求描述', () => {
    const text = newSpecPrompt()
    expect(DIRECT_SPEC_ENTRY.slots).toEqual(['description'])
    expect(text).toContain('需求描述：')
    expect(text.split('\n').filter((line) => line.endsWith('：'))).toHaveLength(1)
  })

  it('不写阶段说明、边界与跟踪器，步骤交给技能正文', () => {
    const text = newSpecPrompt()
    expect(text).not.toContain('当前阶段')
    expect(text).not.toContain('跟踪器')
  })
})
