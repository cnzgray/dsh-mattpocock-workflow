/**
 * 注入端口的测试夹具：默认两项能力都可用、注入即「填好了」。
 * 需要记录调用时把 `inject` 换成 spy；需要降级时把对应能力置为 false。
 */
import type { InjectionOutcome, InjectionTarget, PromptInjection } from './injection.ts'

export function fakeInjection(
  options: {
    readonly canInjectCurrent?: boolean
    readonly canStartNewSession?: boolean
    readonly inject?: (text: string, target: InjectionTarget) => InjectionOutcome
  } = {},
): PromptInjection {
  return {
    canInjectCurrent: options.canInjectCurrent ?? true,
    canStartNewSession: options.canStartNewSession ?? true,
    inject: options.inject ?? (() => 'filled'),
  }
}
