/**
 * 宿主侧日志出口。快照服务和环境检查服务都用同一个形状；
 * 写日志失败由实现兜底，不能影响 RPC 响应。
 */
import type { LogEvent } from '../protocol/log-events.ts'

/** 记录一条结构化日志。 */
export type LogSink = (
  level: 'info' | 'warn' | 'error',
  event: LogEvent,
  fields: Readonly<Record<string, unknown>>,
) => void
