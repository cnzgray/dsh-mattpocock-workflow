import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import * as React from 'react'

import { MarkdownBody } from './markdown-body.tsx'

afterEach(() => {
  cleanup()
})

function renderBody(source: string): HTMLElement {
  render(<MarkdownBody testId="md" source={source} />)
  return screen.getByTestId('md')
}

describe('Markdown 正文', () => {
  it('渲染标题、列表、任务项与代码块', () => {
    const root = renderBody('# 标题\n\n- [x] 已完成\n- [ ] 未完成\n\n```ts\nconst a = 1\n```')

    expect(root.querySelector('h1')?.textContent).toBe('标题')
    const boxes = [...root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    expect(boxes.map((box) => box.checked)).toEqual([true, false])
    expect(root.querySelector('pre code')?.textContent).toBe('const a = 1')
  })

  it('不执行原始 HTML，按文字显示', () => {
    const root = renderBody('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">')

    expect(root.querySelector('script')).toBeNull()
    expect(root.querySelector('img')).toBeNull()
    expect(root.textContent).toContain('<script>')
  })

  it('链接在新窗口打开，危险协议的地址被丢弃', () => {
    const root = renderBody('[文档](https://example.com/doc) [坏](javascript:alert(1))')
    const links = [...root.querySelectorAll('a')]

    expect(links[0]?.getAttribute('href')).toBe('https://example.com/doc')
    expect(links[0]?.getAttribute('target')).toBe('_blank')
    expect(links[0]?.getAttribute('rel')).toBe('noopener noreferrer')
    expect(links.some((link) => link.getAttribute('href')?.startsWith('javascript:'))).toBe(false)
  })
})
