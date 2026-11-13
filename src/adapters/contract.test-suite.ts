/**
 * 工单后端共用契约用例。GitHub、GitLab、Gitea 与本地 Markdown 都跑这一组断言，
 * 只替换各自的工厂与录制输入。套件不规定依赖形状：命令型后端在自己的
 * 测试里注入假命令，Markdown 后端注入内存假文件。
 */
import { describe, expect, it } from 'vitest'

import type {
  BlockerResolution,
  TicketDetail,
  TicketOptions,
  TicketPatch,
  TicketReference,
  TicketState,
  Tracker,
} from '../core/ticket.ts'

/** 后端实现详情能力时给出的读取请求与期望输出。 */
export interface TicketDetailFixture {
  /** 详情读取用的工厂；每次返回一份独立的可读后端。 */
  readonly createTracker: () => Tracker
  /** 读取哪张票。 */
  readonly request: TicketReference
  /** 期望的详情；`ref` 与 `number` 会按请求回填后整份比对。 */
  readonly expected: TicketDetail
  /**
   * 后端实现变更能力时给出工厂、补丁与期望结果；省略表示不实现。
   * 工厂每次返回一份可变的独立后端，变更不污染其他断言。
   */
  readonly change?: {
    readonly createTracker: () => Tracker
    readonly patch: TicketPatch
    readonly expected: {
      readonly labels?: readonly string[]
      readonly assignees?: readonly string[]
      readonly state: TicketState
    }
  }
}

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
      readonly request: readonly TicketReference[]
      readonly expected: BlockerResolution
    }
  | { readonly kind: 'none'; readonly expected: readonly number[] }
/** 后端实现补全候选能力时给出的工厂与期望输出。 */
export interface TicketOptionsFixture {
  readonly createTracker: () => Tracker
  readonly expected: TicketOptions
}

/** 后端实现删除能力时给出的工厂、目标票与权限期望。 */
export interface TicketDeleteFixture {
  readonly createTracker: () => Tracker
  readonly request: TicketReference
  /** `canDeleteTickets` 应返回的结果。 */
  readonly canDelete: boolean
}

/**
 * 后端的增量能力：实现增量，或显式声明不支持。
 *
 * 必须显式填写，避免某个后端悄悄退回全量而没人发现。
 */
export type TrackerChangesFixture =
  | {
      readonly createTracker: () => Tracker
      /** 增量窗口的起点（毫秒时间戳）。 */
      readonly since: number
      readonly expected: { readonly refs: readonly string[] }
    }
  | { readonly unsupported: true }

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
  /**
   * 增量能力的显式声明。每个后端都必须填写：
   * 实现增量的给出工厂、窗口起点与期望的工单引用，
   * 不支持的显式声明 `unsupported`。
   */
  readonly changes: TrackerChangesFixture
  /** 后端实现可选详情能力时的读取请求、期望输出与可选变更；省略表示不实现。 */
  readonly detail?: TicketDetailFixture
  /** 后端实现可选补全候选能力时的期望输出；省略表示不实现。 */
  readonly options?: TicketOptionsFixture
  /** 后端实现可选删除能力时的目标票与权限期望；省略表示不实现。 */
  readonly delete?: TicketDeleteFixture
  /**
   * 后端能给出的可选字段：关闭时间与阻塞引用。未列出的票必须省略该字段，
   * 这样“给不出”不会被伪装成一个值。
   */
  readonly fields?: {
    /** ref → 期望的关闭时间。 */
    readonly closedAt: Readonly<Record<string, string>>
    /** ref → 期望的阻塞票引用。 */
    readonly blockedBy: Readonly<Record<string, readonly string[]>>
  }
}

/**
 * 注册一组后端无关的契约断言。
 * @param backend - 后端名称，用于测试标题。
 * @param fixture - 工厂与期望输出。
 */
export function describeTrackerContract(backend: string, fixture: TrackerContractFixture): void {
  describe(`${backend} 工单后端契约`, () => {
    describeListContract(fixture)
    describeBlockerContract(fixture)
    describeChangesContract(fixture)
    describeDetailContract(fixture)
    describeOptionsContract(fixture)
    describeDeleteContract(fixture)
  })
}

function describeListContract(fixture: TrackerContractFixture): void {
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

  const fields = fixture.fields
  if (fields !== undefined) {
    it('给出可得的关闭时间与阻塞引用，缺数据时省略字段', async () => {
      const snapshot = await fixture.createTracker().fetchSnapshot(fixture.workspaceRoot)

      for (const ticket of snapshot.tickets) {
        expect(ticket.closedAt).toBe(fields.closedAt[ticket.ref])
        expect(ticket.blockedBy).toEqual(fields.blockedBy[ticket.ref])
        // 创建人整体可以为 null（本地 Markdown）；有创建人时登录名必填，头像只能是 http(s)。
        if (ticket.author !== null) {
          expect(ticket.author.login.length).toBeGreaterThan(0)
          expect(
            ticket.author.avatarUrl === null || /^https?:\/\//.test(ticket.author.avatarUrl),
          ).toBe(true)
        }
      }
    })
  }
}

