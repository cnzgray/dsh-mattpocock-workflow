/**
 * 提示词注入的界面状态：按目标分派、把三态结果翻译成提示。
 * 列表与工单详情共用这一份；环境检查的会话动作只填当前会话，直接读注入端口。
 */
import * as React from 'react'

import {
  NO_NEW_SESSION,
  type InjectionOutcome,
  type InjectionTarget,
  type PromptInjection,
} from './injection.ts'

/** 注入反馈的色调：成功与「已请求」是信息，失败才告警。 */
export type NoticeTone = 'info' | 'error'

/** 注入入口与当前提示。 */
export interface DraftInjection {
  /** 最近一次注入的反馈；null 表示还没注入过。 */
  readonly notice: string | null
  readonly noticeTone: NoticeTone | null
  /** 按目标注入；返回宿主的处理结果。 */
  readonly inject: (text: string, target: InjectionTarget) => InjectionOutcome
}

/**
 * 维护提示词注入的提示状态。
 * @param injection - 面板的注入端口：两项能力与按目标分派的注入。
 * @returns 按目标注入的入口与当前提示。
 */
export function useDraftInjection(injection: PromptInjection): DraftInjection {
  const [notice, setNotice] = React.useState<string | null>(null)
  const [noticeTone, setNoticeTone] = React.useState<NoticeTone | null>(null)

  const inject = (text: string, target: InjectionTarget): InjectionOutcome => {
    const outcome = injection.inject(text, target)
    setNotice(injectionNotice(outcome, target))
    setNoticeTone(outcome === 'unavailable' ? 'error' : 'info')
    return outcome
  }

  return { notice, noticeTone, inject }
}

/**
 * 三态结果对应的反馈；「已请求」明确说成还没完成。
 * @param outcome - 注入结果。
 * @param target - 本次注入的目标会话。
 * @returns 要显示的提示。
 */
function injectionNotice(outcome: InjectionOutcome, target: InjectionTarget): string | null {
  switch (outcome) {
    case 'filled':
      return '提示词已填入当前会话的输入框。'
    case 'requested':
      return '已请求在新会话填入提示词，请到新会话确认后发送。'
    case 'unavailable':
      return target === 'new-session'
        ? `${NO_NEW_SESSION}，未能开启新会话。`
        : '没有找到当前会话的输入框，未能填入提示词。'
  }
}
