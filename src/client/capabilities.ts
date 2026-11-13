/**
 * 界面侧的能力诊断：插件在浏览器里用到的 DSH 服务和扩展点是否可用。
 * 结果按 protocol 的固定顺序输出，由环境检查视图和宿主返回的宿主服务合并显示。
 */
import {
  UI_CAPABILITY_IDS,
  type CapabilityDiagnostic,
  type UiCapabilityId,
} from '../protocol/env-check.ts'

/** 界面能力的记录器；服务就绪或失效时更新。 */
export interface ClientCapabilities {
  mark(id: UiCapabilityId, present: boolean): void
  readonly read: () => readonly CapabilityDiagnostic[]
}

/**
 * 创建界面能力记录器。
 * @returns 初始全部缺失的记录器。
 */
export function createClientCapabilities(): ClientCapabilities {
  const present = new Set<UiCapabilityId>()

  return {
    mark(id, available) {
      if (available) present.add(id)
      else present.delete(id)
    },
    read: () =>
      UI_CAPABILITY_IDS.map((id) => ({
        id,
        category: 'ui-extension' as const,
        status: present.has(id) ? ('present' as const) : ('missing' as const),
      })),
  }
}
