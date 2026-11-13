/**
 * 工单后端共用契约用例。GitHub、GitLab、Gitea 与本地 Markdown 都跑这一组断言，
 * 只替换各自的工厂与录制输入。套件不规定依赖形状：命令型后端在自己的
 * 测试里注入假命令，Markdown 后端注入内存假文件。
 */
import { describe, expect, it } from 'vitest'

import type { BlockerTarget, Tracker } from '../core/ticket.ts'

/**
 * 后端的原生阻塞能力，必须由各后端显式声明：
 * - `snapshot`：阻塞数在 `fetchSnapshot` 内取回；
 * - `deferred`：列表返回后通过 `resolveBlockers` 补齐；
 * - `none`：只用描述里的 `Blocked by:` 回退。
 */
export type NativeBlockersFixture =
  | { readonly kind: 'snapshot'; readonly expected: readonly number[] }
  | {
      readonly kind: 'deferred'
      readonly request: readonly BlockerTarget[]
      readonly expected: ReadonlyMap<string, number>
    }
  | { readonly kind: 'none'; readonly expected: readonly number[] }

/** 一个后端跑契约所需的工厂与期望值。 */
export interface TrackerContractFixture {
  /** 各后端在自己的测试里绑定依赖；套件只拿一个无参工厂。 */
  readonly createTracker: () => Tracker
  readonly workspaceRoot: string
  readonly expected: {
    readonly repository: string
    readonly total: number
    readonly refs: readonly string[]
    readonly fetchedAt: number
  }
  /** 空仓库：各后端用自己的空输入，验证零计数不会变成错误。 */
  readonly empty: {
    readonly createTracker: () => Tracker
    readonly repository: string
    readonly fetchedAt: number
  }
  /**
   * 原生阻塞能力的显式声明。每个后端都必须填写，
   * 避免新增后端时悄悄漏掉阻塞能力。
   */
  readonly nativeBlockers: NativeBlockersFixture
}

/**
 * 注册一组后端无关的契约断言。
 * @param backend - 后端名称，用于测试标题。
 * @param fixture - 工厂与期望输出。
 */
export function describeTrackerContract(backend: string, fixture: TrackerContractFixture): void {
  describe(`${backend} 工单后端契约`, () => {
    it('返回仓库标识、总数与按输入顺序排列的工单', async () => {
      const snapshot = await fixture.createTracker().fetchSnapshot(fixture.workspaceRoot)

      expect(snapshot.repository).toBe(fixture.expected.repository)
      expect(snapshot.total).toBe(fixture.expected.total)
      expect(snapshot.loaded).toBe(snapshot.tickets.length)
      expect(snapshot.tickets.map((ticket) => ticket.ref)).toEqual(fixture.expected.refs)
    })

    it('使用注入的时钟作为快照时间', async () => {
      const snapshot = await fixture.createTracker().fetchSnapshot(fixture.workspaceRoot)

      expect(snapshot.fetchedAt).toBe(fixture.expected.fetchedAt)
    })

    it('空仓库返回空列表与零计数', async () => {
      const snapshot = await fixture.empty.createTracker().fetchSnapshot(fixture.workspaceRoot)

      expect(snapshot.tickets).toEqual([])
      expect(snapshot.loaded).toBe(0)
      expect(snapshot.total).toBe(0)
      expect(snapshot.repository).toBe(fixture.empty.repository)
      expect(snapshot.fetchedAt).toBe(fixture.empty.fetchedAt)
    })

    it('按声明提供原生阻塞数', async () => {
      const tracker = fixture.createTracker()
      const nativeBlockers = fixture.nativeBlockers

      if (nativeBlockers.kind === 'snapshot') {
        expect(tracker.resolveBlockers).toBeUndefined()
        const snapshot = await tracker.fetchSnapshot(fixture.workspaceRoot)
        expect(snapshot.tickets.map((ticket) => ticket.openBlockers)).toEqual(
          nativeBlockers.expected,
        )
        return
      }

      if (nativeBlockers.kind === 'deferred') {
        expect(typeof tracker.resolveBlockers).toBe('function')
        const native = await tracker.resolveBlockers?.(
          fixture.workspaceRoot,
          nativeBlockers.request,
        )
        expect(native).toEqual(nativeBlockers.expected)
        return
      }

      expect(tracker.resolveBlockers).toBeUndefined()
      const snapshot = await tracker.fetchSnapshot(fixture.workspaceRoot)
      expect(snapshot.tickets.map((ticket) => ticket.openBlockers)).toEqual(nativeBlockers.expected)
    })
    it('每张票都带 ref 与判定所需的字段', async () => {
      const snapshot = await fixture.createTracker().fetchSnapshot(fixture.workspaceRoot)

      for (const ticket of snapshot.tickets) {
        expect(ticket.ref.length).toBeGreaterThan(0)
        expect(ticket.number === null || ticket.number > 0).toBe(true)
        expect(ticket.title.length).toBeGreaterThan(0)
        expect(['open', 'closed']).toContain(ticket.state)
        expect(Array.isArray(ticket.labels)).toBe(true)
        expect(ticket.openBlockers).toBeGreaterThanOrEqual(0)
      }
    })
  })
}
