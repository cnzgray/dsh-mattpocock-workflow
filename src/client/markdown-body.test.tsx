import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import * as React from 'react'

import type { AttachmentLoader } from './attachment-loader.ts'
import { MarkdownBody, type MarkdownAttachments } from './markdown-body.tsx'

afterEach(() => {
  cleanup()
})

const BASE = 'https://gitlab.chyait.top/-/project/216/uploads/'
const PNG_URL = 'data:image/png;base64,iVBORw0KGgo='

function renderBody(source: string, attachments?: MarkdownAttachments | null): HTMLElement {
  render(<MarkdownBody testId="md" source={source} attachments={attachments} />)
  return screen.getByTestId('md')
}

/** 记录请求的取图函数：`results` 里有的地址返回 data URL，其余失败。 */
function loader(results: Readonly<Record<string, string>>): {
  readonly load: AttachmentLoader
  readonly calls: string[]
} {
  const calls: string[] = []
  return {
    calls,
    load: (path) => {
      calls.push(path)
      return Promise.resolve(results[path] ?? null)
    },
  }
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

  it('上传附件图片经宿主取回后以 data URL 显示，不落到面板自己的源', async () => {
    const { load, calls } = loader({ '/uploads/f0fb/gzt-1.png': PNG_URL })
    const root = renderBody('![工资明细](/uploads/f0fb/gzt-1.png)', { baseUrl: BASE, load })

    expect(root.querySelector('img')).toBeNull()
    expect(root.textContent).toContain('工资明细')
    await waitFor(() => {
      expect(root.querySelector('img')?.getAttribute('src')).toBe(PNG_URL)
    })
    expect(root.querySelector('img')?.getAttribute('alt')).toBe('工资明细')
    expect(calls).toEqual(['/uploads/f0fb/gzt-1.png'])
  })

  it('已补成本项目绝对地址的附件同样经宿主取图', async () => {
    const { load, calls } = loader({ '/uploads/f0fb/gzt-1.png': PNG_URL })
    const root = renderBody(`![图](${BASE}f0fb/gzt-1.png)`, { baseUrl: BASE, load })

    await waitFor(() => {
      expect(root.querySelector('img')?.getAttribute('src')).toBe(PNG_URL)
    })
    expect(calls).toEqual(['/uploads/f0fb/gzt-1.png'])
  })

  it('取图失败时显示文件名并链到 GitLab 原地址，不出现裸破图', async () => {
    const { load } = loader({})
    const root = renderBody('![](/uploads/f0fb/%E5%B7%A5%E8%B5%84.png)', { baseUrl: BASE, load })

    await waitFor(() => {
      expect(root.querySelector('[data-attachment="failed"]')).not.toBeNull()
    })
    expect(root.querySelector('img')).toBeNull()
    const link = root.querySelector('a')
    expect(link?.getAttribute('href')).toBe(`${BASE}f0fb/%E5%B7%A5%E8%B5%84.png`)
    expect(link?.getAttribute('target')).toBe('_blank')
    expect(link?.textContent).toContain('工资.png')
  })

  it('外链图片与其他相对地址不交给宿主，非图片附件链接补成绝对地址', () => {
    const { load, calls } = loader({})
    const root = renderBody(
      '![外部](https://example.com/a.png) ![本地](/assets/b.png) [表格](/uploads/abcd/gzt-2.xlsx)',
      { baseUrl: BASE, load },
    )

    expect([...root.querySelectorAll('img')].map((img) => img.getAttribute('src'))).toEqual([
      'https://example.com/a.png',
      '/assets/b.png',
    ])
    expect(root.querySelector('a')?.getAttribute('href')).toBe(`${BASE}abcd/gzt-2.xlsx`)
    expect(calls).toEqual([])
  })

  it('没有附件配置时（非 GitLab 后端）地址保持原样', () => {
    const root = renderBody('![附件](/uploads/f0fb/gzt-1.png)')

    expect(root.querySelector('img')?.getAttribute('src')).toBe('/uploads/f0fb/gzt-1.png')
  })
})
