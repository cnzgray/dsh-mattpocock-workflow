/**
 * 环境检查结果缓存：成功报告按工作区 + 仓库身份缓存 10 分钟，
 * 失败不缓存并按递增间隔退避，进行中请求并发复用。
 * 时钟手动推进，缓存命中、过期与退避窗口都是确定性的。
 */
import { describe, expect, it } from 'vitest'

import type { EnvCommandProbe, ProbeOutcome } from '../core/env-check.ts'
import type { BackendKind } from '../protocol/backend.ts'
import {
  createEnvCheckService,
  type EnvCheckService,
  type EnvCheckServiceDeps,
} from './env-check-service.ts'
import type { BackendResolver } from './backend-resolver.ts'
import {
  CATALOG,
  DISK_FILES,
  NO_DEADLINE,
  ROOT,
  fakeProbe,
  report,
  resolved,
  type FakeProbe,
} from './env-check-test-support.ts'

interface CacheHarness {
  readonly service: EnvCheckService
  readonly github: FakeProbe
  readonly gitlab: FakeProbe
  /** resolve 被调用的次数：缓存命中也要做身份核对。 */
  readonly resolveCalls: number
  /** 推进时钟（毫秒）。 */
  readonly advance: (ms: number) => void
  /** 换后端身份，模拟切换远端或换后端。 */
  readonly switchBackend: (kind: BackendKind) => void
}

function cacheHarness(): CacheHarness {
  const github = fakeProbe('github', {})
  const gitlab = fakeProbe('gitlab', {})
  let kind: BackendKind = 'github'
  let clock = 100_000
  let resolveCalls = 0
  const resolve: BackendResolver = () => {
    resolveCalls += 1
    return Promise.resolve(resolved(kind))
  }
  const deps: EnvCheckServiceDeps = {
    resolve,
    github,
    gitlab,
    gitea: fakeProbe('gitea', {}),
    files: DISK_FILES,
    localIssues: () => Promise.resolve({ status: 'found', files: ['.scratch/a/issues/01.md'] }),
    skills: CATALOG,
    capabilities: () => [],
    now: () => clock,
    deadline: NO_DEADLINE,
    log: () => undefined,
  }
  return {
    service: createEnvCheckService(deps),
    github,
    gitlab,
    get resolveCalls() {
      return resolveCalls
    },
    advance(ms) {
      clock += ms
    },
    switchBackend(next) {
      kind = next
    },
  }
}

/** 会变的认证探测：先失败，修好后再通过。 */
function fixableAuthProbe(): EnvCommandProbe & { readonly calls: number; fix: () => void } {
  let auth: ProbeOutcome = { status: 'fail', detail: '未登录', reason: 'cli-unauthenticated' }
  let calls = 0
  return {
    kind: 'github',
    get calls() {
      return calls
    },
    fix() {
      auth = { status: 'pass', detail: '已登录' }
    },
    cli: () => {
      calls += 1
      return Promise.resolve({ status: 'pass', detail: 'cli' })
    },
    auth: () => {
      calls += 1
      return Promise.resolve(auth)
    },
    repository: () => {
      calls += 1
      return Promise.resolve({ status: 'pass', detail: 'repo' })
    },
  }
}

