/**
 * 创建人头像：有可用地址时显示远端图片，缺失或加载失败时降级成登录名首字母色块。
 * 色块颜色只由登录名决定，同一个用户在任意工作区、任意后端都是同一个颜色。
 */
import * as React from 'react'

import type { TicketAuthor } from '../protocol/tracker.ts'
import { authorName, authorTitle } from './author-text.ts'
import { AVATAR_COLORS, AVATAR_FALLBACK_STYLE, AVATAR_STYLE } from './ticket-row-styles.ts'

/** 头像组件依赖。 */
export interface TicketAvatarProps {
  readonly author: TicketAuthor
}

/**
 * 渲染创建人头像。
 * @param props - 创建人。
 * @returns 圆形头像图片或首字母色块。
 */
export function TicketAvatar(props: TicketAvatarProps): React.ReactElement {
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null)
  const { author } = props
  const label = `创建人：${authorName(author)}`
  const hint = authorTitle(author)
  const src = usableAvatarUrl(author.avatarUrl)

  if (src !== null && src !== failedSrc) {
    return (
      <img
        data-testid="ticket-avatar"
        src={src}
        alt={label}
        aria-label={label}
        title={hint}
        style={AVATAR_STYLE}
        onError={() => {
          setFailedSrc(src)
        }}
      />
    )
  }

  return (
    <span
      data-testid="ticket-avatar"
      role="img"
      aria-label={label}
      title={hint}
      style={{
        ...AVATAR_STYLE,
        ...AVATAR_FALLBACK_STYLE,
        background: avatarColor(author.login),
      }}
    >
      {initialOf(author.login)}
    </span>
  )
}

/**
 * 只保留 http(s) 的绝对地址。工单数据是不可信内容，界面不加载其它协议的地址；
 * 宿主已经做过一次同样的规范化，这里是第二道闸。
 */
function usableAvatarUrl(value: string | null): string | null {
  if (value === null) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function avatarColor(login: string): string {
  let hash = 0x811c9dc5
  for (const character of login) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ?? AVATAR_COLORS[0] ?? '#424a53'
}

function initialOf(login: string): string {
  const first = Array.from(login)[0]
  return first === undefined ? '?' : first.toUpperCase()
}
