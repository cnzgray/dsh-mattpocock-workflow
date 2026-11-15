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
