/**
 * 界面插件入口。DSH 读取这里的具名导出 inject 和 apply。
 *
 * 只注册两个扩展点：
 * - `sidebarRightTabs` 的页签类型（含引导页入口）；
 * - `sidebar.right.pane.tab` 的页签内容。
 *
 * 页签类型注册好之后装上面板跟随（`panel-follow.ts`）：会话换人时把 MattWorkflow
 * 页签带到新会话，宿主会顺带展开右栏。`sidebarRight` 是可选能力，缺失时只少这一条行为。
 *
 * 提示词有两个注入目标：当前会话走 `sessions.scope` + `conversation.input.for(...).setDraft`，
 * 新会话走 `uiWorkspace.startSession`（宿主负责复用空白会话、选 agent 预设与切换主界面），
 * 两条路径共用同一段文本，都不自动发送。`uiWorkspace` 是可选能力：缺失时只禁用分裂动作的
 * 小箭头，主键照常可用。
 */
import * as React from 'react'

import { useAgentActivitySignal, type UseSessionsLike } from './agent-activity.ts'
import { createClientCapabilities, type ClientCapabilities } from './capabilities.ts'
import type { UiCapabilityId } from '../protocol/env-check.ts'
import { I18nProvider } from './i18n.tsx'
import { createI18nRuntime, readLocaleService, type I18nRuntime } from './i18n-runtime.ts'
import type { InjectionOutcome, InjectionTarget, PromptInjection } from './injection.ts'
import { createPanelClient, type PanelClient } from './rpc.ts'
import { startPanelFollow } from './panel-follow.ts'
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

interface TaskTabProps {
  readonly sessionId?: string | undefined
  readonly useSessions?: UseSessionsLike | undefined
}

type DraftInjector = (sessionId: string, text: string) => boolean
type NewSessionStarter = (text: string) => void

const useNoSessions: UseSessionsLike = () => undefined

interface SessionsLike {
  scope(id: string): unknown
}

interface ConversationLike {
  readonly input: {
    for(scope: unknown): { setDraft(text: string): void }
  }
}

interface StartSessionOptionsLike {
  readonly prompt?: string
  readonly whenDraftExists?: 'replace' | 'append' | 'keep'
}

/** DSH 客户端的工作区导航能力：开新会话并准备初始提示词。 */
interface UiWorkspaceLike {
  startSession(workspaceId?: string, options?: StartSessionOptionsLike): void
}

interface ClientContextLike {
  get(name: string): unknown
  inject(deps: readonly string[], callback: (scope: ClientContextLike) => unknown): unknown
  effect(setup: () => () => void, label?: string): unknown
}

interface InjectionRef {
  /** 往当前会话输入框写文本。 */
  current: DraftInjector | undefined
  /** 以给定提示词开新会话。 */
  newSession: NewSessionStarter | undefined
  /** 任一注入能力就绪或失效时通知已挂载的面板，按钮的禁用状态才会跟着变。 */
  readonly listeners: Set<() => void>
}

/** 两项注入能力是否就绪；各自独立，缺新会话能力不影响当前会话。 */
interface InjectionReadiness {
  readonly current: boolean
  readonly newSession: boolean
}

/** DSH 客户端插件声明；具体扩展点在 apply 里等待服务就绪。 */
export const inject: string[] = []

/**
 * 注册右栏页签。
 * @param ctx - DSH 客户端根上下文。
 */
