/**
 * 面板跟随：会话换人时把 MattWorkflow 页签带到新会话，宿主会顺带展开右栏。
 *
 * 深模块：调用方只说「装上」。会话判定、页签归属、落座时序、宿主能力缺失时的降级
 * 都在实现里，调用方不需要知道宿主服务名与页签 kind。
 *
 * 规则一句话：来源会话里开着本页签、目标会话里没有、且这个会话此前没见过时，
 * 替用户把它打开。不引入新的持久化——页签归属读的是宿主自己的 `openTabs` 清单。
 */
import type { ClientCapabilities } from './capabilities.ts'

const PLUGIN_NAME = 'dsh-mattpocock-workflow'

/**
 * 打开动作的总尝试次数。宿主在 React 渲染会话切换之前就换掉在屏会话，会话面在
 * 同一帧才铸出来，同步调用会撞上「没有挂载的会话面」，所以延后一轮宏任务并留两次重试。
 */
const OPEN_ATTEMPTS = 3

/** 插件作用域：按名取服务，并能等依赖就绪。 */
export interface PanelFollowScope {
  get(name: string): unknown
  inject(deps: readonly string[], callback: (scope: PanelFollowScope) => unknown): unknown
}

/** 装上面板跟随时要说的事情。 */
export interface PanelFollowOptions {
  /** 要跟随的页签类型；本插件传自己的 kind。 */
  readonly tabKind: string
  /** 能力诊断记录器；模块用它报告宿主右栏控制能力是否可用。 */
  readonly capabilities: ClientCapabilities
}

/** 宿主共享的只读快照；`getSnapshot` 取值，`subscribe` 在变化时通知。 */
interface ObservableSnapshotLike<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** 右栏清单里的一行：哪个会话开着哪个类型的页签。 */
interface OpenTabLike {
  readonly sessionId: string
  readonly kind: string
}

/** 探测到的宿主右栏面；`openTabs` 不在上游公开接口里，形状在读取时校验。 */
interface SidebarRightLike {
  readonly mounted: ObservableSnapshotLike<string | undefined>
  openTab(kind: string): void
  readonly openTabs?: unknown
}

/**
 * 装上面板跟随。
 * @param scope - 客户端作用域；模块在里面等 `sidebarRight` 就绪。
 * @param options - 页签类型与能力记录器。
 * @returns 停止跟随时调用一次的函数；重复调用安全。
 */
export function startPanelFollow(scope: PanelFollowScope, options: PanelFollowOptions): () => void {
  if (typeof scope.inject !== 'function') return () => undefined

  let follow = createFollow(options.tabKind)
  let stopped = false
  let dispose: (() => void) | undefined

  try {
    const injected: unknown = scope.inject(['sidebarRight'], (inner) => {
      const sidebar = readSidebarRight(inner.get('sidebarRight'))
      options.capabilities.mark('sidebarRight', sidebar !== undefined)
      if (sidebar === undefined) {
        console.warn(
          `[${PLUGIN_NAME}] sidebarRight is unavailable; the tab will not reopen in new sessions.`,
        )
      }

      // 宿主重新提供这个服务时会先卸载再调用：上一轮跟随已随服务消失停掉，
      // 这一轮从干净状态开始，不沿用「见过」集合。
      follow = createFollow(options.tabKind)
      const detach = sidebar === undefined ? () => undefined : follow.attach(sidebar)
      return () => {
        options.capabilities.mark('sidebarRight', false)
        detach()
      }
    })
    dispose = disposerOf(injected)
  } catch (error) {
    console.warn(`[${PLUGIN_NAME}] panel follow could not be installed.`, error)
    return () => undefined
  }

  return () => {
    if (stopped) return
    stopped = true
    follow.stop()
    dispose?.()
  }
}

/**
 * 跟随状态：见过的会话、上一张在屏会话，以及待发的打开动作。
 * 停止后不再订阅、不再动作；宿主每次重新提供右栏服务都给一份新的。
 */
