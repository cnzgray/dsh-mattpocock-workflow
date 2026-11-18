/**
 * Gitea 评论分页。
 *
 * 有的部署忽略 `page` / `limit`，每页都返回全部评论；这里锁定详情读取的收口条件：
 * 拿到总数、整页没有新评论、短页三种情况都要停，评论按 id 去重且不重复。
 */
import { describe, expect, it } from 'vitest'

import type { CommandRunner, Tracker } from '../../core/ticket.ts'
import {
  GITEA_COMMENTS,
  GITEA_REMOTES_OUTPUT,
  apiCall,
  giteaComment,
  giteaIssueDetail,
  type RecordedApiCall,
} from './fixtures.ts'
import { NOW } from './tracker-test-support.ts'
import { createGiteaTracker } from './tracker.ts'

const GITEA_REPO = 'cnzgray/dsh-workflow'
const DETAIL_ENDPOINT = `/repos/${GITEA_REPO}/issues/15`

/** 详情本体；评论以外的字段与分页无关。 */
function detailResponse(): RecordedApiCall {
  return apiCall(
    giteaIssueDetail({
      number: 15,
      title: '右侧栏任务面板 MVP',
      state: 'open',
      labels: [],
      assignees: [],
      body: '## 目标\n\n在面板里看工单。',
    }),
  )
}

/** 构造 n 条 id、作者、时间、正文各不相同的评论。 */
function commentBodies(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => ({
    ...giteaComment({
      id: index + 1,
      login: `user${String(index)}`,
      body: `评论 ${String(index)}`,
      createdAt: `2026-11-13T0${String(index)}:00:00Z`,
    }),
  }))
}

/**
 * 评论接口的假后端：`page(n)` 决定第 n 页内容；`total` 缺省时取本页条数，
 * 传 `null` 模拟响应不带总数。
 */
function commentsRunner(
  page: (index: number) => readonly Record<string, unknown>[],
  options: { readonly total?: number | null } = {},
): { readonly tracker: Tracker; readonly commentCalls: () => number } {
  let calls = 0
  const runner: CommandRunner = (command, args) => {
    if (command === 'git') return Promise.resolve({ stdout: GITEA_REMOTES_OUTPUT, stderr: '' })
    const endpoint = args[2] ?? ''
    if (endpoint === DETAIL_ENDPOINT) return Promise.resolve(detailResponse())
    calls += 1
    const index = Number(/[?&]page=(\d+)/.exec(endpoint)?.[1] ?? '1')
    const comments = page(index)
    const total = options.total === undefined ? comments.length : options.total
    return Promise.resolve(total === null ? apiCall(comments) : apiCall(comments, total))
  }
  return {
    tracker: createGiteaTracker({ run: runner, now: () => NOW, pageSize: 2 }),
    commentCalls: () => calls,
  }
}

