/**
 * agent 活动信号：面板只读会话列表里的运行状态与最近活动时间，
 * 在这一轮停下之后发一次刷新信号，一轮里的连续写入合并成一次。
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'

import {
  ACTIVITY_SETTLE_MS,
  activityToken,
  tokenIsRunning,
  useAgentActivitySignal,
  type SessionRowLike,
  type UseSessionsLike,
} from './agent-activity.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function sessions(row: SessionRowLike | undefined): UseSessionsLike {
  return (selector) => selector({ byId: row === undefined ? {} : { s1: row } })
}

function Probe(props: {
  readonly useSessions: UseSessionsLike
  readonly sessionId?: string | undefined
}): React.ReactElement {
  const signal = useAgentActivitySignal(props.useSessions, props.sessionId)
  return <span data-testid="signal">{signal}</span>
}

describe('会话活动摘要', () => {
  it('把运行状态与最近活动时间编成一个可比较的摘要', () => {
    expect(activityToken({ running: true, updatedAt: 5 })).toBe('1:5')
    expect(activityToken({ running: false, updatedAt: 5 })).toBe('0:5')
    expect(activityToken({ cwd: '/repo' })).toBe('0:')
    expect(activityToken(undefined)).toBeNull()
  })

  it('只在摘要表示还在跑时判为运行中', () => {
    expect(tokenIsRunning('1:5')).toBe(true)
    expect(tokenIsRunning('0:5')).toBe(false)
  })
})

describe('agent 活动信号', () => {
  it('挂载时的现状不算一次刷新请求', () => {
    vi.useFakeTimers()
    render(<Probe useSessions={sessions({ running: false, updatedAt: 10 })} sessionId="s1" />)

    act(() => {
      vi.advanceTimersByTime(ACTIVITY_SETTLE_MS * 3)
    })

    expect(screen.getByTestId('signal').textContent).toBe('0')
  })

  it('这一轮停下并且安静下来之后把信号加一', () => {
    vi.useFakeTimers()
    const view = render(
      <Probe useSessions={sessions({ running: false, updatedAt: 10 })} sessionId="s1" />,
    )

    // 这一轮开始跑：不触发刷新。
    view.rerender(<Probe useSessions={sessions({ running: true, updatedAt: 11 })} sessionId="s1" />)
    act(() => {
      vi.advanceTimersByTime(ACTIVITY_SETTLE_MS * 2)
    })
    expect(screen.getByTestId('signal').textContent).toBe('0')

    // 这一轮跑完：等安静时长到了再刷新一次。
    view.rerender(
      <Probe useSessions={sessions({ running: false, updatedAt: 12 })} sessionId="s1" />,
    )
    act(() => {
      vi.advanceTimersByTime(ACTIVITY_SETTLE_MS - 1)
    })
    expect(screen.getByTestId('signal').textContent).toBe('0')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByTestId('signal').textContent).toBe('1')
  })

  it('空闲时的活动同样触发出一次刷新，连续活动只算一次', () => {
    vi.useFakeTimers()
    const view = render(
      <Probe useSessions={sessions({ running: false, updatedAt: 10 })} sessionId="s1" />,
    )

    view.rerender(
      <Probe useSessions={sessions({ running: false, updatedAt: 11 })} sessionId="s1" />,
    )
    act(() => {
      vi.advanceTimersByTime(ACTIVITY_SETTLE_MS / 2)
    })
    view.rerender(
      <Probe useSessions={sessions({ running: false, updatedAt: 12 })} sessionId="s1" />,
    )
    act(() => {
      vi.advanceTimersByTime(ACTIVITY_SETTLE_MS)
    })

    expect(screen.getByTestId('signal').textContent).toBe('1')
  })

  it('还在跑的期间攒下的活动不会在转空闲后叠加成多次刷新', () => {
    vi.useFakeTimers()
    const view = render(
      <Probe useSessions={sessions({ running: false, updatedAt: 10 })} sessionId="s1" />,
    )

    view.rerender(<Probe useSessions={sessions({ running: true, updatedAt: 11 })} sessionId="s1" />)
    view.rerender(<Probe useSessions={sessions({ running: true, updatedAt: 12 })} sessionId="s1" />)
    act(() => {
      vi.advanceTimersByTime(ACTIVITY_SETTLE_MS * 2)
    })
    expect(screen.getByTestId('signal').textContent).toBe('0')

    view.rerender(
      <Probe useSessions={sessions({ running: false, updatedAt: 13 })} sessionId="s1" />,
    )
    act(() => {
      vi.advanceTimersByTime(ACTIVITY_SETTLE_MS)
    })
    expect(screen.getByTestId('signal').textContent).toBe('1')
  })

  it('没有会话或宿主不给这一行时不发信号', () => {
    vi.useFakeTimers()
    render(<Probe useSessions={sessions(undefined)} sessionId="s1" />)

    act(() => {
      vi.advanceTimersByTime(ACTIVITY_SETTLE_MS * 2)
    })

    expect(screen.getByTestId('signal').textContent).toBe('0')
  })
})
