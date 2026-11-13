/**
 * 界面插件入口。DSH 读取这里的具名导出 inject 和 apply。
 *
 * 只注册两个扩展点：
 * - `sidebarRightTabs` 的页签类型（含引导页入口）；
 * - `sidebar.right.pane.tab` 的页签内容。
 *
 * 提示词通过 `sessions.scope` + `conversation.input.for(...).setDraft` 填进当前会话，
 * 不自动发送。服务缺失时面板仍能看工单，注入按钮降级为不可用。
 */
import * as React from 'react'

import { createClientCapabilities, type ClientCapabilities } from './capabilities.ts'
import type { UiCapabilityId } from '../protocol/env-check.ts'
import { createPanelClient, type PanelClient } from './rpc.ts'
import { TaskPanel } from './task-panel.tsx'

const PLUGIN_NAME = 'dsh-mattpocock-workflow'
const TAB_ID = 'dsh-mattpocock-workflow:task-panel'
const TAB_KIND = 'dsh-mattpocock-workflow'

interface SlotsLike {
  inject(name: string, factory: () => () => void): () => void
  register(
    options: { readonly name: string; readonly key: string },
    component: React.ComponentType<TaskTabProps>,
  ): () => void
}

interface GuideEntryLike {
  readonly id: string
  readonly order: number
  readonly title: () => string
  readonly description?: () => string
}

interface TabDefinitionLike {
  readonly id: string
  readonly kind: string
  readonly priority: 'extension'
  readonly title: () => string
  readonly guide: readonly GuideEntryLike[]
}

interface SidebarRightTabsLike {
  register(definition: TabDefinitionLike): () => void
}

interface SessionListLike {
  readonly byId: Record<string, { readonly cwd?: string } | undefined>
}

type UseSessionsLike = <T>(selector: (state: SessionListLike) => T) => T | undefined

interface TaskTabProps {
  readonly sessionId?: string | undefined
  readonly useSessions?: UseSessionsLike | undefined
}

type DraftInjector = (sessionId: string, text: string) => boolean

const useNoSessions: UseSessionsLike = () => undefined

interface SessionsLike {
  scope(id: string): unknown
}

interface ConversationLike {
  readonly input: {
    for(scope: unknown): { setDraft(text: string): void }
  }
}

interface ClientContextLike {
  get(name: string): unknown
  inject(deps: readonly string[], callback: (scope: ClientContextLike) => unknown): unknown
  effect(setup: () => () => void, label?: string): unknown
}

interface InjectorRef {
  current: DraftInjector | undefined
  /** 注入能力就绪或失效时通知已挂载的面板，按钮的禁用状态才会跟着变。 */
  readonly listeners: Set<() => void>
}

/** DSH 客户端插件声明；具体扩展点在 apply 里等待服务就绪。 */
export const inject: string[] = []

/**
 * 注册右栏页签。
 * @param ctx - DSH 客户端根上下文。
 */
export function apply(ctx: ClientContextLike): void {
  if (typeof ctx.inject !== 'function') {
    console.warn(`[${PLUGIN_NAME}] 当前 DSH 不提供 ctx.inject，任务面板未注册。`)
    return
  }

  const client = createPanelClient()
  const capabilities = createClientCapabilities()

  ctx.inject(['slots', 'sidebarRightTabs'], (scope) => {
    const slots = readSlots(scope.get('slots'))
    const tabs = readTabs(scope.get('sidebarRightTabs'))
    capabilities.mark('slots', slots !== undefined)
    capabilities.mark('sidebarRightTabs', tabs !== undefined)
    if (slots === undefined || tabs === undefined) {
      console.warn(`[${PLUGIN_NAME}] slots 或 sidebarRightTabs 不可用，任务面板未注册。`)
      return
    }

    // sessions 与 conversation 可能比 slots 晚就绪：先挂面板，注入能力就绪后再装进 ref。
    const injectorRef: InjectorRef = { current: undefined, listeners: new Set() }
    scope.inject(['sessions', 'conversation'], (inner) => {
      capabilities.mark('sessions', readSessions(inner.get('sessions')) !== undefined)
      capabilities.mark('conversation', readConversation(inner.get('conversation')) !== undefined)
      setInjector(injectorRef, createDraftInjector(inner))
      return () => {
        capabilities.mark('sessions', false)
        capabilities.mark('conversation', false)
        setInjector(injectorRef, undefined)
      }
    })

    scope.effect(
      () =>
        tabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          priority: 'extension',
          title: () => 'MattWorkflow',
          guide: [
            {
              id: 'task-panel',
              order: 20,
              title: () => 'MattWorkflow',
              description: () => '查看、筛选并开始处理工单',
            },
          ],
        }),
      `${PLUGIN_NAME}: 页签类型`,
    )

    scope.effect(
      () =>
        slots.inject('sidebar.right.pane.tab', () =>
          registerSlot('sidebar.right.pane.tab', capabilities, () =>
            slots.register(
              { name: 'sidebar.right.pane.tab', key: TAB_ID },
              createTaskTab(client, injectorRef, capabilities),
            ),
          ),
        ),
      `${PLUGIN_NAME}: 页签内容`,
    )

    scope.effect(
      () =>
        slots.inject('sidebar.right.pane.tab.title', () =>
          registerSlot('sidebar.right.pane.tab.title', capabilities, () =>
            slots.register({ name: 'sidebar.right.pane.tab.title', key: TAB_ID }, TaskTabTitle),
          ),
        ),
      `${PLUGIN_NAME}: 页签标题`,
    )
  })
}

