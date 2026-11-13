/**
 * 入池命令：正文生成与注册。
 *
 * 正文是给 agent 的指令——把用户的报告写成一张原始工单放进池里，然后停下。
 * 标签和候选下一步都从 protocol 的流程定义与标签映射读取，不手写命令名。
 * 技能本身只在内存里注册，不往用户的技能目录写文件。
 */
import {
  FLOW_COMMANDS,
  INTAKE_COMMANDS,
  NEXT_STEPS,
  type IntakeCommandDefinition,
  type IntakeKind,
} from '../protocol/flow.ts'
import { TRACKER_LABELS, type TrackerLabelNames } from '../protocol/labels.ts'
import {
  readSkillRegistry,
  type DshContext,
  type DshLogger,
  type SkillRegistryLike,
} from './dsh-types.ts'

/** 一个插件内嵌技能的定义；`invocation` 固定为只有用户能调用。 */
export interface WorkflowSkillDefinition {
  readonly name: string
  readonly description: string
  readonly content: string
  /** 运行时技能来源；DSH 加载定义时要求它是字符串。 */
  readonly source: 'runtime'
  readonly invocation: {
    readonly modelInvocable: false
    readonly userInvocable: true
  }
}

interface IntakeCopy {
  /** 命令在做什么；第一段正文。 */
  readonly intro: string
  /** 建票缺了就要追问的硬信息。 */
  readonly hardInfo: string
  /** 票正文的小节标题。 */
  readonly sections: readonly string[]
}

const INTAKE_COPY: Record<IntakeKind, IntakeCopy> = {
  bug: {
    intro: '你在把用户报的缺陷写进当前仓库的工单池。这一步只建票，不定性、不处理。',
    hardInfo: '现象、复现步骤、预期行为',
    sections: ['发生了什么', '预期', '复现步骤', '补充信息'],
  },
  feature: {
    intro: '你在把用户说的需求写进当前仓库的工单池。这一步只建票，不访谈、不写规格。',
    hardInfo: '问题、期望结果',
    sections: ['问题', '期望结果', '背景'],
  },
}

/**
 * 生成两个入池命令的定义。
 * @param labels - 跟踪器的标签名；测试可注入别的映射。
 * @returns 缺陷与需求两个命令，顺序固定。
 */
export function createWorkflowSkills(
  labels: TrackerLabelNames = TRACKER_LABELS,
): readonly WorkflowSkillDefinition[] {
  return [
    createWorkflowSkill(INTAKE_COMMANDS.bug, labels),
    createWorkflowSkill(INTAKE_COMMANDS.feature, labels),
  ]
}

/**
 * 把两个入池命令注册进 DSH 技能服务，并在插件销毁时撤销。
 * 服务缺失或单个注册失败只记日志，不影响面板的其他功能。
 * @param scope - 宿主上下文；skills 服务必须已就绪。
 * @param logger - 日志出口。
 * @param labels - 跟踪器的标签名。
 */
export function registerWorkflowCommands(
  scope: DshContext,
  logger: DshLogger,
  labels: TrackerLabelNames = TRACKER_LABELS,
): void {
  const registry = readSkillRegistry(scope.get('skills'))
  if (registry === undefined) {
    logger.warn('%s', 'skills 服务不可用，入池命令未注册。')
    return
  }

  scope.effect(() => {
    const disposers = registerWorkflowSkills(registry, logger, labels)
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'dsh-mattpocock-workflow: 入池命令')
}

/**
 * 逐个注册内嵌技能；单个失败不影响另一个。
 * @param registry - DSH 技能注册表。
 * @param logger - 日志出口。
 * @param labels - 跟踪器的标签名。
 * @returns 每个成功注册的撤销函数。
 */
export function registerWorkflowSkills(
  registry: SkillRegistryLike,
  logger: DshLogger,
  labels: TrackerLabelNames = TRACKER_LABELS,
): readonly (() => void)[] {
  const disposers: (() => void)[] = []
  for (const skill of createWorkflowSkills(labels)) {
    try {
      disposers.push(registry.register(skill))
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      logger.error('%s %s', `${skill.name} 注册失败：`, reason)
    }
  }
  return disposers
}

function createWorkflowSkill(
  intake: IntakeCommandDefinition,
  labels: TrackerLabelNames,
): WorkflowSkillDefinition {
  const command = FLOW_COMMANDS[intake.command]
  return {
    name: command.name,
    description: `${command.summary}；只入池，不处理。`,
    content: intakeContent(intake, labels),
    source: 'runtime',
    invocation: { modelInvocable: false, userInvocable: true },
  }
}

function intakeContent(intake: IntakeCommandDefinition, labels: TrackerLabelNames): string {
  const copy = INTAKE_COPY[intake.kind]
  const labelList = intake.labelRoles.map((role) => labels[role]).join('、')

  return [
    copy.intro,
    '',
    '## 先读',
    '- 仓库里的领域术语表，用项目自己的词写标题和正文。',
    '- 仓库里由 setup 技能生成的 issue 跟踪方式与 triage 标签映射文档，确认这次用哪个跟踪器、怎么建票、标签怎么写。',
    '',
    '## 边界',
    '- 不翻代码、不复现、不定位根因；不自行拆票、不建父票、不声明阻塞关系。',
    '- 用户明确说了拆成多张、或者合成一张时，就直接照做。',
    '- 用户给的槽位只是引导。没填的槽位视为缺信息，不要把槽位原文或空标题写进票里。',
    `- 缺硬信息（${copy.hardInfo}）时，你自己判断要不要追问：够用就直接建票，不够就先问，最多问两三个问题。`,
    '- 建票前先查一遍跟踪器里疑似重复的开放票；查到就停下来，把候选票给用户确认。',
    '- 用户一次说了几件事、又没讲清要拆还是合时，先问用户。',
    '- 标题和正文跟随仓库里已有工单的语言惯例。',
    '',
    '## 图片',
    '- 用户贴的图能证明问题时，上传进票。',
    '- 与票无关、或者能直接转写成文字的图，不要放进票。',
    '- 图里可能含本机路径、账号、token 或私有数据时，先问用户要不要传。',
    '- 当前跟踪器传不了图片时，用文字描述图片内容，并提醒用户手动补图。',
    '',
    '## 建票',
    '- 标题用一句话说清是什么。',
    '- 正文按下面的结构组织；没有内容的小节整节删掉：',
    ...copy.sections.map((section, index) => `  ${String(index + 1)}. ${section}`),
    '- 不写文件路径和行号。',
    `- 打上这些标签：${labelList}。`,
    '- 按上面读到的跟踪方式建票。',
    '',
    '## 建完之后',
    '- 只输出票的链接和一行下一步建议，然后停下，不要开始处理。',
    '- 建议写成 `/<命令> <票的引用> —— <一句理由>`；远端后端用 #N，本地 Markdown 用文件路径。',
    '- 只从下面的候选里选一个推荐，最多再给一个备选：',
    ...intake.nextSteps.map(nextStepLine),
  ].join('\n')
}

function nextStepLine(id: IntakeCommandDefinition['nextSteps'][number]): string {
  const step = NEXT_STEPS[id]
  const name = FLOW_COMMANDS[step.command].name
  const reminder = step.reminder === null ? '' : `（${step.reminder}）`
  return `- /${name} <票的引用> —— ${step.when}${reminder}`
}
