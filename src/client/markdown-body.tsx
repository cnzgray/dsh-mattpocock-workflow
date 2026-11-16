/**
 * 把工单正文与评论里的 Markdown 渲染成 React 元素。
 *
 * 只渲染不改写：原文原样交给解析器，不做任何替换。工单内容来自远端，按不可信输入处理：
 * 不解析原始 HTML（`<script>`、`<img onerror>` 等都按文字显示），链接与图片地址走库自带的
 * 地址过滤（拦掉 `javascript:` 这类协议），链接一律在新窗口打开，不在面板里跳转。
 *
 * GitLab 把拖进正文的附件写成根相对地址 `/uploads/<secret>/<filename>`，网页端按项目补成
 * `/-/project/<id>/uploads/...`。面板不在 GitLab 的源上，根相对地址会落到面板自己的 origin
 * 上；私有项目的附件还要登录才能取，`<img>` 带不上 GitLab 会话。所以：
 * - 链接按详情的 `uploadsBaseUrl` 补成绝对地址，点开走浏览器里的 GitLab 登录态；
 * - 图片交给宿主用已登录的 CLI 取回字节，以 data URL 显示；取不到时显示文件名，
 *   并链到 GitLab 原地址，不出现裸破图。
 * 只有带 `uploadsBaseUrl` 的详情（目前只有 GitLab）才走这条路，其他后端原样渲染。
 */
import { compiler } from 'markdown-to-jsx/react'
import * as React from 'react'

import { ATTACHMENT_PATH_PREFIX } from '../protocol/tracker.ts'
import type { AttachmentLoader } from './attachment-loader.ts'
import { useI18n } from './i18n.tsx'
import { MARKDOWN_ATTRIBUTE } from './task-panel-styles.ts'

/** 后端上传附件：补全前缀与取图函数，由详情视图按当前工作区提供。 */
export interface MarkdownAttachments {
  /** 根相对 `/uploads/` 地址的补全前缀（含结尾 `/uploads/`）。 */
  readonly baseUrl: string
  readonly load: AttachmentLoader
}

/** 渲染一段 Markdown；元素样式由面板样式表按 `data-markdown` 统一提供。 */
export function MarkdownBody(props: {
  readonly source: string
  readonly testId?: string
  /** 后端上传附件的处理方式；省略或 null 时地址保持原样。 */
  readonly attachments?: MarkdownAttachments | null | undefined
}): React.ReactElement {
  const attachments = props.attachments ?? null
  const content = React.useMemo(() => {
    const overrides =
      attachments === null
        ? { a: { component: ExternalLink } }
        : {
            a: {
              component: (attributes: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
                <ExternalLink
                  {...attributes}
                  href={absoluteUpload(attachments.baseUrl, attributes.href)}
                />
              ),
            },
            img: {
              component: (attributes: React.ImgHTMLAttributes<HTMLImageElement>) => (
                <UploadImage {...attributes} attachments={attachments} />
              ),
            },
          }
    return compiler(props.source, {
      disableParsingRawHTML: true,
      forceBlock: true,
      wrapper: React.Fragment,
      overrides,
    })
  }, [attachments, props.source])

  return (
    <div data-testid={props.testId} {...{ [MARKDOWN_ATTRIBUTE]: '' }}>
      {content}
    </div>
  )
}

/**
 * 把正文里的附件地址归一成根相对的 `/uploads/...`：根相对形式原样返回，
 * 已经补全成本项目绝对地址的形式去掉前缀；其他地址返回 null，不交给宿主。
 */
function uploadPathOf(baseUrl: string, src: string | undefined): string | null {
  if (src === undefined) return null
  if (src.startsWith(ATTACHMENT_PATH_PREFIX)) return src
  if (src.startsWith(baseUrl)) return `${ATTACHMENT_PATH_PREFIX}${src.slice(baseUrl.length)}`
  return null
}

function absoluteUpload(baseUrl: string, url: string | undefined): string | undefined {
  return url?.startsWith(ATTACHMENT_PATH_PREFIX) === true
    ? `${baseUrl}${url.slice(ATTACHMENT_PATH_PREFIX.length)}`
    : url
}

/** 附件图片：取图中显示文件名占位，成功换成 data URL，失败显示文件名并链到原地址。 */
function UploadImage(
  props: React.ImgHTMLAttributes<HTMLImageElement> & {
    readonly attachments: MarkdownAttachments
  },
): React.ReactElement {
  const { attachments, ...attributes } = props
  const { t } = useI18n()
  const path = uploadPathOf(attachments.baseUrl, attributes.src)
  const [loaded, setLoaded] = React.useState<{
    readonly path: string
    readonly url: string | null
  } | null>(null)

  React.useEffect(() => {
    if (path === null) return undefined
    let active = true
    void attachments.load(path).then((url) => {
      if (active) setLoaded({ path, url })
    })
    return () => {
      active = false
    }
  }, [attachments, path])

  // 不是本项目的附件：按普通图片原样渲染（外链图床等不代理）。
  if (path === null) return <img {...attributes} />

  const name =
    attributes.alt !== undefined && attributes.alt.length > 0 ? attributes.alt : fileName(path)
  const state = loaded?.path === path ? loaded : null
  if (state === null) {
    return (
      <span data-attachment="loading" role="img" aria-label={name}>
        {t('detail.attachment.loading', { name })}
      </span>
    )
  }
  if (state.url !== null) {
    return <img {...attributes} src={state.url} alt={name} data-attachment="loaded" />
  }
  return (
    <ExternalLink
      data-attachment="failed"
      href={`${attachments.baseUrl}${path.slice(ATTACHMENT_PATH_PREFIX.length)}`}
    >
      {t('detail.attachment.failed', { name })}
    </ExternalLink>
  )
}

function fileName(path: string): string {
  const last = path.slice(path.lastIndexOf('/') + 1)
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

function ExternalLink(props: React.AnchorHTMLAttributes<HTMLAnchorElement>): React.ReactElement {
  return <a {...props} target="_blank" rel="noopener noreferrer" />
}