function TaskTabTitle(): React.ReactElement {
  return <span>MattWorkflow</span>
}

function createTaskTab(
  client: PanelClient,
  injectorRef: InjectorRef,
  capabilities: ClientCapabilities,
): React.ComponentType<TaskTabProps> {
  return function TaskTab(props: TaskTabProps): React.ReactElement {
    const sessionId = props.sessionId
    const useSessions: UseSessionsLike = props.useSessions ?? useNoSessions
    const cwd = useSessions((state) =>
      sessionId === undefined ? undefined : state.byId[sessionId]?.cwd,
    )
    const injectDraft = React.useCallback(
      (text: string) => {
        const injector = injectorRef.current
        return injector === undefined || sessionId === undefined ? false : injector(sessionId, text)
      },
      [injectorRef, sessionId],
    )
    const injectorReady = useInjectorReady(injectorRef)

    return (
      <TaskPanel
        client={client}
        workspaceRoot={cwd}
        canInject={sessionId !== undefined && injectorReady}
        injectDraft={injectDraft}
        clientCapabilities={capabilities.read}
      />
    )
  }
}

function setInjector(ref: InjectorRef, injector: DraftInjector | undefined): void {
  ref.current = injector
  for (const listener of ref.listeners) listener()
}

function useInjectorReady(ref: InjectorRef): boolean {
  const [ready, setReady] = React.useState(ref.current !== undefined)

  React.useEffect(() => {
    const update = (): void => {
      setReady(ref.current !== undefined)
    }
    ref.listeners.add(update)
    update()
    return () => {
      ref.listeners.delete(update)
    }
  }, [ref])

  return ready
}

function createDraftInjector(ctx: ClientContextLike): DraftInjector | undefined {
  const sessions = readSessions(ctx.get('sessions'))
  const conversation = readConversation(ctx.get('conversation'))
  if (sessions === undefined || conversation === undefined) return undefined

  return (sessionId, text) => {
    const scope = sessions.scope(sessionId)
    if (scope === undefined) return false
    conversation.input.for(scope).setDraft(text)
    return true
  }
}

function registerSlot(
  id: UiCapabilityId,
  capabilities: ClientCapabilities,
  register: () => () => void,
): () => void {
  const dispose = register()
  capabilities.mark(id, true)
  return () => {
    capabilities.mark(id, false)
    dispose()
  }
}

function readSlots(value: unknown): SlotsLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  if (!('inject' in value) || typeof value.inject !== 'function') return undefined
  if (!('register' in value) || typeof value.register !== 'function') return undefined
  return value as unknown as SlotsLike
}

function readTabs(value: unknown): SidebarRightTabsLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  if (!('register' in value) || typeof value.register !== 'function') return undefined
  return value as unknown as SidebarRightTabsLike
}

function readSessions(value: unknown): SessionsLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  if (!('scope' in value) || typeof value.scope !== 'function') return undefined
  return value as unknown as SessionsLike
}

function readConversation(value: unknown): ConversationLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  if (!('input' in value)) return undefined
  const input = value.input
  if (typeof input !== 'object' || input === null) return undefined
  if (!('for' in input) || typeof input.for !== 'function') return undefined
  return value as unknown as ConversationLike
}
