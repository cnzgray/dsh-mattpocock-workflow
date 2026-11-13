/**
 * 把工单正文与评论里的 Markdown 渲染成 React 元素。
 *
 * 只渲染不改写：原文原样交给解析器，不做任何替换。工单内容来自远端，按不可信输入处理：
 * 不解析原始 HTML（`<script>`、`<img onerror>` 等都按文字显示），链接与图片地址走库自带的
 * 地址过滤（拦掉 `javascript:` 这类协议），链接一律在新窗口打开，不在面板里跳转。
 */
import { compiler } from 'markdown-to-jsx/react'
import * as React from 'react'

import { MARKDOWN_ATTRIBUTE } from './task-panel-styles.ts'

/** 渲染一段 Markdown；元素样式由面板样式表按 `data-markdown` 统一提供。 */
export function MarkdownBody(props: {
  readonly source: string
  readonly testId?: string
}): React.ReactElement {
  const content = React.useMemo(
    () =>
      compiler(props.source, {
        disableParsingRawHTML: true,
        forceBlock: true,
        wrapper: React.Fragment,
        overrides: { a: { component: ExternalLink } },
      }),
    [props.source],
  )

  return (
    <div data-testid={props.testId} {...{ [MARKDOWN_ATTRIBUTE]: '' }}>
      {content}
    </div>
  )
}

function ExternalLink(props: React.AnchorHTMLAttributes<HTMLAnchorElement>): React.ReactElement {
  return <a {...props} target="_blank" rel="noopener noreferrer" />
}
