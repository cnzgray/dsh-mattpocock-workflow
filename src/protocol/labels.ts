/**
 * 工单标签名。对应 `docs/agents/triage-labels.md` 里的映射：
 * 状态标签决定一张票能不能接，分类标签每张票恰好带一个。
 *
 * 这些字符串同时被宿主和界面读取；判定规则本身在 core 里，不在这里。
 */
export const TRACKER_LABELS = {
  /** 规格完整、可以直接交给 agent 的票。 */
  readyForAgent: 'ready-for-agent',
  /** 缺陷分类。 */
  bug: 'bug',
  /** 需求分类。 */
  enhancement: 'enhancement',
} as const satisfies TrackerLabelNames

/** 标签名的形状，供需要按名查找标签的调用方约束参数。 */
export interface TrackerLabelNames {
  readonly readyForAgent: string
  readonly bug: string
  readonly enhancement: string
}
