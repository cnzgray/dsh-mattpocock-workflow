import { describe, expect, it } from 'vitest'

import { createClientCapabilities } from './capabilities.ts'

describe('界面能力记录器', () => {
  it('初始时界面扩展点全部缺失，顺序固定', () => {
    const capabilities = createClientCapabilities()

    expect(capabilities.read().map((entry) => entry.id)).toEqual([
      'slots',
      'sidebarRightTabs',
      'sessions',
      'conversation',
      'sidebar.right.pane.tab',
      'sidebar.right.pane.tab.title',
    ])
    expect(capabilities.read().every((entry) => entry.status === 'missing')).toBe(true)
    expect(capabilities.read().every((entry) => entry.category === 'ui-extension')).toBe(true)
  })

  it('服务就绪后标为可用，失效后回到缺失', () => {
    const capabilities = createClientCapabilities()

    capabilities.mark('slots', true)
    capabilities.mark('sidebar.right.pane.tab', true)
    expect(statusOf(capabilities.read(), 'slots')).toBe('present')
    expect(statusOf(capabilities.read(), 'sidebar.right.pane.tab')).toBe('present')

    capabilities.mark('slots', false)
    expect(statusOf(capabilities.read(), 'slots')).toBe('missing')
  })
})

function statusOf(
  entries: readonly { readonly id: string; readonly status: string }[],
  id: string,
): string | undefined {
  return entries.find((entry) => entry.id === id)?.status
}
