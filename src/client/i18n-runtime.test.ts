import { describe, expect, it } from 'vitest'

import { createFakeLocaleService } from './i18n-test-support.ts'
import {
  builtinZhTranslate,
  createI18nRuntime,
  interpolate,
  MESSAGES_NAMESPACE,
  readLocaleService,
} from './i18n-runtime.ts'
import { en, zh } from './messages.ts'

describe('翻译运行时', () => {
  it('没有 locale 服务时用内置中文，行为与接入前一致', () => {
    const i18n = createI18nRuntime()

    expect(i18n.getSnapshot()).toEqual({ language: 'zh', revision: 0 })
    expect(i18n.t('view.tickets')).toBe('列表')
    expect(i18n.t('view.env')).toBe('环境检查')
  })

  it('接入时用插件自己的命名空间注册中英两套词典', () => {
    const fake = createFakeLocaleService('en')
    const i18n = createI18nRuntime()
    const attachment = i18n.attach(fake.service)

    expect(attachment.attached).toBe(true)
    expect(fake.registration?.namespace).toBe(MESSAGES_NAMESPACE)
    expect(Object.keys(fake.registration?.dictionaries.zh ?? {})).toEqual(Object.keys(zh))
    expect(Object.keys(fake.registration?.dictionaries.en ?? {})).toEqual(Object.keys(en))
  })

  it('按当前语言取词，切换语言后同一个入口立刻解析到新文案', () => {
    const fake = createFakeLocaleService('en')
    const i18n = createI18nRuntime()
    const seen: string[] = []
    i18n.subscribe(() => {
      seen.push(i18n.getSnapshot().language)
    })
    i18n.attach(fake.service)

    expect(i18n.t('view.tickets')).toBe('Tickets')
    expect(i18n.t('view.env')).toBe('Environment')

    fake.setActive('zh')

    expect(i18n.t('view.tickets')).toBe('列表')
    expect(i18n.getSnapshot().language).toBe('zh')
    expect(seen).toContain('zh')
  })

  it('目标语言缺整套词典时回退到英文，不出现裸键名', () => {
    const fake = createFakeLocaleService('ja')
    const i18n = createI18nRuntime()
    i18n.attach(fake.service)

    expect(i18n.t('view.tickets')).toBe('Tickets')
    expect(i18n.t('filter.group')).toBe('Status filter')
  })

  it('重复接入同一服务时先释放旧注册，不会因重复注册失败', () => {
    const fake = createFakeLocaleService('en')
    const i18n = createI18nRuntime()
    i18n.attach(fake.service)

    expect(() => i18n.attach(fake.service)).not.toThrow()
    expect(fake.registration?.namespace).toBe(MESSAGES_NAMESPACE)
    expect(i18n.t('view.tickets')).toBe('Tickets')
  })

  it('服务契约不符或注册抛错时降级到内置中文，插件不失败', () => {
    const fake = createFakeLocaleService('en')
    fake.setFailRegister(true)
    const i18n = createI18nRuntime()
    const attachment = i18n.attach(fake.service)

    expect(attachment.attached).toBe(false)
    expect(i18n.t('view.tickets')).toBe('列表')
    expect(fake.listeners).toBe(0)
  })

  it('locale 服务消失后回到内置中文', () => {
    const fake = createFakeLocaleService('en')
    const i18n = createI18nRuntime()
    i18n.attach(fake.service)
    expect(i18n.t('view.tickets')).toBe('Tickets')

    i18n.attach(undefined)

    expect(i18n.t('view.tickets')).toBe('列表')
    expect(i18n.getSnapshot().language).toBe('zh')
  })

  it('释放时退订并撤销词典注册', () => {
    const fake = createFakeLocaleService('en')
    const i18n = createI18nRuntime()
    const attachment = i18n.attach(fake.service)
    expect(fake.listeners).toBe(1)

    attachment.dispose()

    expect(fake.listeners).toBe(0)
    expect(fake.registration).toBeNull()
    expect(i18n.t('view.tickets')).toBe('列表')
  })

  it('占位符按参数替换，缺参数时原样保留', () => {
    expect(builtinZhTranslate('tickets.loaded', { loaded: 3, total: 10 })).toBe('已加载 3 / 共 10')
    expect(builtinZhTranslate('tickets.loaded', { loaded: 3 })).toBe('已加载 3 / 共 {total}')
    expect(interpolate('{name}（{missing}）', { name: 'x' })).toBe('x（{missing}）')
  })

  it('中英词典的占位符集合一致，替换后句子仍然完整', () => {
    const placeholders = (template: string): readonly string[] =>
      [...template.matchAll(/\{([A-Za-z0-9_.-]+)\}/g)].map((match) => match[1] ?? '').sort()
    for (const key of Object.keys(zh) as (keyof typeof zh)[]) {
      expect(placeholders(en[key])).toEqual(placeholders(zh[key]))
    }
  })

  it('只把具备四个动作的对象识别为 locale 服务', () => {
    const fake = createFakeLocaleService()
    expect(readLocaleService(fake.service)).toBe(fake.service)
    expect(readLocaleService({ bind: () => '' })).toBeUndefined()
    expect(readLocaleService(null)).toBeUndefined()
    expect(readLocaleService('locale')).toBeUndefined()
  })
})
