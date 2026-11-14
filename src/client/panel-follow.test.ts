/**
 * 面板跟随的接缝：假作用域 + 假右栏服务，断言只落在「宿主有没有收到 openTab」上，
 * 不碰模块内部状态。时间用假定时器推进，避免依赖真实宏任务的时序。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createClientCapabilities, type ClientCapabilities } from './capabilities.ts'
import { createFakeRightColumn } from './panel-follow-test-support.ts'
import { startPanelFollow, type PanelFollowScope } from './panel-follow.ts'

const TAB_KIND = 'dsh-mattpocock-workflow'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** 一条注入：宿主按依赖就绪与否调用或卸载它。 */
interface Injection {
  readonly deps: readonly string[]
  readonly callback: (scope: PanelFollowScope) => unknown
  cleanup: (() => void) | undefined
}

interface Harness {
  /** 宿主收到的 openTab 调用，按发生顺序。 */
  readonly opens: readonly string[]
  /** 被停用过的注入句柄。 */
  readonly disposed: readonly string[]
  readonly capabilities: ClientCapabilities
  /** 模拟会话切换：右栏在屏会话变化的通知。 */
  readonly show: (sessionId: string | undefined) => void
  readonly setTabs: (tabs: readonly { readonly sessionId: string; readonly kind: string }[]) => void
  /** 右栏服务消失或回来；宿主会卸载并重新调用注入回调。 */
  readonly setSidebar: (present: boolean) => void
  readonly stop: () => void
}

function createHarness(
  options: {
    readonly withSidebar?: boolean
    readonly withOpenTabs?: boolean
    readonly openTabThrows?: boolean
    readonly mountedThrows?: boolean
    readonly mounted?: string
  } = {},
): Harness {
  vi.useFakeTimers()

  const right = createFakeRightColumn(options)
  const services: Record<string, unknown> = {}
  if (options.withSidebar !== false) services.sidebarRight = right.service

  const injections: Injection[] = []
  const disposed: string[] = []
  const runCleanup = (injection: Injection): void => {
    const cleanup = injection.cleanup
    injection.cleanup = undefined
    if (typeof cleanup === 'function') cleanup()
  }
  const runCallback = (injection: Injection): void => {
    const result: unknown = injection.callback(scope)
    injection.cleanup = typeof result === 'function' ? (result as () => void) : undefined
  }

  const scope: PanelFollowScope = {
    get: (name) => services[name],
    inject: (deps, callback) => {
      const injection: Injection = { deps, callback, cleanup: undefined }
      injections.push(injection)
      runCallback(injection)
      // 与宿主一致：注入返回可 dispose 的句柄（cordis 给的是 fiber）。
      return {
        dispose: () => {
          disposed.push(deps.join(','))
          runCleanup(injection)
        },
      }
    },
  }

  const capabilities = createClientCapabilities()
  const stop = startPanelFollow(scope, { tabKind: TAB_KIND, capabilities })

  return {
    opens: right.opens,
    disposed,
    capabilities,
    show: (sessionId) => {
      right.show(sessionId)
    },
    setTabs: (tabs) => {
      right.setTabs(tabs)
    },
    setSidebar: (present) => {
      if (present) services.sidebarRight = right.service
      else delete services.sidebarRight
      for (const injection of injections) {
        runCleanup(injection)
        if (injection.deps.every((dep) => services[dep] !== undefined)) runCallback(injection)
      }
    },
    stop,
  }
}

/** 推进到打开动作的宏任务之后；重试串在同一个时间点上。 */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(100)
}

