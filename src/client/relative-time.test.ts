import { describe, expect, it } from 'vitest'

import { builtinZhTranslate } from './i18n-runtime.ts'
import { formatRelativeTime as formatRelativeTimeWithT } from './relative-time.ts'

const NOW = Date.parse('2026-11-12T15:00:00Z')
const formatRelativeTime = (value: number | string, now: number) =>
  formatRelativeTimeWithT(value, now, builtinZhTranslate)

describe('相对时间文案', () => {
  it.each([
    [NOW - 15_000, '刚刚'],
    [NOW - 59_000, '刚刚'],
    [NOW - 60_000, '1 分钟前'],
    [NOW - 59 * 60_000, '59 分钟前'],
    [NOW - 60 * 60_000, '1 小时前'],
    [NOW - 23 * 60 * 60_000, '23 小时前'],
    [NOW - 24 * 60 * 60_000, '1 天前'],
    [NOW - 3 * 24 * 60 * 60_000, '3 天前'],
  ])('%s 显示为 %s', (timestamp, text) => {
    expect(formatRelativeTime(timestamp, NOW)).toBe(text)
  })

  it('接受 ISO 时间字符串，和面板头部共用同一套说法', () => {
    expect(formatRelativeTime('2026-11-12T13:00:00Z', NOW)).toBe('2 小时前')
  })

  it('未来时间按刚刚处理，无法解析时为空字符串', () => {
    expect(formatRelativeTime(NOW + 60_000, NOW)).toBe('刚刚')
    expect(formatRelativeTime('不是时间', NOW)).toBe('')
  })
})
