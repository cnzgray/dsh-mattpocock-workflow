import { describe, expect, it, vi, type Mock } from 'vitest'

import { REQUIRED_SKILLS } from '../protocol/env-check.ts'
import { FLOW_COMMANDS, INTAKE_COMMANDS, NEXT_STEPS } from '../protocol/flow.ts'
import { TRACKER_LABELS } from '../protocol/labels.ts'
import type {
  DshContext,
  DshLogger,
  SkillRegistrationLike,
  SkillRegistryLike,
} from './dsh-types.ts'
import {
  createWorkflowSkills,
  registerWorkflowCommands,
  registerWorkflowSkills,
} from './workflow-commands.ts'

/** 与 DSH 的技能手势语法相同：空白或行边界包裹的 `/kebab-name`。 */
const GESTURE = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g

function gestures(text: string): readonly string[] {
  return [...text.matchAll(GESTURE)].map((match) => match[2] ?? '')
}

interface FakeLogger extends DshLogger {
  readonly info: Mock
  readonly warn: Mock
  readonly error: Mock
}

function fakeLogger(): FakeLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

interface FakeScope {
  readonly scope: DshContext
  readonly dispose: () => void
}

function fakeScope(skills: unknown): FakeScope {
  let disposer: (() => void) | undefined
  const scope = {
    logger: () => fakeLogger(),
    get: (name: string) => (name === 'skills' ? skills : undefined),
    inject: () => undefined,
    effect: (setup: () => () => void) => {
      disposer = setup()
      return undefined
    },
  } as DshContext
  return {
    scope,
    dispose: () => {
      disposer?.()
    },
  }
}

describe('入池命令正文', () => {
  const [bugSkill, featureSkill] = createWorkflowSkills()

  it('两个命令都是只有用户能调用的内嵌技能', () => {
    expect(createWorkflowSkills().map((skill) => skill.name)).toEqual([
      FLOW_COMMANDS.intakeBug.name,
      FLOW_COMMANDS.intakeFeature.name,
    ])
    for (const skill of [bugSkill, featureSkill]) {
      expect(skill).toBeDefined()
      expect(skill?.invocation).toEqual({ modelInvocable: false, userInvocable: true })
      // DSH 加载内嵌技能时要求 source 是字符串；缺了会在手势命中时加载失败。
      expect(skill?.source).toBe('runtime')
      expect(skill?.description).toContain('只入池')
    }
  })

  it('缺陷票打 bug 与 needs-triage，需求票只打 needs-triage', () => {
    expect(bugSkill?.content).toContain('打上这些标签：bug、needs-triage。')
    expect(featureSkill?.content).toContain('打上这些标签：needs-triage。')
    expect(featureSkill?.content).not.toContain('enhancement')
  })

  it('标签名取自标签映射，不手写后端相关的字面量', () => {
    const custom = {
      ...TRACKER_LABELS,
      bug: 'defect',
      needsTriage: 'triage-me',
    }
    const [bug] = createWorkflowSkills(custom)
    expect(bug?.content).toContain('defect、triage-me')
  })

  it('可推荐的下一步正好是流程定义里的候选集合，缺陷只能推荐 triage', () => {
    for (const intake of Object.values(INTAKE_COMMANDS)) {
      const skill = createWorkflowSkills().find(
        (entry) => entry.name === FLOW_COMMANDS[intake.command].name,
      )
      const expected = intake.nextSteps.map((id) => FLOW_COMMANDS[NEXT_STEPS[id].command].name)
      expect([...new Set(gestures(skill?.content ?? ''))]).toEqual(expected)
    }

    expect([...new Set(gestures(bugSkill?.content ?? ''))]).toEqual([FLOW_COMMANDS.triage.name])
  })

  it('正文写明先问的情形、图片规则与建完就停', () => {
    for (const skill of [bugSkill, featureSkill]) {
      for (const phrase of [
        '疑似重复',
        '拆还是合',
        '先问用户',
        '能证明问题',
        '不要放进票',
        '私有数据',
        '手动补图',
        '然后停下',
        '不翻代码',
        '不自行拆票',
        '不建父票',
        '不声明阻塞关系',
      ]) {
        expect(skill?.content).toContain(phrase)
      }
    }
  })

  it('正文只给候选命令和交接方式，不写文件路径', () => {
    for (const skill of [bugSkill, featureSkill]) {
      expect(skill?.content).not.toMatch(/(^|\s)(\/Users\/|\/home\/|docs\/|\.md\b)/)
      expect(skill?.content).toContain('<票的引用>')
    }
  })

  it('插件自带的命令不计入需要用户安装的技能清单', () => {
    const pluginNames = createWorkflowSkills().map((skill) => skill.name)
    for (const name of REQUIRED_SKILLS) {
      expect(pluginNames).not.toContain(name)
    }
  })
})

describe('入池命令注册', () => {
  interface RegistryFixture {
    readonly registry: SkillRegistryLike
    readonly registered: SkillRegistrationLike[]
    readonly disposers: (() => void)[]
  }

  function fakeRegistry(onRegister?: (skill: SkillRegistrationLike) => void): RegistryFixture {
    const registered: SkillRegistrationLike[] = []
    const disposers: (() => void)[] = []
    return {
      registered,
      disposers,
      registry: {
        list: () => Promise.resolve([]),
        register(skill) {
          onRegister?.(skill)
          const dispose = vi.fn()
          registered.push(skill)
          disposers.push(dispose)
          return dispose
        },
      },
    }
  }

  it('技能服务可用时两个命令都注册上，销毁时逐个撤销', () => {
    const fixture = fakeRegistry()
    const { scope, dispose } = fakeScope(fixture.registry)

    registerWorkflowCommands(scope, fakeLogger())

    expect(fixture.registered.map((skill) => skill.name)).toEqual([
      FLOW_COMMANDS.intakeBug.name,
      FLOW_COMMANDS.intakeFeature.name,
    ])
    dispose()
    for (const registeredDisposer of fixture.disposers) {
      expect(registeredDisposer).toHaveBeenCalledTimes(1)
    }
  })

  it('技能服务缺失时只记日志，不注册也不抛错', () => {
    const logger = fakeLogger()
    const { scope, dispose } = fakeScope(undefined)

    expect(() => {
      registerWorkflowCommands(scope, logger)
    }).not.toThrow()
    expect(logger.warn).toHaveBeenCalledWith('%s', 'skills 服务不可用，入池命令未注册。')
    expect(() => {
      dispose()
    }).not.toThrow()
  })

  it('单个命令注册失败不影响另一个，并记下失败原因', () => {
    const logger = fakeLogger()
    const fixture = fakeRegistry((skill) => {
      if (skill.name === FLOW_COMMANDS.intakeBug.name) throw new Error('名称冲突')
    })

    registerWorkflowSkills(fixture.registry, logger)

    expect(fixture.registered.map((skill) => skill.name)).toEqual([
      FLOW_COMMANDS.intakeFeature.name,
    ])
    expect(logger.error).toHaveBeenCalledWith('%s %s', 'mattwf-bug 注册失败：', '名称冲突')
  })
})
