import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'

import { apply } from './index.tsx'
import { emptyMetrics } from '../protocol/snapshot-test-support.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const SNAPSHOT = {
  backend: 'github',
  repository: 'owner/repo',
  repositoryHost: 'github.com',
  fetchedAt: 1,
  loaded: 0,
  total: 0,
  tickets: [],
  metrics: emptyMetrics(),
  blockersFinalized: true,
}

/** 与 DSH 客户端根上下文一致的最小形状。 */
interface ContextLike {
  get(name: string): unknown
  inject(deps: readonly string[], callback: (scope: ContextLike) => unknown): unknown
  effect(setup: () => () => void, label?: string): unknown
}

interface SessionsState {
  readonly byId: Record<string, { readonly cwd?: string } | undefined>
}

type UseSessions = <T>(selector: (state: SessionsState) => T) => T | undefined

const useSessions: UseSessions = (selector) => selector({ byId: { s1: { cwd: '/repo' } } })

describe('客户端入口', () => {
  it('注入能力就绪前禁用面板动作，就绪后恢复', async () => {
    let registered: React.ComponentType<Record<string, unknown>> | undefined
    const services: Record<string, unknown> = {
      slots: {
        inject: (_name: string, factory: () => () => void) => {
          factory()
          return () => undefined
        },
        register: (options: { readonly name: string }, component: unknown) => {
          if (options.name === 'sidebar.right.pane.tab') {
            registered = component as React.ComponentType<Record<string, unknown>>
          }
          return () => undefined
        },
      },
      sidebarRightTabs: { register: () => () => undefined },
      sessions: { scope: (id: string) => ({ id }) },
    }
    const pending: {
      readonly deps: readonly string[]
      readonly callback: (s: ContextLike) => unknown
    }[] = []
    const scope: ContextLike = {
      get: (name) => services[name],
      inject: (deps, callback) => {
        if (deps.every((dep) => services[dep] !== undefined)) callback(scope)
        else pending.push({ deps, callback })
        return () => undefined
      },
      effect: (setup) => {
        setup()
        return () => undefined
      },
    }

    vi.stubGlobal('fetch', () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true, result: SNAPSHOT }),
      }),
    )

    apply({
      get: (name) => services[name],
      inject: (_deps, callback) => {
        callback(scope)
        return undefined
      },
      effect: () => undefined,
    })

    const Tab = registered
    if (Tab === undefined) throw new Error('页签内容未注册')
    render(React.createElement(Tab, { sessionId: 's1', useSessions }))

    await screen.findByTestId('new-feature')
    expect(screen.getByTestId<HTMLButtonElement>('new-feature').disabled).toBe(true)

    services.conversation = { input: { for: () => ({ setDraft: () => undefined }) } }
    act(() => {
      for (const item of pending.splice(0)) item.callback(scope)
    })

    await waitFor(() => {
      expect(screen.getByTestId<HTMLButtonElement>('new-feature').disabled).toBe(false)
    })
  })
})
