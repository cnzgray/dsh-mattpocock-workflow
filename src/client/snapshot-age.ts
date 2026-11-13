/**
 * 快照时间的显示。列表与概览都用同一套“多久之前”的文案与刷新节奏。
 */
import * as React from 'react'

const AGE_TICK_MS = 30_000

/**
 * 按固定节奏重算当前时间，让“几分钟前”自己往前走。
 * @param clock - 取当前时间的函数，测试注入固定时钟。
 * @returns 当前的毫秒时间戳。
 */
export function useNow(clock: () => number): number {
  const [now, setNow] = React.useState(() => clock())

  React.useEffect(() => {
    const id = setInterval(() => {
      setNow(clock())
    }, AGE_TICK_MS)
    return () => {
      clearInterval(id)
    }
  }, [clock])

  return now
}

/**
 * 把快照时间格式化成中文的相对时间。
 * @param fetchedAt - 快照生成时间（毫秒）。
 * @param now - 当前时间（毫秒）。
 * @returns “刚刚”“3 分钟前”等文案。
 */
export function formatAge(fetchedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - fetchedAt) / 1000))
  if (seconds < 60) return '刚刚'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${String(minutes)} 分钟前`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)} 小时前`

  return `${String(Math.floor(hours / 24))} 天前`
}
