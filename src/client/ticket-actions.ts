/**
 * 工单的技能动作注入状态：列表行与详情头部的技能徽标共用。
 * 点击工单行只打开详情；把提示词填入输入框只由技能徽标和操作栏触发，
 * 这里记录最近一次填进当前会话的票，供界面区分“已填入”。
 * 新会话注入不碰当前会话的输入框，因此不改变这个标记。
 */
import * as React from 'react'

import type { TicketSnapshot } from '../protocol/tracker.ts'
import type { InjectionTarget, PromptInjection } from './injection.ts'
import { ticketPrompt } from './prompts.ts'
import { useDraftInjection, type NoticeTone } from './use-draft-injection.ts'

/** 列表视图需要的注入状态与回调。 */
export interface TicketActionsState {
  readonly injected: string | null
  readonly notice: string | null
  readonly noticeTone: NoticeTone | null
  readonly inject: (text: string, target: InjectionTarget) => void
  readonly onSkillAction: (ticket: TicketSnapshot, target: InjectionTarget) => void
}

/**
 * 管理工单行的提示词注入。
 * @param workspaceRoot - 工作区变化时清空注入标记。
 * @param injection - 面板的注入端口。
 * @returns 状态与回调。
 */
export function useTicketActions(
  workspaceRoot: string | undefined,
  injection: PromptInjection,
): TicketActionsState {
  const [injected, setInjected] = React.useState<string | null>(null)
  const { notice, noticeTone, inject: injectPrompt } = useDraftInjection(injection)

  React.useEffect(() => {
    setInjected(null)
  }, [workspaceRoot])

  // 往当前会话写入另一段开场白后，输入框里不再是那张票的提示词；
  // 新会话注入不动当前输入框，原来的标记要留住。
  const inject = (text: string, target: InjectionTarget): void => {
    if (target === 'current-session') setInjected(null)
    injectPrompt(text, target)
  }

  const onSkillAction = (ticket: TicketSnapshot, target: InjectionTarget): void => {
    const prompt = ticketPrompt(ticket)
    if (prompt === null) return
    const outcome = injectPrompt(prompt, target)
    if (target === 'current-session' && outcome === 'filled') setInjected(ticket.ref)
  }

  return { injected, notice, noticeTone, inject, onSkillAction }
}
