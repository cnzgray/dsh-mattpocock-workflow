/**
 * 插件命令：入池两个，外加用户显式调用时才执行的关票判定。
 * 正文是给 agent 的指令——把用户的报告写成一张原始工单放进池里，然后停下；
 * 或核对一张票能否关闭。标签和候选下一步都从 protocol 的流程定义与标签映射读取，
 * 不手写命令名。技能本身只在内存里注册，不往用户的技能目录写文件。
 */
import {
  FLOW_COMMANDS,
  INTAKE_COMMANDS,
  NEXT_STEPS,
  type FlowCommand,
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
 * 生成插件自带的命令定义。
 * @param labels - 跟踪器的标签名；测试可注入别的映射。
 * @returns 缺陷、需求与关票三个命令，顺序固定。
 */
export function createWorkflowSkills(
  labels: TrackerLabelNames = TRACKER_LABELS,
): readonly WorkflowSkillDefinition[] {
  return [
    createWorkflowSkill(INTAKE_COMMANDS.bug, labels),
    createWorkflowSkill(INTAKE_COMMANDS.feature, labels),
    createCloseSkill(),
  ]
}

/**
 * 把插件命令注册进 DSH 技能服务，并在插件销毁时撤销。
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
    logger.warn('%s', 'skills 服务不可用，插件命令未注册。')
    return
  }

  scope.effect(() => {
    const disposers = registerWorkflowSkills(registry, logger, labels)
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'dsh-mattpocock-workflow: 插件命令')
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
  return pluginSkill(command, `${command.summary}；只入池，不处理。`, intakeContent(intake, labels))
}

function createCloseSkill(): WorkflowSkillDefinition {
  const command = FLOW_COMMANDS.close
  return pluginSkill(command, `${command.summary}；只在用户显式调用时动手。`, closeContent())
}

/** 插件自带技能的共同外壳：只有用户能调用，正文按命令各自生成。 */
function pluginSkill(
  command: FlowCommand,
  description: string,
  content: string,
): WorkflowSkillDefinition {
  return {
    name: command.name,
    description,
    content,
    source: 'runtime',
    invocation: { modelInvocable: false, userInvocable: true },
  }
}

function closeContent(): string {
  return [
    '你在判断一张工单能不能关闭。只有用户明确调用这个命令时才动手；没被要求关的票不要碰，也不要在实现或 PR 之后自动触发。',
    '',
    '## 先确认这张票',
    '- 把用户给的引用解析到当前工作区的后端与仓库：远端是 #N，本地 Markdown 是相对工作区的文件路径。',
    '- 引用不明确、解析不了，或指向别的仓库时，停下来问用户，不要猜。',
    '- 以远端或文件的当前状态为准，不依赖面板的本地快照。',
    '- 读工作区里由 setup 技能生成的 issue 跟踪方式文档，确认后端和关闭步骤；文档缺失或没写关闭步骤时，用「可以关闭时」列出的四条兜底。',
    '- 读这张票的标题、正文、标签、评论、被引用的 spec / 父票 / 子票，以及票之后的改动：commit、PR、合并状态、跑过的检查。',
    '',
    '## 关闭标准',
    '全部满足才可以关：',
    '- 票里写明的要求、验收点、被引用的 spec / ADR 都已满足；没有明写验收点时，以正文与评论里达成的要求为准。',
    '- 实现改动已经合并到默认分支；只有未合并的 PR 或本地未提交改动不算。本地 Markdown 按工作区约定已落地。',
    '- 评论里向报告人提出的问题都已回答，或已因工作完成而不再需要。',
    '- 没有未关闭的阻塞票（原生依赖或 `Blocked by:` 行）。',
    '- 父票还有未关闭的子票时不关。',
    '- 缺陷票：报告里的复现步骤在当前默认分支上不再复现，且按仓库惯例有回归测试。',
    '- 票仍是开放的；已经关闭就报告并停下，不重开。',
    '',
    '## 判断',
    '只认票里写下的要求和评论里给出的证据，逐条核对，只走三种结局之一。',
    '- 可以关闭：上面每一条都满足，且证据能在已合并的改动、跑过的检查或评论里找到。',
    '- 不可以关闭：还有没做完的验收点、没合并的改动、待回答的问题，或票里约定的下一步还没发生。',
    '- 判断不了：票本身没写清验收点、改动找不到，或评论与票的要求互相矛盾。',
    '不要用「时间过了很久」「看起来做了」当证据。',
    '',
    '## 可以关闭时',
    '- 先把判断依据写成一条评论，至少包含：一句话结论；票里每条要求 / 验收点与对应证据（commit / PR 链接、测试命令与结果）；实际跑过的检查。评论语言跟随票与仓库惯例；不写 token、本机绝对路径或私有数据，不贴大段 diff。',
    '- 再按跟踪文档的关闭步骤关票；文档缺失或没写关闭步骤时，按当前后端用下面一条：',
    '  - GitHub：`gh issue comment <编号> --body "..."`，然后 `gh issue close <编号>`；',
    '  - GitLab：`glab issue note <编号> --message "..."`，然后 `glab issue close <编号>`；',
    '  - Gitea：`tea comments <编号> "..."`，然后 `tea issues close <编号>`；',
    '  - 本地 Markdown：把同一条判断依据追加到 `## Comments` 下，再把 `## Comments` 之前的 `Status:` 行改成 `Status: resolved`。',
    '- 关闭命令失败时原样报告失败原因，不要说已经关闭。',
    '- 已经关闭的票只报告并停下，不重开，也不要重复评论。',
    '',
    '## 不可以关闭或判断不了时',
    '- 不动这张票：不评论、不改状态、不改标签、不关票。',
    '- 在会话里告诉用户还差什么：逐条列出没满足的验收点、没合并的改动、待回答的问题、未关闭的阻塞或子票，或缺失的信息与补法。',
    '- 给一行下一步建议：`/<命令> <票的引用> —— <一句理由>`，只指向真正适用的处理命令（实现、诊断、triage 或写规格）。',
    '',
    '## 边界',
    '- 只在用户显式调用时动手，不在实现或 PR 之后自动触发。',
    '- 一次只处理用户点名的一张票；给了多张就逐张确认，不批量关。',
    '- 不改 triage 状态标签，也不替 triage 决定票的去向；不建新票、不拆票、不改票的正文与标签。',
    '- 只做关闭判定和关票；结论写清楚，关票动作只在满足关闭标准时执行。',
  ].join('\n')
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
