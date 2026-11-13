/**
 * 测试用的最小指标载荷。生产代码不导入这个文件；各层测试按需覆盖字段，
 * 避免每个快照夹具都手写一遍完整指标。
 */
import type { PressureDimensionReport, SnapshotMetrics } from './tracker.ts'

function dimension(dimensionName: PressureDimensionReport['dimension']): PressureDimensionReport {
  return {
    dimension: dimensionName,
    tier: 'light',
    signals: [],
    triggers: [],
    gaps: [],
    provisional: false,
  }
}

/**
 * 构造一个全零、全轻松的指标载荷。
 * @param overrides - 需要改写的顶层字段。
 * @returns 指标载荷。
 */
export function emptyMetrics(overrides: Partial<SnapshotMetrics> = {}): SnapshotMetrics {
  return {
    openBacklog: 0,
    readyCapacity: 0,
    blockedRatio: 0,
    needsTriage: 0,
    stalled: 0,
    staleCount: { value: 0, gap: null },
    staleRatio: { value: 0, gap: null },
    oldestUpdateDays: { value: 0, gap: null },
    longestBlockerChain: { value: 0, gap: null },
    openedLast30Days: { value: 0, gap: null },
    closedLast30Days: { value: 0, gap: null },
    netFlow: { value: 0, gap: null },
    coverage: { loaded: 0, total: 0, truncated: false },
    pressure: {
      tier: 'light',
      dimensions: [dimension('scale'), dimension('blocking'), dimension('freshness')],
    },
    attention: [],
    ...overrides,
  }
}
