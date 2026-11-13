/**
 * 面板里的相对时间文案。面板头部的快照时间与工单行的创建时间共用这一份说法，
 * 避免两处文案漂移。
 */

/**
 * 把时间点格式化成“多久之前”。
 * @param value - 毫秒时间戳或可被 `Date.parse` 解析的时间字符串。
 * @param now - 当前时间（毫秒）。
 * @returns 刚刚 / N 分钟前 / N 小时前 / N 天前；无法解析时为空字符串。
 */
export function formatRelativeTime(value: number | string, now: number): string {
  const timestamp = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(timestamp)) return ''

  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (seconds < 60) return '刚刚'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${String(minutes)} 分钟前`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${String(hours)} 小时前`

  return `${String(Math.floor(hours / 24))} 天前`
}
