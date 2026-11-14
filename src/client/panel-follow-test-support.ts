/**
 * 右栏服务的测试夹具：可推进的在屏会话与页签清单，记录 openTab 调用。
 * 面板跟随的模块测试与入口测试共用这一份假件。
 */

/** 清单里的一行：哪个会话开着哪个类型的页签。 */
export interface FakeOpenTab {
  readonly sessionId: string
  readonly kind: string
}

/** 假的宿主右栏：`service` 挂到假作用域上，其余方法驱动它。 */
export interface FakeRightColumn {
  /** 与宿主同形的服务对象；关掉清单时只有 `mounted` 与 `openTab`。 */
  readonly service: unknown
  /** 宿主收到的 openTab 调用，按发生顺序。 */
  readonly opens: readonly string[]
  show(sessionId: string | undefined): void
  setTabs(tabs: readonly FakeOpenTab[]): void
}

/**
 * 创建假右栏服务。
 * @param options - 初始在屏会话、是否提供页签清单、openTab 是否抛宿主错误。
 * @returns 服务对象与驱动它的方法。
 */
export function createFakeRightColumn(
  options: {
    readonly mounted?: string
    readonly withOpenTabs?: boolean
    readonly openTabThrows?: boolean
    readonly mountedThrows?: boolean
  } = {},
): FakeRightColumn {
  const opens: string[] = []
  const mounted = createObservable<string | undefined>(
    options.mounted,
    options.mountedThrows === true,
  )
  const openTabs = createObservable<readonly FakeOpenTab[]>([])

  const service: Record<string, unknown> = {
    mounted,
    openTab: (kind: string) => {
      opens.push(kind)
      if (options.openTabThrows === true) throw new Error('no session surface is mounted')
    },
  }
  if (options.withOpenTabs !== false) service.openTabs = openTabs

  return {
    service,
    opens,
    show: (sessionId) => {
      mounted.set(sessionId)
    },
    setTabs: (tabs) => {
      openTabs.set(tabs)
    },
  }
}

/** 宿主共享的只读快照：取值加变化通知；`broken` 让读取抛错，验证调用方的降级。 */
function createObservable<T>(
  initial: T,
  broken = false,
): {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
  set(next: T): void
} {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => {
      if (broken) throw new Error('host read failed')
      return value
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set: (next) => {
      value = next
      for (const listener of listeners) listener()
    },
  }
}
