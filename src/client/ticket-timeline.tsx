/**
 * 详情的时间线：正文是第一张卡片，评论按时间依次排在后面，卡片之间用一段竖线相连。
 *
 * 卡片头部是头像、作者和时间；工单作者自己的评论头部带强调色浅底和“作者”徽标，
 * 和 GitHub issue 页的读法一致。正文与评论都按 Markdown 渲染。
 */
import * as React from 'react'

import type { TicketComment, TicketDetail } from '../protocol/tracker.ts'
import { useI18n } from './i18n.tsx'
import type { AttachmentLoader } from './attachment-loader.ts'
import { MarkdownBody, type MarkdownAttachments } from './markdown-body.tsx'
import {
  TIMELINE_AUTHOR_BADGE_STYLE,
  TIMELINE_CARD_AUTHOR_HEADER_STYLE,
  TIMELINE_CARD_BODY_STYLE,
  TIMELINE_CARD_HEADER_STYLE,
  TIMELINE_CARD_STYLE,
  TIMELINE_CONNECTOR_STYLE,
  TIMELINE_EMPTY_STYLE,
  TIMELINE_NAME_STYLE,
  TIMELINE_STYLE,
  TIMELINE_TIME_STYLE,
} from './ticket-timeline-styles.ts'
import { Avatar } from './ticket-visuals.tsx'

/** 正文卡片加全部评论。 */
export function Timeline(props: {
  readonly detail: TicketDetail
  /** 正文与评论里后端上传图片的取图函数；详情没有补全前缀时不使用。 */
  readonly loadAttachment?: AttachmentLoader | undefined
}): React.ReactElement {
  const { t } = useI18n()
  const { detail, loadAttachment } = props
  const attachments = React.useMemo<MarkdownAttachments | null>(
    () =>
      detail.uploadsBaseUrl === null || loadAttachment === undefined
        ? null
        : { baseUrl: detail.uploadsBaseUrl, load: loadAttachment },
    [detail.uploadsBaseUrl, loadAttachment],
  )
  const count = detail.comments.length

  return (
    <div style={TIMELINE_STYLE}>
      <TimelineCard
        testId="detail-body-section"
        authorTestId="detail-author"
        author={detail.author}
        verb={t('detail.verb.created')}
        time={detail.createdAt}
        isTicketAuthor={false}
        ariaLabel={t('detail.bodyLabel')}
      >
        {detail.body.trim().length === 0 ? (
          <div data-testid="detail-no-body" style={TIMELINE_EMPTY_STYLE}>
            {t('detail.noBody')}
          </div>
        ) : (
          <MarkdownBody testId="detail-body" source={detail.body} attachments={attachments} />
        )}
      </TimelineCard>
      <section data-testid="detail-comments" aria-label={t('detail.commentsAria', { count })}>
        {count === 0 ? (
          <>
            <div style={TIMELINE_CONNECTOR_STYLE} />
            <div data-testid="detail-no-comments" style={TIMELINE_EMPTY_STYLE}>
              {t('detail.noComments')}
            </div>
          </>
        ) : (
          detail.comments.map((comment, index) => (
            <CommentCard
              key={`${comment.author ?? ''}:${comment.createdAt ?? ''}:${String(index)}`}
              comment={comment}
              ticketAuthor={detail.author}
              attachments={attachments}
            />
          ))
        )}
      </section>
    </div>
  )
}

function CommentCard(props: {
  readonly comment: TicketComment
  readonly ticketAuthor: string | null
  readonly attachments: MarkdownAttachments | null
}): React.ReactElement {
  const { t } = useI18n()
  const { comment } = props
  return (
    <>
      <div style={TIMELINE_CONNECTOR_STYLE} />
      <TimelineCard
        testId="detail-comment"
        authorTestId="comment-author"
        author={comment.author}
        verb={t('detail.verb.commented')}
        time={comment.createdAt}
        isTicketAuthor={comment.author !== null && comment.author === props.ticketAuthor}
        ariaLabel={t('detail.commentBy', { author: comment.author ?? t('detail.unsigned') })}
      >
        <MarkdownBody source={comment.body} attachments={props.attachments} />
      </TimelineCard>
    </>
  )
}

function TimelineCard(props: {
  readonly testId: string
  readonly authorTestId: string
  readonly author: string | null
  readonly verb: string
  readonly time: string | null
  readonly isTicketAuthor: boolean
  readonly ariaLabel: string
  readonly children: React.ReactNode
}): React.ReactElement {
  const { t } = useI18n()
  const header = props.isTicketAuthor
    ? { ...TIMELINE_CARD_HEADER_STYLE, ...TIMELINE_CARD_AUTHOR_HEADER_STYLE }
    : TIMELINE_CARD_HEADER_STYLE

  return (
    <article data-testid={props.testId} aria-label={props.ariaLabel} style={TIMELINE_CARD_STYLE}>
      <header style={header}>
        <Avatar name={props.author} />
        <span data-testid={props.authorTestId} style={TIMELINE_TIME_STYLE}>
          <span style={TIMELINE_NAME_STYLE}>{props.author ?? t('detail.unsigned')}</span>
          {props.time === null ? '' : ` ${props.verb} ${formatTime(props.time)}`}
        </span>
        {props.isTicketAuthor ? (
          <span data-testid="author-badge" style={TIMELINE_AUTHOR_BADGE_STYLE}>
            {t('detail.author')}
          </span>
        ) : null}
      </header>
      <div style={TIMELINE_CARD_BODY_STYLE}>{props.children}</div>
    </article>
  )
}

/**
 * 把 ISO 时间截成 `YYYY-MM-DD HH:mm`；不是 ISO 格式时原样返回。
 * @param value - 后端给的时间字符串。
 * @returns 显示用的时间。
 */
export function formatTime(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value)
  return match === null ? value : `${match[1] ?? ''} ${match[2] ?? ''}`
}
