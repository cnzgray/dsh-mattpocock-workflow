/**
 * 工单详情视图测试的夹具：详情与快照样例、会落地补丁的假后端、渲染入口。
 * 与用例分开，免得夹具把测试文件挤到 max-lines 之外。
 */
import { render, screen } from '@testing-library/react'
import * as React from 'react'

import { emptyMetrics } from '../protocol/snapshot-test-support.ts'
import type {
  RpcErrorBody,
  RpcResult,
  TicketAttachment,
  TicketDetail,
  TicketOptions,
  TicketPatch,
  TicketSnapshot,
  WorkspaceSnapshot,
} from '../protocol/tracker.ts'
import { fakeInjection } from './injection-test-support.ts'
import type { PanelClient } from './rpc.ts'
import { wrapRefresh } from './task-panel-test-support.ts'
import {
  TicketDetailView,
  type DetailTarget,
  type TicketDetailViewProps,
} from './ticket-detail-view.tsx'

export const DETAIL: TicketDetail = {
  ref: '#25',
  number: 25,
  title: '任务面板：工单详情视图',
  state: 'open',
  author: 'carol',
  body: '## 规格\n\n正文保留了原始 Markdown。',
  uploadsBaseUrl: null,
  labels: ['enhancement', 'ready-for-agent'],
  assignees: ['alice'],
  comments: [
    { author: 'bob', body: '补充验收标准', createdAt: '2026-11-13T09:00:00Z' },
    { author: 'carol', body: '上一次失败的原因', createdAt: '2026-11-13T10:00:00Z' },
  ],
  url: 'https://github.com/cnzgray/dsh-mattpocock-workflow/issues/25',
  createdAt: '2026-11-12T09:00:00Z',
  updatedAt: '2026-11-13T10:00:00Z',
  backend: 'github',
  capabilities: { labels: true, assignees: true, state: true, link: true, delete: false },
}

export const OPTIONS: TicketOptions = {
  labels: [
    { name: 'bug', color: '#d73a4a', description: '缺陷' },
    { name: 'enhancement', color: '#a2eeef', description: null },
    { name: 'ready-for-agent', color: '#0e8a16', description: '可以交给 agent' },
    { name: 'needs-triage', color: null, description: '待分流' },
  ],
  assignees: [
    { username: 'alice', name: 'Alice' },
    { username: 'bob', name: 'Bob Lee' },
  ],
}

export function detail(overrides: Partial<TicketDetail> = {}): TicketDetail {
  return { ...DETAIL, ...overrides }
}

/** 列表里选中的那一行：技能动作的判定结果由宿主附在快照上。 */
export const TICKET: TicketSnapshot = {
  ref: '#25',
  number: 25,
  title: DETAIL.title,
  state: 'open',
  category: 'enhancement',
  status: 'ready',
  labels: [],
  author: null,
  assignees: [],
  skillAction: 'implement',
  skillActionReason: 'ready-for-agent',
  createdAt: DETAIL.createdAt,
  updatedAt: DETAIL.updatedAt,
  openBlockers: 0,
}

export function snapshotTicket(overrides: Partial<TicketSnapshot> = {}): TicketSnapshot {
  return { ...TICKET, ...overrides }
}

/** 把一个快照行包成详情目标；快照里没有这张票时退回夹具的引用与编号。 */
export function target(ticket: TicketSnapshot | null): DetailTarget {
  if (ticket === null) {
    return { ref: TICKET.ref, number: TICKET.number, ticket }
  }
  return { ref: ticket.ref, number: ticket.number, ticket }
}

export const EMPTY_SNAPSHOT: WorkspaceSnapshot = {
  backend: 'github',
  repository: 'cnzgray/dsh-mattpocock-workflow',
  repositoryHost: 'github.com',
  viewer: 'cnzgray',
  fetchedAt: 1,
  loaded: 0,
  total: 0,
  windowLimit: 100,
  hierarchy: 'native',
  libraryVersion: null,
  tickets: [],
  metrics: emptyMetrics(),
  blockersFinalized: true,
  source: 'live',
  stale: false,
  refreshError: null,
}

export interface FakeBackend {
  readonly client: PanelClient
  readonly detailCalls: (readonly [string, string, number | null])[]
  readonly updateCalls: (readonly [string, string, number | null, TicketPatch])[]
  readonly refreshCalls: string[]
  readonly optionsCalls: string[]
  readonly deleteCalls: (readonly [string, string, number | null])[]
  /** 取内联附件的调用：工作区与附件地址。 */
  readonly attachmentCalls: (readonly [string, string])[]
  failNextUpdate(error: RpcErrorBody): void
  failDetail(error: RpcErrorBody): void
  /** 让下一次单票读取返回另一份详情：模拟远端在两次读取之间变了。 */
  changeDetail(next: TicketDetail): void
}