describe('环境检查结果缓存', () => {
  it('全通过时 10 分钟内命中缓存：不重复探测，原样返回并保留当时的检查时刻', async () => {
    const harness = cacheHarness()

    const first = report(await harness.service.handle('env.check', { workspaceRoot: ROOT }))
    expect(harness.github.calls.length).toBe(3)
    const resolveAfterFirst = harness.resolveCalls

    harness.advance(60_000)
    const second = report(await harness.service.handle('env.check', { workspaceRoot: ROOT }))

    // 原样返回（同一个报告对象），检查时刻没动；命令探测零增加，只做了身份核对。
    expect(second).toBe(first)
    expect(second.checkedAt).toBe(first.checkedAt)
    expect(harness.github.calls.length).toBe(3)
    expect(harness.resolveCalls).toBe(resolveAfterFirst + 1)
  })

  it('成功缓存 10 分钟过期后重新探测', async () => {
    const harness = cacheHarness()
    await harness.service.handle('env.check', { workspaceRoot: ROOT })

    harness.advance(10 * 60_000 + 1)
    await harness.service.handle('env.check', { workspaceRoot: ROOT })

    expect(harness.github.calls.length).toBe(6)
  })

  it('仓库身份变更后缓存作废并重跑探测，新身份重新武装缓存', async () => {
    const harness = cacheHarness()
    const first = report(await harness.service.handle('env.check', { workspaceRoot: ROOT }))
    expect(first.backend).toBe('github')

    harness.switchBackend('gitlab')
    harness.advance(60_000)
    const second = report(await harness.service.handle('env.check', { workspaceRoot: ROOT }))

    expect(second.backend).toBe('gitlab')
    expect(second).not.toBe(first)
    expect(harness.gitlab.calls.length).toBe(3)

    // 新身份下的成功报告回写缓存：下一次检查命中，不再探测。
    harness.advance(60_000)
    const third = report(await harness.service.handle('env.check', { workspaceRoot: ROOT }))
    expect(third).toBe(second)
    expect(harness.gitlab.calls.length).toBe(3)
  })

  it('检查有失败项时不进成功缓存：退避窗口后重试会重新探测，修好后立刻拿到新结果', async () => {
    const github = fixableAuthProbe()
    let clock = 100_000
    const deps: EnvCheckServiceDeps = {
      resolve: () => Promise.resolve(resolved('github')),
      github,
      gitlab: fakeProbe('gitlab', {}),
      gitea: fakeProbe('gitea', {}),
      files: DISK_FILES,
      localIssues: () => Promise.resolve({ status: 'found', files: ['.scratch/a/issues/01.md'] }),
      skills: CATALOG,
      capabilities: () => [],
      now: () => clock,
      deadline: NO_DEADLINE,
      log: () => undefined,
    }
    const service = createEnvCheckService(deps)

    const failed = report(await service.handle('env.check', { workspaceRoot: ROOT }))
    expect(failed.items.some((entry) => entry.status === 'fail')).toBe(true)
    const callsAfterFailure = github.calls

    // 退避首档 8 秒：窗口内原样返回上一次失败，不重复探测。
    clock += 5_000
    const backedOff = report(await service.handle('env.check', { workspaceRoot: ROOT }))
    expect(backedOff).toBe(failed)
    expect(github.calls).toBe(callsAfterFailure)

    // 窗口过后重试：重新探测；修好后这次全通过并进入缓存。
    clock += 4_000
    github.fix()
    const fixed = report(await service.handle('env.check', { workspaceRoot: ROOT }))
    expect(fixed.items.every((entry) => entry.status === 'pass')).toBe(true)
    expect(github.calls).toBeGreaterThan(callsAfterFailure)
  })

  it('连续失败按递增间隔退避：第二次失败后 16 秒内不再探测', async () => {
    const github = fakeProbe('github', {
      auth: { status: 'fail', detail: '未登录', reason: 'cli-unauthenticated' },
    })
    let clock = 100_000
    const deps: EnvCheckServiceDeps = {
      resolve: () => Promise.resolve(resolved('github')),
      github,
      gitlab: fakeProbe('gitlab', {}),
      gitea: fakeProbe('gitea', {}),
      files: DISK_FILES,
      localIssues: () => Promise.resolve({ status: 'found', files: ['.scratch/a/issues/01.md'] }),
      skills: CATALOG,
      capabilities: () => [],
      now: () => clock,
      deadline: NO_DEADLINE,
      log: () => undefined,
    }
    const service = createEnvCheckService(deps)

    await service.handle('env.check', { workspaceRoot: ROOT })
    const callsAfterFirst = github.calls.length

    // 首档 8 秒后第二次检查：重新探测，仍然失败。
    clock += 9_000
    await service.handle('env.check', { workspaceRoot: ROOT })
    expect(github.calls.length).toBeGreaterThan(callsAfterFirst)
    const callsAfterSecond = github.calls.length

    // 第二档 16 秒：9 秒处仍在退避窗口内，原样返回不探测。
    clock += 9_000
    const third = report(await service.handle('env.check', { workspaceRoot: ROOT }))
    expect(third.items.some((entry) => entry.status === 'fail')).toBe(true)
    expect(github.calls.length).toBe(callsAfterSecond)

    // 越过 16 秒窗口：再次探测。
    clock += 8_000
    await service.handle('env.check', { workspaceRoot: ROOT })
    expect(github.calls.length).toBeGreaterThan(callsAfterSecond)
  })

  it('同一工作区的并发检查复用同一次探测', async () => {
    const harness = cacheHarness()

    const [first, second] = await Promise.all([
      harness.service.handle('env.check', { workspaceRoot: ROOT }),
      harness.service.handle('env.check', { workspaceRoot: ROOT }),
    ])

    expect(report(first).items.every((entry) => entry.status === 'pass')).toBe(true)
    expect(second).toEqual(first)
    expect(harness.github.calls.length).toBe(3)
  })
})
