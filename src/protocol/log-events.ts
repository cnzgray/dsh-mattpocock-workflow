/**
 * 日志事件名。所有事件名集中在这里，写错名字编译就会报错。
 *
 * 事件只记耗时、后端类型和结果，不记命令行输出：`gh` / `glab` 的输出来自远端，
 * 可能带凭据或私密内容。
 */
export const LOG_EVENTS = {
  /** 一次工单拉取或阻塞补齐；`stage` 区分列表与补齐两段耗时。 */
  snapshot: 'tracker.snapshot',
  /** 一次工单详情读取或变更提交。 */
  ticket: 'tracker.ticket',
  /** 一次环境检查。 */
  envCheck: 'env.check',
} as const

/** 日志事件名的联合类型。 */
export type LogEvent = (typeof LOG_EVENTS)[keyof typeof LOG_EVENTS]

/** 快照日志的阶段。列表与补齐分别计时，字段名沿用同一个事件。 */
export const SNAPSHOT_STAGES = {
  list: 'list',
  blockers: 'blockers',
} as const

/** 工单日志的动作：读详情或提交变更。 */
export const TICKET_ACTIONS = {
  get: 'get',
  update: 'update',
  options: 'options',
  delete: 'delete',
  attachment: 'attachment',
} as const
