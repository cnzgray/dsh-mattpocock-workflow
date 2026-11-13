/**
 * 工单创建人的解析规则。各后端返回的用户对象字段名不同，取值与降级规则只在这里实现一次：
 * 缺字段、类型不对、登录名为空时整体按 null 处理，元信息缺失不能让整张列表加载失败。
 */
import { isRecord } from './json.ts'
import type { TicketAuthor } from './ticket.ts'

/** 各后端用户对象里的字段名。 */
export interface AuthorFields {
  /** 登录名字段。 */
  readonly login: string
  /** 展示名字段。 */
  readonly displayName: string
  /** 头像地址字段。 */
  readonly avatarUrl: string
}

/**
 * 从后端返回的用户对象里读创建人。
 * @param value - 后端返回的用户对象。
 * @param fields - 该后端使用的字段名。
 * @param avatarBaseUrl - 头像地址是实例内相对路径时用来补全的基准地址。
 * @returns 创建人，或无法识别时的 null。
 */
export function readAuthor(
  value: unknown,
  fields: AuthorFields,
  avatarBaseUrl?: string,
): TicketAuthor | null {
  if (!isRecord(value)) return null

  const login = readText(value[fields.login])
  if (login === null) return null

  return {
    login,
    displayName: readText(value[fields.displayName]),
    avatarUrl: normalizeAvatarUrl(value[fields.avatarUrl], avatarBaseUrl),
  }
}

/**
 * 把头像地址规范成可加载的绝对地址：只保留 `http` / `https`。
 * 相对路径按基准地址补全；补不出来（没有基准地址、不是合法 URL、非 http 协议）时为 null，
 * 由界面回退成首字母色块。
 * @param value - 后端返回的头像地址。
 * @param baseUrl - 相对路径的基准地址，例如 `https://gitea.example.com`。
 * @returns 绝对地址，或不可用时的 null。
 */
export function normalizeAvatarUrl(value: unknown, baseUrl?: string): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null

  let url: URL
  try {
    url = baseUrl === undefined ? new URL(trimmed) : new URL(trimmed, baseUrl)
  } catch {
    return null
  }

  return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
}

function readText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text.length === 0 ? null : text
}
