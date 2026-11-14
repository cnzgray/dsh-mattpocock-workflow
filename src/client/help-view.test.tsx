import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import * as React from 'react'

import { FLOW_COMMANDS, FLOW_DIAGRAMS } from '../protocol/flow.ts'
import { panelProps, rowRefs } from './task-panel-test-support.ts'
import { TaskPanel } from './task-panel.tsx'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

async function openHelp(): Promise<void> {
  fireEvent.click(screen.getByTestId('tips'))
  await screen.findByTestId('help-view')
}

describe('流程帮助视图', () => {
  it('点 tips 进入帮助视图，返回后列表的筛选偏好还在', async () => {
    render(<TaskPanel {...panelProps()} />)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('filter-closed'))
    expect(rowRefs()).toEqual(['#3'])

    await openHelp()
    expect(screen.queryByTestId('tickets-view')).toBeNull()

    fireEvent.click(screen.getByTestId('help-back'))
    await screen.findAllByTestId('ticket-row')
    expect(screen.queryByTestId('help-view')).toBeNull()
    expect(screen.getByTestId('filter-closed').getAttribute('aria-pressed')).toBe('true')
    expect(rowRefs()).toEqual(['#3'])
  })

  it('从环境检查进帮助，返回时回到环境检查', async () => {
    render(<TaskPanel {...panelProps()} />)
    await screen.findAllByTestId('ticket-row')

    fireEvent.click(screen.getByTestId('view-env'))
    await screen.findByTestId('env-check-view')

    await openHelp()
    fireEvent.click(screen.getByTestId('help-back'))

    expect(await screen.findByTestId('env-check-view')).toBeTruthy()
    expect(screen.queryByTestId('help-view')).toBeNull()
  })

  it('命令节点正好覆盖流程定义里的全部命令，图例区分归属', async () => {
    render(<TaskPanel {...panelProps()} />)
    await screen.findAllByTestId('ticket-row')
    await openHelp()

    const drawn = new Set<string | null>()
    for (const diagram of FLOW_DIAGRAMS) {
      fireEvent.click(screen.getByTestId(`flow-tab-${diagram.id}`))
      for (const node of screen.getByTestId('flow-diagrams').querySelectorAll('[data-command]')) {
        drawn.add(node.getAttribute('data-command'))
      }
    }
    const defined = Object.values(FLOW_COMMANDS).map((command) => command.name)
    expect([...drawn].sort()).toEqual([...defined].sort())

    expect(screen.getByTestId('legend-plugin').textContent).toContain('插件命令')
    expect(screen.getByTestId('legend-matt').textContent).toContain('matt 技能')
    expect(screen.getByTestId('legend-stop').textContent).toContain('等你发下一条命令')
  })

  it('按场景分页签，一次只显示一张图，默认是第一个场景', async () => {
    render(<TaskPanel {...panelProps()} />)
    await screen.findAllByTestId('ticket-row')
    await openHelp()

    const first = FLOW_DIAGRAMS[0]
    const last = FLOW_DIAGRAMS.at(-1)
    if (first === undefined || last === undefined) throw new Error('缺少流程图')

    expect(screen.getAllByRole('tab')).toHaveLength(FLOW_DIAGRAMS.length)
    expect(screen.getByTestId(`flow-tab-${first.id}`).getAttribute('aria-selected')).toBe('true')
    const svgs = (): NodeListOf<Element> =>
      screen.getByTestId('flow-diagrams').querySelectorAll('svg[role="img"]')
    expect(svgs()).toHaveLength(1)
    expect(svgs()[0]?.getAttribute('aria-label')).toBe(first.title)

    fireEvent.click(screen.getByTestId(`flow-tab-${last.id}`))
    expect(svgs()).toHaveLength(1)
    expect(svgs()[0]?.getAttribute('aria-label')).toBe(last.title)
    expect(screen.getByTestId(`flow-tab-${first.id}`).getAttribute('aria-selected')).toBe('false')
  })

  it('图不可点击', async () => {
    render(<TaskPanel {...panelProps()} />)
    await screen.findAllByTestId('ticket-row')
    await openHelp()

    expect(
      screen
        .getByTestId('flow-diagrams')
        .querySelectorAll('button, a, [tabindex], [role="button"], [onclick]'),
    ).toHaveLength(0)
  })
})

describe('直达规格场景', () => {
  it('需求已明确时单独一张图，画出从需求描述到拆票、实现的直达路径', async () => {
    render(<TaskPanel {...panelProps()} />)
    await screen.findAllByTestId('ticket-row')
    await openHelp()

    const diagram = FLOW_DIAGRAMS.find((item) => item.id === 'direct-spec')
    if (diagram === undefined) throw new Error('缺少“需求已明确”场景')

    fireEvent.click(screen.getByTestId(`flow-tab-${diagram.id}`))
    const panel = screen.getByTestId('flow-diagrams')
    const svgs = panel.querySelectorAll('svg[role="img"]')
    expect(svgs).toHaveLength(1)
    expect(svgs[0]?.getAttribute('aria-label')).toBe('需求已明确')

    // 直达入口不先入池：图里只有 to-spec 起点，没有 mattwf- 命令。
    expect(panel.querySelectorAll('[data-command="to-spec"]')).toHaveLength(1)
    expect(panel.querySelector('[data-command="to-tickets"]')).toBeTruthy()
    expect(panel.querySelector('[data-command="implement"]')).toBeTruthy()
    expect(panel.querySelector('[data-command^="mattwf-"]')).toBeNull()
    expect(panel.textContent).toContain('ready-for-agent')
  })
})
