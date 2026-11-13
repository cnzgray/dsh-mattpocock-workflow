/**
 * 列表视图的选中与注入状态。点击工单行只选中，点击技能徽标才把提示词填入输入框；
 * 这里同时记录最近一次注入的票，供界面区分“选中”和“已填入”。
 */
import * as React from 'react'

import type { TicketSnapshot } from '../protocol/tracker.ts'
import { ticketPrompt } from './prompts.ts'

/** 列表视图需要的选中、注入状态与回调。 */
export interface TicketActionsState {
  readonly selected: string | null
  readonly injected: string | null
  readonly notice: string | null
  readonly inject: (text: string) => boolean
  readonly onPick: (ticket: TicketSnapshot) => void
  readonly onSkillAction: (ticket: TicketSnapshot) => void
}

/**
 * 管理工单选中与提示词注入。
 * @param workspaceRoot - 工作区变化时清空选中与注入标记。
 * @param injectDraft - 把文本写进会话输入框；返回是否成功。
 * @returns 状态与回调。
 */
export function useTicketActions(
  workspaceRoot: string | undefined,
  injectDraft: (text: string) => boolean,
): TicketActionsState {
  const [selected, setSelected] = React.useState<string | null>(null)
  const [injected, setInjected] = React.useState<string | null>(null)
  const { notice, inject } = useDraftInjection(injectDraft)

  React.useEffect(() => {
    setSelected(null)
    setInjected(null)
  }, [workspaceRoot])

  const onPick = (ticket: TicketSnapshot): void => {
    setSelected(ticket.ref)
  }

  const onSkillAction = (ticket: TicketSnapshot): void => {
    setSelected(ticket.ref)
    const prompt = ticketPrompt(ticket)
    if (prompt === null) return
    if (inject(prompt)) setInjected(ticket.ref)
  }

  // “新建需求”“+ bug”写的是另一段开场白，输入框里不再是那张票的提示词。
  const injectStandalone = (text: string): boolean => {
    setInjected(null)
    return inject(text)
  }

  return {
    selected,
    injected,
    notice,
    inject: injectStandalone,
    onPick,
    onSkillAction,
  }
}

function useDraftInjection(injectDraft: (text: string) => boolean): {
  readonly notice: string | null
  readonly inject: (text: string) => boolean
} {
  const [notice, setNotice] = React.useState<string | null>(null)

  const inject = (text: string): boolean => {
    const filled = injectDraft(text)
    setNotice(filled ? null : '没有找到当前会话的输入框，未能填入提示词。')
    return filled
  }

  return { notice, inject }
}