export function apply(ctx: ClientContextLike): void {
  if (typeof ctx.inject !== 'function') {
    console.warn(`[${PLUGIN_NAME}] ctx.inject is unavailable; task panel not registered.`)
    return
  }

  const i18n = createI18nRuntime()
  const client = createPanelClient(i18n.t)
  const capabilities = createClientCapabilities()
  if (typeof ctx.effect === 'function') {
    ctx.effect(
      () => () => {
        i18n.dispose()
      },
      `${PLUGIN_NAME}: locale runtime`,
    )
  }

  ctx.inject(['slots', 'sidebarRightTabs'], (scope) => {
    const slots = readSlots(scope.get('slots'))
    const tabs = readTabs(scope.get('sidebarRightTabs'))
    capabilities.mark('slots', slots !== undefined)
    capabilities.mark('sidebarRightTabs', tabs !== undefined)
    if (slots === undefined || tabs === undefined) {
      console.warn(`[${PLUGIN_NAME}] slots or sidebarRightTabs unavailable; panel not registered.`)
      return
    }

    // 注入能力可能比 slots 晚就绪：先挂面板，能力就绪后再装进 ref。
    const injectionRef: InjectionRef = {
      current: undefined,
      newSession: undefined,
      listeners: new Set(),
    }
    registerInjection(scope, injectionRef, capabilities)
    registerLocale(scope, i18n, capabilities)

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
              description: () => i18n.t('tab.guide.description'),
            },
          ],
        }),
      `${PLUGIN_NAME}: tab type`,
    )

    scope.effect(
      () =>
        slots.inject('sidebar.right.pane.tab', () =>
          registerSlot('sidebar.right.pane.tab', capabilities, () =>
            slots.register(
              { name: 'sidebar.right.pane.tab', key: TAB_ID },
              createTaskTab(client, injectionRef, capabilities, i18n),
            ),
          ),
        ),
      `${PLUGIN_NAME}: tab content`,
    )

    scope.effect(
      () =>
        slots.inject('sidebar.right.pane.tab.title', () =>
          registerSlot('sidebar.right.pane.tab.title', capabilities, () =>
            slots.register({ name: 'sidebar.right.pane.tab.title', key: TAB_ID }, TaskTabTitle),
          ),
        ),
      `${PLUGIN_NAME}: tab title`,
    )

    // 页签类型注册之后才装跟随：第一次 openTab 不能撞上「kind 未注册」。
    scope.effect(
      () => startPanelFollow(scope, { tabKind: TAB_KIND, capabilities }),
      `${PLUGIN_NAME}: panel follow`,
    )
  })
}

/**
 * 晚绑定 locale 服务：晚到也能接上，缺失时面板继续用内置中文。
 * 接上或断开时同步更新能力诊断。
 */
function registerLocale(
  scope: ClientContextLike,
  i18n: I18nRuntime,
  capabilities: ClientCapabilities,
): void {
  scope.inject(['locale'], (inner) => {
    const attachment = i18n.attach(readLocaleService(inner.get('locale')))
    capabilities.mark('locale', attachment.attached)
    return () => {
      capabilities.mark('locale', false)
      attachment.dispose()
    }
  })
}

/**
 * 接上两条独立的注入能力：当前会话（会话 + 对话输入）与新会话（工作区导航）。
 * 新会话是可选依赖，没有它只禁用小箭头，主键不受影响。
 */
function registerInjection(
  scope: ClientContextLike,
  injectionRef: InjectionRef,
  capabilities: ClientCapabilities,
): void {
  scope.inject(['sessions', 'conversation'], (inner) => {
    capabilities.mark('sessions', readSessions(inner.get('sessions')) !== undefined)
    capabilities.mark('conversation', readConversation(inner.get('conversation')) !== undefined)
    setCurrentInjector(injectionRef, createDraftInjector(inner))
    return () => {
      capabilities.mark('sessions', false)
      capabilities.mark('conversation', false)
      setCurrentInjector(injectionRef, undefined)
    }
  })

  scope.inject(['uiWorkspace'], (inner) => {
    const starter = createNewSessionStarter(inner)
    capabilities.mark('uiWorkspace', starter !== undefined)
    setNewSessionStarter(injectionRef, starter)
    return () => {
      capabilities.mark('uiWorkspace', false)
      setNewSessionStarter(injectionRef, undefined)
    }
  })
}

function TaskTabTitle(): React.ReactElement {
  return <span>MattWorkflow</span>
}

