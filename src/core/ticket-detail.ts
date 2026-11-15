/**
 * 工单详情与变更补丁的纯逻辑：目标集合到增删差异的换算，以及详情字段的共用校验。
 *
 * 补丁只表达「期望的最终状态」，各后端 CLI 的增量 / 整体替换 / 带前缀增删语义
 * 由适配器按这里算出的差异落地。core 不做 IO。
 */
import type { TicketComment, TicketReference } from './ticket.ts'
import { isRecord } from './json.ts'
import { TrackerError } from './tracker-error.ts'

/** 一次集合变更的增删差异，保持输入顺序。 */
export interface SetDiff {
  readonly add: readonly string[]
  readonly remove: readonly string[]
}

/**
 * 把目标集合与当前集合算成增删差异。
 * @param current - 当前集合，顺序决定 remove 的顺序。
 * @param target - 期望集合，顺序决定 add 的顺序。
 * @returns 需要新增与需要移除的项。
 */
export function diffSets(current: readonly string[], target: readonly string[]): SetDiff {
  const currentSet = new Set(current)
  const targetSet = new Set(target)

  return {
    add: target.filter((value) => !currentSet.has(value)),
    remove: current.filter((value) => !targetSet.has(value)),
  }
}

/**
 * 按补丁算出要写入的目标集合：补丁没给这一项时沿用当前值，
 * `self` 给出时并入集合末尾（已存在则不重复）。
 * @param current - 当前集合。
 * @param requested - 补丁里的目标集合；undefined 表示不改。
 * @param self - 已解析出的当前用户名；null 表示不并入。
 * @returns 目标集合。
 */
export function resolveTargetSet(
  current: readonly string[],
  requested: readonly string[] | undefined,
  self: string | null = null,
): readonly string[] {
  const target = requested === undefined ? [...current] : [...requested]
  if (self !== null && !target.includes(self)) target.push(self)
  return target
}

/**
 * 按补丁规划一项集合变更。
 * @param current - 当前集合。
 * @param requested - 补丁里的目标集合；undefined 表示不改。
 * @param self - 已解析出的当前用户名；null 表示不并入。
 * @returns 增删差异。
 */
export function planSetChange(
  current: readonly string[],
  requested: readonly string[] | undefined,
  self: string | null = null,
): SetDiff {
  return diffSets(current, resolveTargetSet(current, requested, self))
}

/** 集合差异是否为空；为空时适配器不必发命令。 */
export function isEmptyDiff(diff: SetDiff): boolean {
  return diff.add.length === 0 && diff.remove.length === 0
}

/**
 * 标签颜色统一成小写 `#rrggbb`。GitHub / Gitea 返回的颜色不带 `#`，
 * GitLab 带 `#`，三种后端在这里收敛成同一种写法。
 * @param value - 后端返回的颜色。
 * @returns 合法颜色；缺失或不是六位十六进制时为 null。
 */
export function normalizeLabelColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const hex = value.trim().replace(/^#/, '')
  return /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex.toLowerCase()}` : null
}

/**
 * 按 key 去重，保留首次出现的顺序。工单后端可能返回重复的标签或成员，
 * 补全候选按名字收敛成一项。
 * @param items - 原始列表。
 * @param key - 去重键。
 * @returns 去重后的新数组。
 */
export function dedupeBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  const unique: T[] = []
  for (const item of items) {
    const value = key(item)
    if (seen.has(value)) continue
    seen.add(value)
    unique.push(item)
  }
  return unique
}

/**
 * 详情字段校验：三个远端后端的响应形状不同，但字段口径与报错文案一致，
 * 放在 core 里只实现一次。这里仍然没有 IO。
 */

/**
 * 可空字符串：缺失或空串都归一成 null。
 * @param value - 任意字段值。
 * @returns 非空字符串或 null。
 */
export function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * 工单网页地址：只收 http/https 绝对地址，其余（缺失、相对路径、别的协议）一律省略，
 * 界面拿到的链接总能直接打开或复制。
 * @param value - 后端返回的地址字段。
 * @returns 规范化后的地址，或不可用时的 undefined。
 */
export function readWebUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

/**
 * 必填字符串。
 * @param value - 任意字段值。
 * @param field - 报错里的字段名。
 * @returns 原值。
 * @throws {TrackerError} 不是非空字符串。
 */
export function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw invalidDetail(`${field}不是非空字符串`)
  return value
}

/**
 * 标签集合：元素可以是字符串或带 `name` 的对象。
 * @param value - 任意字段值。
 * @returns 标签名，保持输入顺序；非法元素跳过。
 */
export function readNameList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (typeof entry === 'string' && entry.length > 0) return [entry]
    if (isRecord(entry)) {
      const name = readOptionalString(entry.name)
      if (name !== null) return [name]
    }
    return []
  })
}

/**
 * 用户集合：GitHub / Gitea 用 `login`，GitLab 用 `username`。
 * @param value - 任意字段值。
 * @param key - 用户名字段名。
 * @returns 用户名，保持输入顺序。
 */
export function readUserNames(value: unknown, key: 'login' | 'username'): readonly string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const name = readOptionalString(entry[key])
    return name === null ? [] : [name]
  })
}

/**
 * 详情读取必须有数字编号；本地 Markdown 不走这条路径。
 * @param reference - 工单引用。
 * @returns 数字编号。
 * @throws {TrackerError} 编号为 null。
 */
export function requireTicketNumber(reference: TicketReference): number {
  if (reference.number === null) {
    throw new TrackerError('ticket-not-found', '工单缺少数字编号，无法定位。')
  }
  return reference.number
}

/**
 * 详情输出格式不正确的统一错误。
 * @param message - 具体哪个字段不合法。
 * @returns 带 `fetch-failed` 的 `TrackerError`。
 */
export function invalidDetail(message: string): TrackerError {
  return new TrackerError('fetch-failed', `工单详情格式不正确：${message}`)
}

/**
 * 评论按创建时间升序；本地评论没有时间时保持原顺序。
 * @param comments - 解析出的评论。
 * @returns 新数组。
 */
export function sortCommentsByTime(comments: readonly TicketComment[]): readonly TicketComment[] {
  return [...comments].sort((left, right) =>
    (left.createdAt ?? '') < (right.createdAt ?? '')
      ? -1
      : (left.createdAt ?? '') > (right.createdAt ?? '')
        ? 1
        : 0,
  )
}
