import { describe, expect, it } from 'vitest'

import { CommandError } from '../../core/tracker-error.ts'
import { mapGhError } from './shared.ts'

function ghFailure(stderr: string): CommandError {
  return new CommandError('failed', 'gh api repos/cnzgray/repo/issues', stderr, 1)
}

describe('gh 失败翻译', () => {
  it('主限流报错识别为 rate-limited', () => {
    const error = mapGhError(ghFailure('gh: API rate limit exceeded for user ID 123. (HTTP 403)'))

    expect(error.code).toBe('rate-limited')
    expect(error.retryAfterMs).toBeUndefined()
  })

  it('限流输出里的 retry after 转成毫秒', () => {
    const error = mapGhError(
      ghFailure('gh: API rate limit still exceeded for user ID 123, retry after 27s (HTTP 403)'),
    )

    expect(error.code).toBe('rate-limited')
    expect(error.retryAfterMs).toBe(27_000)
  })

  it('次级限流同样识别，不带等待时长', () => {
    const error = mapGhError(
      ghFailure(
        'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.',
      ),
    )

    expect(error.code).toBe('rate-limited')
    expect(error.retryAfterMs).toBeUndefined()
  })

  it('认证失败仍翻译为未登录，不被限流规则抢走', () => {
    expect(mapGhError(ghFailure('not logged in')).code).toBe('gh-unauthenticated')
  })

  it('普通网络失败仍是 fetch-failed', () => {
    expect(mapGhError(ghFailure('dial tcp: lookup api.github.com: no such host')).code).toBe(
      'fetch-failed',
    )
  })
})
