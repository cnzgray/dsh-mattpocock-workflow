/**
 * 工单的技能动作注入状态：列表行与详情头部的技能徽标共用。
 * 点击工单行只打开详情；把提示词填入输入框只由技能徽标和操作栏触发，
 * 这里记录最近一次注入的票，供界面区分“已填入”。
 */
import * as React from 'react'

import type { TicketSnapshot } from '../protocol/tracker.ts'
import { ticketPrompt } from './prompts.ts'
import { useDraftInjection } from './use-draft-injection.ts'

/** 列表视图需要的注入状态与回调。 */
export interface TicketActionsState {
  readonly injected: string | null
  readonly notice: string | null
  readonly inject: (text: string) => void
  readonly onSkillAction: (ticket: TicketSnapshot) => void
}

/**
 * 管理工单行的提示词注入。
 * @param workspaceRoot - 工作区变化时清空注入标记。
 * @param canInject - 当前是否有可用会话。
 * @param injectDraft - 把文本写进会话输入框；返回是否成功。
 * @returns 状态与回调。
 */
export function useTicketActions(
  workspaceRoot: string | undefined,
  canInject: boolean,
  injectDraft: (text: string) => boolean,
): TicketActionsState {
  const [injected, setInjected] = React.useState<string | null>(null)
  const { notice, inject } = useDraftInjection(canInject, injectDraft)

  React.useEffect(() => {
    setInjected(null)
  }, [workspaceRoot])

  // “新建需求”“+ bug”写的是另一段开场白，输入框里不再是那张票的提示词。
  const injectStandalone = (text: string): void => {
    setInjected(null)
    inject(text)
  }

  const onSkillAction = (ticket: TicketSnapshot): void => {
    const prompt = ticketPrompt(ticket)
    if (prompt === null) return
    if (inject(prompt)) setInjected(ticket.ref)
  }

  return { injected, notice, inject: injectStandalone, onSkillAction }
}
