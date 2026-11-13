/**
 * 详情视图里的小视觉部件：用户头像（首字母圆片）与按仓库颜色着色的标签样式。
 *
 * 颜色都和宿主的文字色混合，深浅两种主题下都可读：头像色相由用户名稳定地算出，
 * 同一个人在正文和评论里颜色一致；标签用仓库给的颜色做浅底、描边和文字。
 */
import type { CSSProperties } from 'react'
import * as React from 'react'

import { COLORS } from './task-panel-styles.ts'

/** 用户头像：用户名首字母放在按用户名着色的圆片里；没有用户名时显示中性圆片。 */
export function Avatar(props: {
  readonly name: string | null
  readonly size?: number
}): React.ReactElement {
  const size = props.size ?? 20
  const tint = props.name === null ? COLORS.tertiary : `hsl(${String(hue(props.name))} 55% 48%)`

  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 'none',
        width: size,
        height: size,
        borderRadius: '50%',
        background: `color-mix(in srgb, ${tint} 18%, transparent)`,
        color: `color-mix(in srgb, ${tint} 75%, ${COLORS.text})`,
        fontSize: Math.round(size * 0.5),
        fontWeight: 600,
        lineHeight: 1,
        userSelect: 'none',
      }}
    >
      {initial(props.name)}
    </span>
  )
}

/**
 * 标签小块的着色：仓库颜色做 18% 浅底、50% 描边，文字按颜色亮度和宿主文字色混合；
 * 没有颜色（尚未读到候选、或后端不给颜色）时退回中性描边。
 * @param color - `#rrggbb` 颜色或 null。
 * @returns 叠加到小块基础样式上的颜色属性。
 */
export function labelColorStyle(color: string | null): CSSProperties {
  if (color === null) return {}
  // 浅色标签（如 #a2eeef）直接混一半会和白底贴在一起：越亮的颜色，文字越偏向宿主文字色。
  const share = textShare(color)
  return {
    background: `color-mix(in srgb, ${color} 18%, transparent)`,
    borderColor: `color-mix(in srgb, ${color} 50%, transparent)`,
    color: `color-mix(in srgb, ${color} ${String(share)}%, ${COLORS.text})`,
  }
}

/** 标签颜色在文字色里的占比：按相对亮度分三档。 */
function textShare(color: string): number {
  const luminance = relativeLuminance(color)
  if (luminance === null) return 55
  if (luminance > 0.6) return 25
  if (luminance > 0.3) return 45
  return 65
}

/** `#rrggbb` 的相对亮度（WCAG 定义）；格式不对时为 null。 */
function relativeLuminance(color: string): number | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color)
  if (match === null) return null
  const [r, g, b] = [match[1], match[2], match[3]].map((hex) => {
    const channel = Number.parseInt(hex ?? '0', 16) / 255
    return channel <= 0.040_45 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}

function initial(name: string | null): string {
  if (name === null) return '?'
  // 按字素取首字：emoji 与组合字符不会被拆成半个。
  const first = new Intl.Segmenter().segment(name.trim())[Symbol.iterator]().next()
  return first.done === true ? '?' : first.value.segment.toUpperCase()
}

/** 用户名到色相：简单的字符串散列，只求稳定，不求均匀。 */
function hue(name: string): number {
  let hash = 0
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 360
  return hash
}