describe('Gitea 评论分页', () => {
  it('按页拉到短页为止', async () => {
    const pages = new Map([
      [1, GITEA_COMMENTS.slice(0, 2)],
      [2, GITEA_COMMENTS.slice(2)],
    ])
    const backend = commentsRunner((page) => pages.get(page) ?? [])

    const detail = await backend.tracker.fetchDetail?.('/workspace', { ref: '#15', number: 15 })

    expect(detail?.comments.map((comment) => comment.author)).toEqual(['bob', 'carol'])
  })

  it('服务端忽略分页参数时按总数收口，不重复读取评论', async () => {
    const backend = commentsRunner(() => commentBodies(3), { total: 3 })

    const detail = await backend.tracker.fetchDetail?.('/workspace', { ref: '#15', number: 15 })

    expect(detail?.comments.map((comment) => comment.body)).toEqual(['评论 0', '评论 1', '评论 2'])
    expect(backend.commentCalls()).toBe(1)
  })

  it('服务端既忽略分页又不给总数时，重复页也停得下来', async () => {
    const backend = commentsRunner(() => commentBodies(3), { total: null })

    const detail = await backend.tracker.fetchDetail?.('/workspace', { ref: '#15', number: 15 })

    expect(detail?.comments.map((comment) => comment.body)).toEqual(['评论 0', '评论 1', '评论 2'])
    // 第一页拿到全部，第二页没有新内容即收口。
    expect(backend.commentCalls()).toBe(2)
  })

  it('没有服务端 id 时按内容去重', async () => {
    const withoutIds = (): Record<string, unknown>[] =>
      commentBodies(3).map(({ user, body, created_at }) => ({ user, body, created_at }))
    const backend = commentsRunner(withoutIds, { total: null })

    const detail = await backend.tracker.fetchDetail?.('/workspace', { ref: '#15', number: 15 })

    expect(detail?.comments.map((comment) => comment.body)).toEqual(['评论 0', '评论 1', '评论 2'])
    expect(backend.commentCalls()).toBe(2)
  })

  it('翻页期间正文被编辑时，同一条评论不会出现两次', async () => {
    const original = commentBodies(1)
    const edited = original.map((entry) => ({ ...entry, body: '评论 0（已编辑）' }))
    const backend = commentsRunner((page) => (page === 1 ? original : edited), { total: null })

    const detail = await backend.tracker.fetchDetail?.('/workspace', { ref: '#15', number: 15 })

    expect(detail?.comments.map((comment) => comment.body)).toEqual(['评论 0'])
  })

  it('评论很多时按总数并发补齐剩余页', async () => {
    const all = commentBodies(9)
    const requested: number[] = []
    let inFlight = 0
    let peak = 0
    const runner: CommandRunner = async (command, args) => {
      if (command === 'git') return { stdout: GITEA_REMOTES_OUTPUT, stderr: '' }
      const endpoint = args[2] ?? ''
      if (endpoint === DETAIL_ENDPOINT) return detailResponse()
      const page = Number(/[?&]page=(\d+)/.exec(endpoint)?.[1] ?? '1')
      requested.push(page)
      inFlight += 1
      peak = Math.max(peak, inFlight)
      // 让同一批请求都先进入再返回，只靠微任务，不等真实时间。
      await Promise.resolve()
      inFlight -= 1
      return apiCall(all.slice((page - 1) * 2, page * 2), all.length)
    }
    const tracker = createGiteaTracker({ run: runner, now: () => NOW, pageSize: 2 })

    const detail = await tracker.fetchDetail?.('/workspace', { ref: '#15', number: 15 })

    expect(detail?.comments.map((comment) => comment.body)).toEqual([
      '评论 0',
      '评论 1',
      '评论 2',
      '评论 3',
      '评论 4',
      '评论 5',
      '评论 6',
      '评论 7',
      '评论 8',
    ])
    expect(requested).toEqual([1, 2, 3, 4, 5])
    // 前两页顺序读，其余三页同时发出。
    expect(peak).toBeGreaterThan(1)
  })

  it('没有总数时顺序探测到短页为止', async () => {
    const all = commentBodies(5)
    const backend = commentsRunner((page) => all.slice((page - 1) * 2, page * 2), { total: null })

    const detail = await backend.tracker.fetchDetail?.('/workspace', { ref: '#15', number: 15 })

    expect(detail?.comments.map((comment) => comment.body)).toEqual([
      '评论 0',
      '评论 1',
      '评论 2',
      '评论 3',
      '评论 4',
    ])
    expect(backend.commentCalls()).toBe(3)
  })

  it('评论数正好是页大小整数倍时不多读一页', async () => {
    const all = commentBodies(4)
    const backend = commentsRunner((page) => all.slice((page - 1) * 2, page * 2), {
      total: all.length,
    })

    const detail = await backend.tracker.fetchDetail?.('/workspace', { ref: '#15', number: 15 })

    expect(detail?.comments.map((comment) => comment.body)).toEqual([
      '评论 0',
      '评论 1',
      '评论 2',
      '评论 3',
    ])
    expect(backend.commentCalls()).toBe(2)
  })
})
