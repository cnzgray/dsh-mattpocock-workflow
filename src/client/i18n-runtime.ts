/**
 * 面板的翻译运行时：把中英两套词典注册进 DSH 的 locale 服务，
 * 取回该服务的绑定函数，并把“语言切换 / 词典晚到”的版本变化转成 React 可订阅的快照。
 *
 * 结构化的宿主动作（注册、绑定、取快照、订阅）在这里做能力探测；
 * 没有 locale 服务时退回内置中文词典，面板行为与接入前一致。
 * 组件不直接持有 DSH 服务，只通过 `I18nProvider` 拿同一个翻译入口。
 */
import { en, messages, zh, type MessageKey, type TranslateParams } from './messages.ts'

/** 一份命名空间词典：扁平键到模板字符串。 */
export type LocaleDict = Readonly<Record<string, string>>

/** locale 服务公开的快照；面板只读当前语言。 */
export interface LocaleSnapshotLike {
  readonly active: string
}

/**
 * DSH 客户端 locale 服务的结构化契约。
 * 只描述插件用到的四个动作，不 import 宿主运行时包，避免与宿主版本耦合。
 */
export interface LocaleServiceLike {
  /** 注册一个命名空间的词典（至少含中英基线，可带额外语言）；重复注册通常抛错。 */
  register(namespace: string, dictionaries: Readonly<Record<string, LocaleDict>>): () => void
  /** 绑定命名空间，返回按调用时语言解析的翻译函数；同一命名空间的引用稳定。 */
  bind(namespace: string): (key: string, params?: TranslateParams) => string
  /** 当前语言快照；稳定引用直到下一次变化。 */
  getSnapshot(): LocaleSnapshotLike
  /** 语言切换与词典注册都会通知；返回退订函数。 */
  subscribe(listener: () => void): () => void
}

/** 面板自己的命名空间：插件包名，不向 DSH 的 common 命名空间塞词。 */
export const MESSAGES_NAMESPACE = '@cnzgray/dsh-mattpocock-workflow'

/** 替换 `{name}` 占位符；没有对应参数时原样保留。 */
const PLACEHOLDER = /\{([A-Za-z0-9_.-]+)\}/g

export function interpolate(template: string, params?: TranslateParams): string {
  if (params === undefined) return template
  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = params[name]
    return value === undefined ? match : String(value)
  })
}

/** 翻译入口：键必须来自词典，参数按占位符替换。 */
export type Translate = (key: MessageKey, params?: TranslateParams) => string

function dictionaryTranslate(dictionary: Readonly<Record<string, string>>): Translate {
  const fallback = en as Readonly<Record<string, string>>
  return (key, params) => {
    const template = dictionary[key] ?? fallback[key] ?? key
    return interpolate(template, params)
  }
}

/** 没有 locale 服务时使用的中文入口，与接入前的界面文案一致。 */
export const builtinZhTranslate: Translate = dictionaryTranslate(zh)

/** locale 快照：语言变化或词典注册都会推进版本号。 */
export interface I18nSnapshot {
  readonly language: string
  readonly revision: number
}

/** 一次接入的结果：是否真的接上 locale 服务，以及随插件生命周期释放的入口。 */
export interface I18nAttachment {
  readonly attached: boolean
  dispose(): void
}

/** 翻译运行时；`t` 的引用稳定，内部按当前语言与当前服务解析。 */
export interface I18nRuntime {
  readonly t: Translate
  getSnapshot(): I18nSnapshot
  subscribe(listener: () => void): () => void
  attach(service: LocaleServiceLike | undefined): I18nAttachment
  dispose(): void
}

interface CurrentAttachment {
  readonly service: LocaleServiceLike
  readonly unregister: () => void
  readonly unsubscribe: () => void
}

interface RuntimeState {
  disposed: boolean
  current: CurrentAttachment | undefined
  translate: Translate
  language: string
  publish(): void
}

/** 撤销当前接入并回到内置中文；返回是否真的撤销了一份接入。 */
function detach(state: RuntimeState): boolean {
  if (state.current === undefined) return false
  const previous = state.current
  state.current = undefined
  state.translate = builtinZhTranslate
  state.language = 'zh'
  try {
    previous.unsubscribe()
  } catch {
    // 退订失败不影响降级：面板只用内置词典。
  }
  try {
    previous.unregister()
  } catch {
    // 释放失败同样不冒泡，插件生命周期继续。
  }
  state.publish()
  return true
}

/** 接入 locale 服务；失败时降级到内置中文，插件不失败。 */
function attachLocale(state: RuntimeState, service: LocaleServiceLike | undefined): I18nAttachment {
  const noop = (): void => undefined
  if (state.disposed || service === undefined) {
    detach(state)
    return { attached: false, dispose: noop }
  }

  detach(state)
  let unregister: (() => void) | undefined
  let unsubscribe: (() => void) | undefined
  try {
    unregister = service.register(MESSAGES_NAMESPACE, messages)
    unsubscribe = service.subscribe(() => {
      if (state.disposed || state.current?.service !== service) return
      state.language = service.getSnapshot().active
      state.publish()
    })
    const bound = service.bind(MESSAGES_NAMESPACE)
    state.language = service.getSnapshot().active
    state.current = { service, unregister, unsubscribe }
    state.translate = (key, params) => bound(key, params)
    state.publish()
  } catch {
    // 重复注册、契约不符或宿主版本不支持：降级到内置中文，插件不失败。
    try {
      unsubscribe?.()
    } catch {
      // 清理失败不冒泡。
    }
    try {
      unregister?.()
    } catch {
      // 清理失败不冒泡。
    }
    state.translate = builtinZhTranslate
    state.language = 'zh'
    state.publish()
    return { attached: false, dispose: noop }
  }

  return {
    attached: true,
    dispose: () => {
      if (state.current?.service !== service) return
      detach(state)
    },
  }
}

/**
 * 创建翻译运行时。
 * @returns 默认用内置中文；`attach` 成功后改用 DSH 的绑定函数。
 */
export function createI18nRuntime(): I18nRuntime {
  const listeners = new Set<() => void>()
  let revision = 0
  let snapshot: I18nSnapshot = { language: 'zh', revision }
  const state: RuntimeState = {
    disposed: false,
    current: undefined,
    translate: builtinZhTranslate,
    language: 'zh',
    publish: () => {
      revision += 1
      snapshot = { language: state.language, revision }
      for (const listener of [...listeners]) listener()
    },
  }
  const t: Translate = (key, params) => state.translate(key, params)

  return {
    t,
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    attach: (service) => attachLocale(state, service),
    dispose: () => {
      if (state.disposed) return
      state.disposed = true
      detach(state)
      listeners.clear()
    },
  }
}

/**
 * 按本地声明的最小形状探测 DSH 的 locale 服务。
 * 缺任一动作时按不可用处理，由调用方退回内置词典。
 * @param value - `ctx.get('locale')` 的原始值。
 * @returns 可用的结构化服务，或 undefined。
 */
export function readLocaleService(value: unknown): LocaleServiceLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  for (const method of ['register', 'bind', 'getSnapshot', 'subscribe'] as const) {
    if (typeof candidate[method] !== 'function') return undefined
  }
  return value as unknown as LocaleServiceLike
}
