/**
 * 创建人的展示文本。行内用户名与头像 tooltip 共用这一份推导，
 * 避免同一行出现两套名字或两套悬停说明。
 */
import type { TicketAuthor } from '../protocol/tracker.ts'

/**
 * 行内显示的名字：有展示名时用展示名，否则退回登录名。
 * @param author - 创建人。
 * @returns 可展示的名字。
 */
export function authorName(author: TicketAuthor): string {
  return author.displayName ?? author.login
}

/**
 * 悬停时的完整信息：展示名加登录名；没有展示名时只给登录名。
 * @param author - 创建人。
 * @returns 悬停文案。
 */
export function authorTitle(author: TicketAuthor): string {
  return author.displayName === null
    ? `@${author.login}`
    : `${author.displayName}（@${author.login}）`
}