describe('面板跟随', () => {
  it('来源会话开着面板时，新会话里自动恢复页签', async () => {
    const harness = createHarness()
    harness.setTabs([{ sessionId: 'a', kind: TAB_KIND }])
    harness.show('a')

    harness.show('b')
    await settle()

    expect(harness.opens).toEqual([TAB_KIND])
  })

  it('来源会话没有面板时不打扰', async () => {
    const harness = createHarness()
    harness.show('a')

    harness.show('b')
    await settle()

    expect(harness.opens).toEqual([])
  })

  it('目标会话已经有面板页签时不重复打开', async () => {
    const harness = createHarness()
    harness.setTabs([
      { sessionId: 'a', kind: TAB_KIND },
      { sessionId: 'b', kind: TAB_KIND },
    ])
    harness.show('a')

    harness.show('b')
    await settle()

    expect(harness.opens).toEqual([])
  })

  it('切回已经见过的会话不动作', async () => {
    const harness = createHarness()
    harness.setTabs([{ sessionId: 'a', kind: TAB_KIND }])
    harness.show('a')
    harness.show('b')
    await settle()

    harness.show('a')
    await settle()

    expect(harness.opens).toEqual([TAB_KIND])
  })

  it('装载时屏上已有会话只记基线，不动作', async () => {
    const harness = createHarness({ mounted: 'a' })
    harness.setTabs([{ sessionId: 'a', kind: TAB_KIND }])

    await settle()

    expect(harness.opens).toEqual([])
  })

  it('会话在等待期间被切走就放弃', async () => {
    const harness = createHarness()
    harness.setTabs([{ sessionId: 'a', kind: TAB_KIND }])
    harness.show('a')

    harness.show('b')
    harness.show('c')
    await settle()

    expect(harness.opens).toEqual([])
  })

  it('打开失败不冒泡，重试有限次后放弃', async () => {
    const harness = createHarness({ openTabThrows: true })
    harness.setTabs([{ sessionId: 'a', kind: TAB_KIND }])
    harness.show('a')

    harness.show('b')
    await expect(settle()).resolves.toBeUndefined()

    const attempts = harness.opens.length
    expect(attempts).toBeGreaterThan(0)
    expect(attempts).toBeLessThan(10)

    // 再等很久也不再重试：有上限，不是无限循环。
    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.opens).toHaveLength(attempts)
  })

  it('宿主没有右栏服务时不抛错，能力诊断记缺失', async () => {
    const harness = createHarness({ withSidebar: false })

    harness.show('a')
    harness.show('b')
    await settle()

    expect(harness.opens).toEqual([])
    expect(statusOf(harness.capabilities, 'sidebarRight')).toBe('missing')
  })

  it('右栏服务就绪时把能力诊断标为可用', () => {
    const harness = createHarness()

    expect(statusOf(harness.capabilities, 'sidebarRight')).toBe('present')
  })

  it('右栏服务消失再回来之后仍会跟随', async () => {
    const harness = createHarness()
    harness.setTabs([{ sessionId: 'a', kind: TAB_KIND }])
    harness.show('a')

    harness.setSidebar(false)
    expect(statusOf(harness.capabilities, 'sidebarRight')).toBe('missing')
    harness.setSidebar(true)
    expect(statusOf(harness.capabilities, 'sidebarRight')).toBe('present')

    harness.show('b')
    await settle()

    expect(harness.opens).toEqual([TAB_KIND])
  })

  it('宿主读操作抛错时不冒泡，也不跟随', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const harness = createHarness({ mountedThrows: true })

    harness.show('a')
    harness.show('b')
    await settle()

    expect(harness.opens).toEqual([])
    expect(statusOf(harness.capabilities, 'sidebarRight')).toBe('present')
    expect(warn).toHaveBeenCalled()
  })

  it('宿主没有页签清单时保守不动作，并只提示一次', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const harness = createHarness({ withOpenTabs: false })
    harness.show('a')
    harness.show('b')
    await settle()

    expect(harness.opens).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('停止后不再订阅也不打开页签，重复停止不抛错', async () => {
    const harness = createHarness()
    harness.setTabs([{ sessionId: 'a', kind: TAB_KIND }])
    harness.show('a')

    harness.stop()
    expect(harness.disposed).toHaveLength(1)
    expect(() => {
      harness.stop()
    }).not.toThrow()
    expect(harness.disposed).toHaveLength(1)

    harness.show('b')
    await settle()

    expect(harness.opens).toEqual([])
  })

  it('停止会取消还没发出的打开动作', async () => {
    const harness = createHarness()
    harness.setTabs([{ sessionId: 'a', kind: TAB_KIND }])
    harness.show('a')
    harness.show('b')

    harness.stop()
    await settle()

    expect(harness.opens).toEqual([])
  })
})

function statusOf(capabilities: ClientCapabilities, id: string): string | undefined {
  return capabilities.read().find((entry) => entry.id === id)?.status
}
