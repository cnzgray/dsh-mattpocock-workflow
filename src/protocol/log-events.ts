/**
 * 日志事件名。所有事件名集中在这里，写错名字编译就会报错。
 *
 * 事件只记耗时、后端类型和结果，不记命令行输出：`gh` / `glab` 的输出来自远端，
 * 可能带凭据或私密内容。
 */
export const LOG_EVENTS = {
  /** 一次工单拉取（缓存未命中或强制刷新）。 */
  snapshot: 'tracker.snapshot',
} as const

/** 日志事件名的联合类型。 */
export type LogEvent = (typeof LOG_EVENTS)[keyof typeof LOG_EVENTS]
