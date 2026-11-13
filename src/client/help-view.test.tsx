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

    const drawn = new Set(
      [...screen.getByTestId('help-view').querySelectorAll('[data-command]')].map((node) =>
        node.getAttribute('data-command'),
      ),
    )
    const defined = Object.values(FLOW_COMMANDS).map((command) => command.name)
    expect([...drawn].sort()).toEqual([...defined].sort())

    expect(screen.getByTestId('legend-plugin').textContent).toContain('插件命令')
    expect(screen.getByTestId('legend-matt').textContent).toContain('matt 技能')
    expect(screen.getByTestId('legend-stop').textContent).toContain('等你发下一条命令')
  })

  it('图不可点击，每张图都渲染出来', async () => {
    render(<TaskPanel {...panelProps()} />)
    await screen.findAllByTestId('ticket-row')
    await openHelp()

    const diagrams = screen.getByTestId('flow-diagrams')
    expect(diagrams.querySelectorAll('svg[role="img"]')).toHaveLength(FLOW_DIAGRAMS.length)
    expect(
      diagrams.querySelectorAll('button, a, [tabindex], [role="button"], [onclick]'),
    ).toHaveLength(0)
  })
})
