/**
 * 工单标签名。对应 `docs/agents/triage-labels.md` 里的映射：
 * 状态标签决定一张票能不能接，分类标签每张票恰好带一个。
 *
 * 这些字符串同时被宿主和界面读取；判定规则本身在 core 里，不在这里。
 */
export const TRACKER_LABELS = {
  /** 规格完整、可以直接交给 agent 的票。 */
  readyForAgent: 'ready-for-agent',
  /** 还没定性，需要维护者先评估。 */
  needsTriage: 'needs-triage',
  /** 还在等报告人补信息。 */
  needsInfo: 'needs-info',
  /** 需要人工实现，不交给 agent。 */
  readyForHuman: 'ready-for-human',
  /** 已经决定不做。 */
  wontfix: 'wontfix',
  /** 缺陷分类。 */
  bug: 'bug',
  /** 需求分类。 */
  enhancement: 'enhancement',
} as const satisfies TrackerLabelNames

/** 标签名的形状，供需要按名查找标签的调用方约束参数。 */
export interface TrackerLabelNames {
  readonly readyForAgent: string
  readonly needsTriage: string
  readonly needsInfo: string
  readonly readyForHuman: string
  readonly wontfix: string
  readonly bug: string
  readonly enhancement: string
}

/** 由工单标签推导出的技能动作；`none` 表示不提供注入入口。 */
export const TICKET_SKILL_ACTIONS = ['implement', 'diagnose', 'triage', 'none'] as const

/** 技能动作的联合类型。 */
export type TicketSkillAction = (typeof TICKET_SKILL_ACTIONS)[number]

/** 可以注入提示词的技能动作（排除 `none`）。 */
export type InjectableSkillAction = Exclude<TicketSkillAction, 'none'>

/**
 * 技能动作的判定依据。界面按它渲染原因徽标与悬停说明：
 * 前四项是不可开工的原因，其余是选中该技能的理由。
 */
export const TICKET_ACTION_REASONS = [
  'closed',
  'blocked',
  'wontfix',
  'ready-for-human',
  'needs-triage',
  'needs-info',
  'bug',
  'ready-for-agent',
  'untriaged',
] as const

/** 判定依据的联合类型。 */
export type TicketActionReason = (typeof TICKET_ACTION_REASONS)[number]