function createFollow(tabKind: string): {
  attach(sidebar: SidebarRightLike): () => void
  stop(): void
} {
  const seen = new Set<string>()
  const opener = createOpener(tabKind)
  let source: string | undefined
  let unsubscribe: (() => void) | undefined
  let warned = false
  let stopped = false

  const evaluate = (sidebar: SidebarRightLike): void => {
    if (stopped) return
    try {
      const mounted = sidebar.mounted.getSnapshot()
      if (mounted === undefined) return

      const tabs = inventoryOf(sidebar)
      if (tabs === undefined) {
        if (!warned) {
          warned = true
          console.warn(
            `[${PLUGIN_NAME}] sidebarRight has no tab inventory; cannot determine ownership, not following.`,
          )
        }
        return
      }

      const previous = source
      source = mounted
      if (seen.has(mounted)) return
      seen.add(mounted)
      if (previous === undefined) return
      if (!hasTab(tabs, previous, tabKind)) return
      if (hasTab(tabs, mounted, tabKind)) return
      opener.open(sidebar, mounted)
    } catch (error) {
      console.warn(`[${PLUGIN_NAME}] failed to read sidebarRight state; not following.`, error)
    }
  }

  const attach = (sidebar: SidebarRightLike): (() => void) => {
    evaluate(sidebar)
    try {
      unsubscribe = sidebar.mounted.subscribe(() => {
        evaluate(sidebar)
      })
    } catch (error) {
      console.warn(
        `[${PLUGIN_NAME}] failed to subscribe to sidebar session changes; panel follow is inactive.`,
        error,
      )
    }
    return stop
  }

  const stop = (): void => {
    if (stopped) return
    stopped = true
    opener.cancel()
    if (unsubscribe !== undefined) {
      unsubscribe()
      unsubscribe = undefined
    }
  }

  return { attach, stop }
}

/**
 * 打开动作：延后一轮宏任务，发出前复核目标会话仍在屏、页签仍缺，失败时有限次重试。
 * 每次尝试都重读宿主快照，等待期间用户自己关掉或切走都不会被覆盖。
 */
function createOpener(tabKind: string): {
  open(sidebar: SidebarRightLike, target: string): void
  cancel(): void
} {
  let timer: number | undefined
  let cancelled = false

  const attempt = (sidebar: SidebarRightLike, target: string, attemptsLeft: number): void => {
    timer = undefined
    if (cancelled) return
    try {
      if (sidebar.mounted.getSnapshot() !== target) return
      const tabs = inventoryOf(sidebar)
      if (tabs === undefined || hasTab(tabs, target, tabKind)) return
      sidebar.openTab(tabKind)
    } catch (error) {
      if (attemptsLeft > 1) {
        schedule(sidebar, target, attemptsLeft - 1)
        return
      }
      console.warn(`[${PLUGIN_NAME}] failed to open the MattWorkflow tab; not following.`, error)
    }
  }

  const schedule = (sidebar: SidebarRightLike, target: string, attemptsLeft: number): void => {
    if (cancelled || timer !== undefined) return
    timer = window.setTimeout(() => {
      attempt(sidebar, target, attemptsLeft)
    }, 0)
  }

  return {
    open: (sidebar, target) => {
      schedule(sidebar, target, OPEN_ATTEMPTS)
    },
    cancel: () => {
      cancelled = true
      if (timer !== undefined) {
        window.clearTimeout(timer)
        timer = undefined
      }
    },
  }
}

/** 读宿主的页签清单；清单缺失或形状不符时返回 `undefined`，调用方据此保守不动作。 */
function inventoryOf(sidebar: SidebarRightLike): readonly OpenTabLike[] | undefined {
  const store: unknown = sidebar.openTabs
  if (!isSnapshotStore(store)) return undefined
  const tabs = store.getSnapshot()
  return Array.isArray(tabs) ? (tabs as readonly OpenTabLike[]) : undefined
}

/** 清单只需要读快照：只校验 `getSnapshot`，不要求宿主再提供订阅。 */
function isSnapshotStore(value: unknown): value is { getSnapshot(): unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getSnapshot' in value &&
    typeof value.getSnapshot === 'function'
  )
}

function hasTab(tabs: readonly OpenTabLike[], sessionId: string, tabKind: string): boolean {
  return tabs.some((tab) => tab.sessionId === sessionId && tab.kind === tabKind)
}

/** 按本地自声明的最小形状探测宿主右栏服务；形状不符时按不可用处理。 */
function readSidebarRight(value: unknown): SidebarRightLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  if (!('mounted' in value) || !isObservable(value.mounted)) return undefined
  if (!('openTab' in value) || typeof value.openTab !== 'function') return undefined
  return value as unknown as SidebarRightLike
}

/** 宿主共享的只读快照都是这两个方法；缺少任一个就不猜它的语义。 */
function isObservable(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  return (
    'getSnapshot' in value &&
    typeof value.getSnapshot === 'function' &&
    'subscribe' in value &&
    typeof value.subscribe === 'function'
  )
}

/** 宿主 `inject` 返回 cordis fiber（有 `dispose`）；测试替身可能只给一个函数。 */
function disposerOf(handle: unknown): (() => void) | undefined {
  if (typeof handle === 'function') return handle as () => void
  if (typeof handle !== 'object' || handle === null) return undefined
  if (!('dispose' in handle) || typeof handle.dispose !== 'function') return undefined
  const fiber = handle as { dispose(): unknown }
  return () => {
    void fiber.dispose()
  }
}
