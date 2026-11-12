/**
 * 工单后端共用契约用例。MVP 阶段只有 GitHub 后端接入，后续的 markdown、
 * gitlab 后端用同一组断言，只替换自己的 fixture。
 */
import { describe, expect, it } from 'vitest'

import type { CommandRunner, Tracker } from '../core/ticket.ts'

/** 一个后端跑契约所需的依赖与期望值。 */
export interface TrackerContractFixture {
  readonly runner: CommandRunner
  readonly now: () => number
  readonly workspaceRoot: string
  readonly expected: {
    readonly repository: string
    readonly total: number
    readonly numbers: readonly number[]
  }
}

/** 后端工厂：注入命令执行器与时钟。 */
export type TrackerFactory = (deps: {
  readonly run: CommandRunner
  readonly now: () => number
}) => Tracker

/**
 * 注册一组后端无关的契约断言。
 * @param backend - 后端名称，用于测试标题。
 * @param createTracker - 被测后端工厂。
 * @param fixture - 该后端的录制输入与期望输出。
 */
export function describeTrackerContract(
  backend: string,
  createTracker: TrackerFactory,
  fixture: TrackerContractFixture,
): void {
  describe(`${backend} 工单后端契约`, () => {
    it('返回仓库标识、总数与按输入顺序排列的工单', async () => {
      const tracker = createTracker({ run: fixture.runner, now: fixture.now })
      const snapshot = await tracker.fetchSnapshot(fixture.workspaceRoot)

      expect(snapshot.repository).toBe(fixture.expected.repository)
      expect(snapshot.total).toBe(fixture.expected.total)
      expect(snapshot.loaded).toBe(snapshot.tickets.length)
      expect(snapshot.tickets.map((ticket) => ticket.number)).toEqual(fixture.expected.numbers)
    })

    it('使用注入的时钟作为快照时间', async () => {
      const tracker = createTracker({ run: fixture.runner, now: fixture.now })
      const snapshot = await tracker.fetchSnapshot(fixture.workspaceRoot)

      expect(snapshot.fetchedAt).toBe(fixture.now())
    })

    it('每张票都带判定所需的字段', async () => {
      const tracker = createTracker({ run: fixture.runner, now: fixture.now })
      const snapshot = await tracker.fetchSnapshot(fixture.workspaceRoot)

      for (const ticket of snapshot.tickets) {
        expect(ticket.number).toBeGreaterThan(0)
        expect(ticket.title.length).toBeGreaterThan(0)
        expect(['open', 'closed']).toContain(ticket.state)
        expect(Array.isArray(ticket.labels)).toBe(true)
        expect(ticket.openBlockers).toBeGreaterThanOrEqual(0)
      }
    })
  })
}
