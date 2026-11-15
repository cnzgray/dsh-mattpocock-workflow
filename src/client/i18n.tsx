/**
 * React 侧的翻译入口：Provider 订阅运行时快照，语言切换或词典晚到时整棵面板子树重渲染。
 * 没有 Provider 时组件拿到内置中文，既有组件测试与老宿主上的行为都保持不变。
 */
import * as React from 'react'

import {
  builtinZhTranslate,
  type I18nRuntime,
  type I18nSnapshot,
  type Translate,
} from './i18n-runtime.ts'

/** 组件拿到的翻译视图：稳定的取词入口、当前语言与词典版本。 */
export interface I18nValue {
  readonly t: Translate
  readonly language: string
  /** 词典注册或语言变化都会推进；用于让已渲染的子树跟着重算。 */
  readonly revision: number
}

const FALLBACK: I18nValue = { t: builtinZhTranslate, language: 'zh', revision: 0 }

const I18nContext = React.createContext<I18nValue>(FALLBACK)

/**
 * 提供面板的翻译入口。
 * @param props - 运行时与子树。
 * @returns 带上下文的子树。
 */
export function I18nProvider(props: {
  readonly i18n: I18nRuntime
  readonly children: React.ReactNode
}): React.ReactElement {
  const subscribe = React.useCallback(
    (listener: () => void) => props.i18n.subscribe(listener),
    [props.i18n],
  )
  const getSnapshot = React.useCallback(() => props.i18n.getSnapshot(), [props.i18n])
  const snapshot: I18nSnapshot = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const value = React.useMemo<I18nValue>(
    () => ({ t: props.i18n.t, language: snapshot.language, revision: snapshot.revision }),
    [props.i18n, snapshot],
  )

  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>
}

/**
 * 取当前翻译入口。
 * @returns 稳定的 `t` 与当前语言；没有 Provider 时是内置中文。
 */
export function useI18n(): I18nValue {
  return React.useContext(I18nContext)
}
