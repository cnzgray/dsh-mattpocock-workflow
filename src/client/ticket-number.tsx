/**
 * 工单行左侧的编号。远端工单点编号复制网页地址，不打开详情；
 * 本地 Markdown 没有网页地址，编号只是展示，点击和行其余部分一样打开详情。
 */
import * as React from 'react'

import type { TicketSnapshot } from '../protocol/tracker.ts'
import { CheckIcon } from './icons.tsx'
import { useI18n } from './i18n.tsx'
import { COLORS } from './task-panel-styles.ts'
import {
  LOCAL_REF_STYLE,
  NUMBER_BADGE_STYLE,
  NUMBER_BUTTON_STYLE,
  NUMBER_MARK_STYLE,
} from './ticket-row-styles.ts'
import { useCopyLink } from './ticket-detail-hooks.ts'
import { VISUALLY_HIDDEN_STYLE } from './ticket-detail-styles.ts'

/** 本地 Markdown 路径在卡片里的显示上限；再长就从中间截断。 */
const REF_DISPLAY_LIMIT = 40

/**
 * 渲染一张票的编号。
 * @param props - 工单。
 * @returns 可复制的编号按钮，或没有网页地址时的纯文本。
 */
export function TicketNumber(props: { readonly ticket: TicketSnapshot }): React.ReactElement {
  const { ticket } = props
  const url = ticket.url ?? null

  if (url === null || ticket.number === null) {
    const display = refDisplay(ticket)
    return (
      <span
        data-testid="ticket-ref"
        style={ticket.number === null ? LOCAL_REF_STYLE : NUMBER_BADGE_STYLE}
        {...(display.full === undefined ? {} : { title: display.full })}
      >
        {ticket.number === null ? display.text : <NumberText number={ticket.number} />}
      </span>
    )
  }

  return <CopyableNumber number={ticket.number} url={url} />
}

function CopyableNumber(props: {
  readonly number: number
  readonly url: string
}): React.ReactElement {
  const { t } = useI18n()
  const { copy, onCopy } = useCopyLink(props.url, t)
  const copied = copy.status === 'copied'
  const failed = copy.status === 'failed'
  const color = copied ? COLORS.success : failed ? COLORS.error : undefined

  return (
    <>
      <button
        type="button"
        data-testid="ticket-ref"
        data-hover="link"
        data-copy={copy.status}
        aria-label={t('ticket.number.copyAria', { number: props.number })}
        title={
          copied
            ? t('ticket.number.copiedTitle')
            : failed
              ? (copy.message ?? t('ticket.number.copyFailed'))
              : t('ticket.number.copyTitle', { url: props.url })
        }
        onClick={(event) => {
          // 行容器上挂着“打开详情”，点编号只复制。
          event.stopPropagation()
          onCopy()
        }}
        style={color === undefined ? NUMBER_BUTTON_STYLE : { ...NUMBER_BUTTON_STYLE, color }}
      >
        <NumberText number={props.number} copied={copied} />
      </button>
      {copied ? (
        <span role="status" style={VISUALLY_HIDDEN_STYLE}>
          {t('ticket.number.copiedNotice')}
        </span>
      ) : null}
    </>
  )
}

function NumberText(props: {
  readonly number: number
  readonly copied?: boolean
}): React.ReactElement {
  return (
    <>
      <span style={NUMBER_MARK_STYLE}>{props.copied === true ? <CheckIcon /> : '#'}</span>
      {String(props.number)}
    </>
  )
}

function refDisplay(ticket: TicketSnapshot): { readonly text: string; readonly full?: string } {
  if (ticket.ref.length <= REF_DISPLAY_LIMIT) return { text: ticket.ref }

  const head = Math.ceil((REF_DISPLAY_LIMIT - 1) / 2)
  const tail = REF_DISPLAY_LIMIT - 1 - head
  return {
    text: `${ticket.ref.slice(0, head)}…${ticket.ref.slice(ticket.ref.length - tail)}`,
    full: ticket.ref,
  }
}