const EMPTY_CACHE = {
  location: '~/.dsh/cache/dsh-mattpocock-workflow/',
  entries: 0,
  lastWrittenAt: null,
  cleared: 0,
} as const

/**
 * 一个会真正落地补丁的假后端：写完再读，界面看到的是新值。
 * @param initial - 初始详情。
 * @param refreshed - 列表刷新返回的快照；写操作后的技能徽标按它更新。
 * @param attachments - 按附件地址给出的取图结果；没有的地址返回取图失败。
 * @returns 假后端与调用记录。
 */
export function fakeBackend(
  initial: TicketDetail = DETAIL,
  refreshed: WorkspaceSnapshot = EMPTY_SNAPSHOT,
  attachments: Readonly<Record<string, RpcResult<TicketAttachment>>> = {},
): FakeBackend {
  let current = initial
  let updateFailure: RpcErrorBody | null = null
  let detailFailure: RpcErrorBody | null = null
  const detailCalls: (readonly [string, string, number | null])[] = []
  const updateCalls: (readonly [string, string, number | null, TicketPatch])[] = []
  const refreshCalls: string[] = []
  const optionsCalls: string[] = []
  const deleteCalls: (readonly [string, string, number | null])[] = []
  const attachmentCalls: (readonly [string, string])[] = []

  const client: PanelClient = {
    get: () => Promise.resolve({ ok: true, result: EMPTY_SNAPSHOT }),
    more: () => Promise.resolve({ ok: true, result: EMPTY_SNAPSHOT }),
    refresh(root) {
      refreshCalls.push(root)
      return wrapRefresh(Promise.resolve({ ok: true, result: refreshed }))
    },
    resolveBlockers: () => Promise.resolve({ ok: true, result: EMPTY_SNAPSHOT }),
    cache: () => Promise.resolve({ ok: true, result: EMPTY_CACHE }),
    getDetail(root, ref, number) {
      detailCalls.push([root, ref, number])
      if (detailFailure !== null) {
        const error = detailFailure
        detailFailure = null
        return Promise.resolve({ ok: false, error })
      }
      return Promise.resolve({ ok: true, result: { ...current, ref, number } })
    },
    updateTicket(root, ref, number, patch) {
      updateCalls.push([root, ref, number, patch])
      if (updateFailure !== null) {
        const error = updateFailure
        updateFailure = null
        return Promise.resolve({ ok: false, error })
      }
      current = applyPatch(current, patch)
      return Promise.resolve({ ok: true, result: { applied: true } })
    },
    envCheck: () => Promise.resolve({ ok: false, error: { code: 'internal', message: '未使用' } }),
    getOptions(root) {
      optionsCalls.push(root)
      return Promise.resolve({ ok: true, result: OPTIONS })
    },
    deleteTicket(root, ref, number) {
      deleteCalls.push([root, ref, number])
      return Promise.resolve({ ok: true, result: { deleted: true } })
    },
    getAttachment(root, path) {
      attachmentCalls.push([root, path])
      return Promise.resolve(
        attachments[path] ?? {
          ok: false,
          error: { code: 'fetch-failed', message: '没有这个附件' },
        },
      )
    },
  }

  return {
    client,
    detailCalls,
    updateCalls,
    refreshCalls,
    optionsCalls,
    deleteCalls,
    attachmentCalls,
    failNextUpdate: (error) => {
      updateFailure = error
    },
    failDetail: (error) => {
      detailFailure = error
    },
    changeDetail: (next) => {
      current = next
    },
  }
}

function applyPatch(detail: TicketDetail, patch: TicketPatch): TicketDetail {
  const assignees =
    patch.assignSelf === true
      ? [...(patch.assignees ?? detail.assignees), 'me']
      : (patch.assignees ?? detail.assignees)
  return {
    ...detail,
    labels: patch.labels ?? detail.labels,
    assignees,
    state: patch.state ?? detail.state,
  }
}

export function view(
  client: PanelClient,
  overrides: Partial<TicketDetailViewProps> = {},
): React.ReactElement {
  return (
    <TicketDetailView
      client={client}
      workspaceRoot="/repo"
      target={target(TICKET)}
      snapshotTickets={[TICKET]}
      backRef={null}
      injection={fakeInjection()}
      onBack={() => undefined}
      onOpenBlocker={() => undefined}
      onRefreshSnapshot={() => undefined}
      {...overrides}
    />
  )
}

export function renderView(
  client: PanelClient,
  overrides: Partial<TicketDetailViewProps> = {},
): void {
  render(view(client, overrides))
}

/** 按 testid 取唯一元素；缺失时测试直接失败。 */
export function element(testId: string): HTMLElement {
  return screen.getByTestId(testId)
}

/** 按 testid 取唯一的按钮元素。 */
export function button(testId: string): HTMLButtonElement {
  return screen.getByTestId<HTMLButtonElement>(testId)
}
