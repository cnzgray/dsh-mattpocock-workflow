/**
 * 测试替身：按 DSH locale 服务的结构化契约提供注册、绑定、快照与订阅。
 * 只实现面板用到的四个动作，词典查找带英文回退。
 */
import { interpolate, type LocaleDict, type LocaleServiceLike } from './i18n-runtime.ts'
import type { TranslateParams } from './messages.ts'

interface Registration {
  readonly namespace: string
  readonly dictionaries: Readonly<Record<string, LocaleDict>>
}

/** 假 locale 服务：可切换语言、触发订阅，并记录注册与退订。 */
export interface FakeLocaleService {
  readonly service: LocaleServiceLike
  setActive(id: string): void
  setFailRegister(fail: boolean): void
  readonly registration: Registration | null
  readonly listeners: number
}

/**
 * 创建假 locale 服务。
 * @param active - 初始语言。
 * @returns 服务本体与测试控制面。
 */
export function createFakeLocaleService(active = 'en'): FakeLocaleService {
  let current = active
  let registration: Registration | null = null
  let failRegister = false
  const listeners = new Set<() => void>()

  const lookup = (namespace: string, key: string, params?: TranslateParams): string => {
    if (registration?.namespace !== namespace) return key
    const dictionaries = registration.dictionaries as unknown as Readonly<
      Record<string, LocaleDict | undefined>
    >
    const template = dictionaries[current]?.[key] ?? dictionaries.en?.[key] ?? key
    return interpolate(template, params)
  }

  const service: LocaleServiceLike = {
    register(namespace, dictionaries) {
      if (failRegister) throw new Error('registration failed')
      if (registration !== null) throw new Error('duplicate registration')
      registration = { namespace, dictionaries }
      return () => {
        registration = null
      }
    },
    bind: (namespace) => (key, params) => lookup(namespace, key, params),
    getSnapshot: () => ({ active: current }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }

  return {
    service,
    setActive(id) {
      current = id
      for (const listener of [...listeners]) listener()
    },
    setFailRegister(fail) {
      failRegister = fail
    },
    get registration() {
      return registration
    },
    get listeners() {
      return listeners.size
    },
  }
}
