/**
 * 提示词注入的界面状态：能不能注入、失败时给什么提示。
 * 列表的操作栏与详情视图共用这一份，两处的失败文案不会各写一遍。
 */
import * as React from 'react'

/** 注入入口与当前提示。 */
export interface DraftInjection {
  /** 失败或不适用时的提示；null 表示没有提示。 */
  readonly notice: string | null
  /** 填入提示词；返回是否真的写进了输入框。没有可用会话时只更新提示。 */
  readonly inject: (text: string) => boolean
}

/**
 * 维护提示词注入的提示状态。
 * @param canInject - 当前是否有可用会话。
 * @param injectDraft - 往会话输入框写文本；返回是否成功。
 * @returns 注入入口与当前提示。
 */
export function useDraftInjection(
  canInject: boolean,
  injectDraft: (text: string) => boolean,
): DraftInjection {
  const [notice, setNotice] = React.useState<string | null>(null)

  const inject = (text: string): boolean => {
    if (!canInject) {
      setNotice('当前没有可用会话，无法填入提示词。')
      return false
    }
    const filled = injectDraft(text)
    setNotice(filled ? null : '没有找到当前会话的输入框，未能填入提示词。')
    return filled
  }

  return { notice, inject }
}