function createTaskTab(
  client: PanelClient,
  injectionRef: InjectionRef,
  capabilities: ClientCapabilities,
  i18n: I18nRuntime,
): React.ComponentType<TaskTabProps> {
  return function TaskTab(props: TaskTabProps): React.ReactElement {
    const sessionId = props.sessionId
    const useSessions: UseSessionsLike = props.useSessions ?? useNoSessions
    const cwd = useSessions((state) =>
      sessionId === undefined ? undefined : state.byId[sessionId]?.cwd,
    )
    const readiness = useInjectionReadiness(injectionRef)
    // agent 把这一轮跑完（或空闲时又动了工单）之后，面板自己把列表拉回最新。
    const refreshSignal = useAgentActivitySignal(useSessions, sessionId)
    const injection = React.useMemo<PromptInjection>(
      () => ({
        canInjectCurrent: sessionId !== undefined && readiness.current,
        canStartNewSession: readiness.newSession,
        inject: (text, target) => dispatchInjection(injectionRef, sessionId, text, target),
      }),
      [injectionRef, sessionId, readiness.current, readiness.newSession],
    )

    return (
      <I18nProvider i18n={i18n}>
        <TaskPanel
          client={client}
          workspaceRoot={cwd}
          injection={injection}
          refreshSignal={refreshSignal}
          clientCapabilities={capabilities.read}
        />
      </I18nProvider>
    )
  }
}

function setCurrentInjector(ref: InjectionRef, injector: DraftInjector | undefined): void {
  ref.current = injector
  notify(ref)
}

function setNewSessionStarter(ref: InjectionRef, starter: NewSessionStarter | undefined): void {
  ref.newSession = starter
  notify(ref)
}

function notify(ref: InjectionRef): void {
  for (const listener of ref.listeners) listener()
}

function useInjectionReadiness(ref: InjectionRef): InjectionReadiness {
  const [readiness, setReadiness] = React.useState<InjectionReadiness>(() => readReadiness(ref))

  React.useEffect(() => {
    const update = (): void => {
      setReadiness(readReadiness(ref))
    }
    ref.listeners.add(update)
    update()
    return () => {
      ref.listeners.delete(update)
    }
  }, [ref])

  return readiness
}

function readReadiness(ref: InjectionRef): InjectionReadiness {
  return { current: ref.current !== undefined, newSession: ref.newSession !== undefined }
}

/** 按目标分派；新会话请求交给宿主后只报「已请求」。 */
function dispatchInjection(
  ref: InjectionRef,
  sessionId: string | undefined,
  text: string,
  target: InjectionTarget,
): InjectionOutcome {
  if (target === 'new-session') {
    const start = ref.newSession
    if (start === undefined) return 'unavailable'
    start(text)
    return 'requested'
  }

  const injector = ref.current
  if (injector === undefined || sessionId === undefined) return 'unavailable'
  return injector(sessionId, text) ? 'filled' : 'unavailable'
}

/**
 * 宿主已有的「开新会话并准备初始提示词」路径。
 * 工作区不传，沿用当前所在的工作区；草稿策略是追加，已有草稿不会被清空。
 */
function createNewSessionStarter(ctx: ClientContextLike): NewSessionStarter | undefined {
  const uiWorkspace = readUiWorkspace(ctx.get('uiWorkspace'))
  if (uiWorkspace === undefined) return undefined

  return (text) => {
    uiWorkspace.startSession(undefined, { prompt: text, whenDraftExists: 'append' })
  }
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

function readUiWorkspace(value: unknown): UiWorkspaceLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  if (!('startSession' in value) || typeof value.startSession !== 'function') return undefined
  return value as unknown as UiWorkspaceLike
}

function readConversation(value: unknown): ConversationLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  if (!('input' in value)) return undefined
  const input = value.input
  if (typeof input !== 'object' || input === null) return undefined
  if (!('for' in input) || typeof input.for !== 'function') return undefined
  return value as unknown as ConversationLike
}
