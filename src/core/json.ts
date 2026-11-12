/**
 * 解析外部 JSON 时的共用守卫。这里只证明“是一个普通对象”，
 * 字段形状由调用方继续收窄，避免各 adapter 各写一份。
 */

/**
 * 判断值是否为非数组对象。
 * @param value - 任意 JSON 值。
 * @returns 是普通对象时为 true。
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
