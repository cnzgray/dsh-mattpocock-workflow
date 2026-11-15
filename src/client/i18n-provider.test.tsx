import { act, cleanup, render, screen } from '@testing-library/react'
import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { createFakeLocaleService } from './i18n-test-support.ts'
import { I18nProvider, useI18n } from './i18n.tsx'
import { createI18nRuntime } from './i18n-runtime.ts'

afterEach(() => {
  cleanup()
})

let mounts = 0

function Probe(): React.ReactElement {
  const { t, language } = useI18n()
  React.useEffect(() => {
    mounts += 1
  }, [])
  return <span data-testid="probe">{`${language}:${t('view.tickets')}`}</span>
}

describe('React 翻译入口', () => {
  it('切换语言后已渲染的文案即时改写，不重新挂载子树', () => {
    mounts = 0
    const fake = createFakeLocaleService('en')
    const i18n = createI18nRuntime()
    i18n.attach(fake.service)

    render(
      <I18nProvider i18n={i18n}>
        <Probe />
      </I18nProvider>,
    )

    expect(screen.getByTestId('probe').textContent).toBe('en:Tickets')

    act(() => {
      fake.setActive('zh')
    })

    expect(screen.getByTestId('probe').textContent).toBe('zh:列表')
    expect(mounts).toBe(1)
  })

  it('locale 服务晚于面板就绪时，接上后自动补上翻译，不用重新挂载', () => {
    mounts = 0
    const fake = createFakeLocaleService('en')
    const i18n = createI18nRuntime()

    render(
      <I18nProvider i18n={i18n}>
        <Probe />
      </I18nProvider>,
    )
    expect(screen.getByTestId('probe').textContent).toBe('zh:列表')

    act(() => {
      i18n.attach(fake.service)
    })

    expect(screen.getByTestId('probe').textContent).toBe('en:Tickets')
    expect(mounts).toBe(1)
  })

  it('没有 Provider 时组件拿到内置中文', () => {
    render(<Probe />)
    expect(screen.getByTestId('probe').textContent).toBe('zh:列表')
  })
})
