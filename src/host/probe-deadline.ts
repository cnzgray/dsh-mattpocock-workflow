/**
 * 环境检查的探测超时。一个探测最多等这么久，超时按失败处理，
 * 检查不会因为某个命令卡住而一直转圈。
 */
import type { TimerLike } from './dsh-types.ts'

/** 单个探测的最长等待时间。 */
export const ENV_PROBE_TIMEOUT_MS = 10_000

/** 探测结果：按时完成，或超时。 */
export type ProbeDeadlineResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false }

/** 给一个进行中的探测套上超时。 */
export type ProbeDeadline = <T>(task: Promise<T>) => Promise<ProbeDeadlineResult<T>>

/**
 * 用 DSH 的计时服务创建超时包装。
 * @param timer - DSH 计时服务。
 * @param timeoutMs - 超时时间。
 * @returns 超时包装函数；任务自身的失败原样抛出。
 */
export function createProbeDeadline(timer: TimerLike, timeoutMs: number): ProbeDeadline {
  return <T>(task: Promise<T>): Promise<ProbeDeadlineResult<T>> => {
    const { promise, resolve, reject } = Promise.withResolvers<ProbeDeadlineResult<T>>()
    let settled = false
    const dispose = timer.timeout(() => {
      if (settled) return
      settled = true
      resolve({ ok: false })
    }, timeoutMs)

    task.then(
      (value) => {
        if (settled) return
        settled = true
        dispose()
        resolve({ ok: true, value })
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        dispose()
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
    return promise
  }
}
