/**
 * 提示词注入的目标与结果。目标只有两支，界面按它分派而不是拼布尔开关；
 * 目标类型只在客户端内部流转，不进入宿主协议。
 *
 * 新会话由宿主的工作区导航能力创建，面板只负责把同一段提示词交过去，
 * 因此结果只能诚实地说「已请求」，不能说「已完成」。
 */

/** 宿主缺新建会话能力时的原因；悬停说明与反馈文案共用。 */
export const NO_NEW_SESSION = '宿主未提供新建会话能力'

/** 提示词要送去的会话。 */
export type InjectionTarget = 'current-session' | 'new-session'

/** 一次注入的结果。 */
export type InjectionOutcome =
  /** 已经写进当前会话的输入框。 */
  | 'filled'
  /** 宿主缺能力或找不到输入框，什么都没写。 */
  | 'unavailable'
  /** 新会话请求已交给宿主，是否建成由宿主负责。 */
  | 'requested'

/** 面板的注入入口。两项能力各自独立，主键的可用性不依赖新会话能力。 */
export interface PromptInjection {
  /** 当前会话的输入框可写。 */
  readonly canInjectCurrent: boolean
  /** 宿主提供「开新会话并准备初始提示词」的能力。 */
  readonly canStartNewSession: boolean
  /**
   * 按目标注入提示词。
   * @param text - 提示词；两条路径共用同一段文本。
   * @param target - 当前会话或新会话。
   * @returns 三态结果，界面据此给不同反馈。
   */
  inject(text: string, target: InjectionTarget): InjectionOutcome
}