function describeBlockerContract(fixture: TrackerContractFixture): void {
  it('按声明提供原生阻塞数', async () => {
    const tracker = fixture.createTracker()
    const nativeBlockers = fixture.nativeBlockers

    if (nativeBlockers.kind === 'snapshot') {
      expect(tracker.resolveBlockers).toBeUndefined()
      const snapshot = await tracker.fetchSnapshot(fixture.workspaceRoot)
      expect(snapshot.tickets.map((ticket) => ticket.openBlockers)).toEqual(nativeBlockers.expected)
      return
    }

    if (nativeBlockers.kind === 'deferred') {
      expect(typeof tracker.resolveBlockers).toBe('function')
      const native = await tracker.resolveBlockers?.(fixture.workspaceRoot, nativeBlockers.request)
      expect(native).toEqual(nativeBlockers.expected)
      return
    }

    expect(tracker.resolveBlockers).toBeUndefined()
    const snapshot = await tracker.fetchSnapshot(fixture.workspaceRoot)
    expect(snapshot.tickets.map((ticket) => ticket.openBlockers)).toEqual(nativeBlockers.expected)
  })
}

/**
 * 增量能力的契约：实现增量的后端必须按窗口取回变更过的工单，
 * 不支持的后端必须显式声明没有这个方法。
 */
function describeChangesContract(fixture: TrackerContractFixture): void {
  const changes = fixture.changes

  if ('unsupported' in changes) {
    it('显式声明不支持增量', () => {
      expect(fixture.createTracker().fetchChanges).toBeUndefined()
    })
    return
  }

  it('声明增量能力', () => {
    expect(typeof fixture.createTracker().fetchChanges).toBe('function')
  })

  it('按时间窗口取回变更过的工单', async () => {
    const tracker = changes.createTracker()

    const observed = await tracker.fetchChanges?.(fixture.workspaceRoot, changes.since)

    // 引用按字典序比较：增量只覆盖变更过的票，顺序由后端决定。
    const refs = (observed?.tickets ?? []).map((ticket) => ticket.ref).sort()
    expect(refs).toEqual([...changes.expected.refs].sort())
  })
}

function describeDetailContract(fixture: TrackerContractFixture): void {
  const detail = fixture.detail
  const change = detail?.change

  it(detail === undefined ? '不声明详情能力' : '声明详情能力', () => {
    const tracker = fixture.createTracker()

    expect(typeof tracker.fetchDetail).toBe(detail === undefined ? 'undefined' : 'function')
  })

  it(change === undefined ? '不声明变更能力' : '声明变更能力', () => {
    const tracker = fixture.createTracker()

    expect(typeof tracker.updateTicket).toBe(change === undefined ? 'undefined' : 'function')
  })

  if (detail === undefined) return
  describeDetailReads(fixture.workspaceRoot, detail)
  if (change !== undefined) describeDetailChange(fixture.workspaceRoot, detail.request, change)
}

function describeDetailReads(workspaceRoot: string, detail: TicketDetailFixture): void {
  it('详情返回正文、标签、分配人、评论、链接与时间', async () => {
    const tracker = detail.createTracker()

    const observed = await tracker.fetchDetail?.(workspaceRoot, detail.request)

    expect(observed).toEqual({
      ...detail.expected,
      ref: detail.request.ref,
      number: detail.request.number,
    })
  })

  it('评论按时间升序排列', async () => {
    const tracker = detail.createTracker()

    const observed = await tracker.fetchDetail?.(workspaceRoot, detail.request)
    const times = (observed?.comments ?? []).map((comment) => comment.createdAt ?? '')

    expect([...times].sort()).toEqual(times)
  })
}

function describeOptionsContract(fixture: TrackerContractFixture): void {
  const options = fixture.options

  it(options === undefined ? '不声明补全候选能力' : '声明补全候选能力', () => {
    const tracker = fixture.createTracker()

    expect(typeof tracker.fetchOptions).toBe(options === undefined ? 'undefined' : 'function')
  })

  if (options === undefined) return
  it('补全候选返回标签与可分配用户', async () => {
    const tracker = options.createTracker()

    const observed = await tracker.fetchOptions?.(fixture.workspaceRoot)

    expect(observed).toEqual(options.expected)
  })
}

function describeDeleteContract(fixture: TrackerContractFixture): void {
  const remove = fixture.delete

  it(remove === undefined ? '不声明删除能力' : '声明删除能力', () => {
    const tracker = fixture.createTracker()
    const expected = remove === undefined ? 'undefined' : 'function'

    expect(typeof tracker.canDeleteTickets).toBe(expected)
    expect(typeof tracker.deleteTicket).toBe(expected)
  })

  if (remove === undefined) return
  it('按后端权限规则报告能否删除', async () => {
    const tracker = remove.createTracker()

    await expect(tracker.canDeleteTickets?.(fixture.workspaceRoot)).resolves.toBe(remove.canDelete)
  })

  it('删除后重新读取详情返回 ticket-not-found', async () => {
    const tracker = remove.createTracker()

    await tracker.deleteTicket?.(fixture.workspaceRoot, remove.request)

    await expect(
      tracker.fetchDetail?.(fixture.workspaceRoot, remove.request),
    ).rejects.toMatchObject({ code: 'ticket-not-found' })
  })
}

function describeDetailChange(
  workspaceRoot: string,
  request: TicketReference,
  change: NonNullable<TicketDetailFixture['change']>,
): void {
  it('变更后重新读取详情能看到新值', async () => {
    const tracker = change.createTracker()

    await tracker.updateTicket?.(workspaceRoot, request, change.patch)
    const observed = await tracker.fetchDetail?.(workspaceRoot, request)

    expect(observed?.state).toBe(change.expected.state)
    if (change.expected.labels !== undefined) {
      expect(observed?.labels).toEqual(change.expected.labels)
    }
    if (change.expected.assignees !== undefined) {
      expect(observed?.assignees).toEqual(change.expected.assignees)
    }
  })
}
