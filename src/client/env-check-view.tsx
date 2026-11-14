/**
 * 环境检查视图。只依赖注入的面板客户端、提示词注入能力与界面能力读取函数，
 * 因此 Vitest + jsdom 就能测自动检查、三种状态、跳过原因、解决区与能力诊断。
 */
import * as React from 'react'

import type { BackendKind } from '../protocol/backend.ts'
import type {
  CapabilityDiagnostic,
  EnvCheckItem,
  EnvCheckRef,
  EnvCheckReport,
  EnvCheckStatus,
} from '../protocol/env-check.ts'
import type { RpcErrorBody, RpcResult, SnapshotCacheInfo } from '../protocol/tracker.ts'
import { CapabilityPanel } from './env-capabilities.tsx'
import {
  ENV_BACKEND_STYLE,
  ENV_BODY_STYLE,
  ENV_CARD_HIGHLIGHT_STYLE,
  ENV_CARD_STYLE,
  ENV_DETAIL_STYLE,
  ENV_HEADER_STYLE,
  ENV_HIGHLIGHT_STYLE,
  ENV_SKIP_STYLE,
  ENV_STATUS_COLORS,
  ENV_STATUS_LABELS,
  ENV_SUMMARY_STYLE,
  ENV_TITLE_STYLE,
} from './env-check-styles.ts'
import { envBackendLabel, envCheckTitle } from './env-check-text.ts'
import { RemedySection, type RemedyHandlers } from './env-remedy-view.tsx'
import type { PromptInjection } from './injection.ts'
import { formatRelativeTime } from './relative-time.ts'
import type { PanelClient } from './rpc.ts'
import { BUTTON_STYLE, COLORS, EMPTY_STYLE, ERROR_STYLE } from './task-panel-styles.ts'

/** 本地快照库小节：跟检查项卡片同一种边框，只是排成纵向。 */
const ENV_CACHE_SECTION_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 4,
  margin: '0 12px 12px',
  padding: '9px 12px',
  border: `1px solid ${COLORS.border}`,
  borderRadius: 10,
  background: COLORS.surface,
  color: COLORS.text,
}

/** 清空失败的原因：不能静默，用户要知道为什么没清掉。 */
const ENV_CACHE_ERROR_STYLE: React.CSSProperties = {
  color: COLORS.error,
  fontSize: 12,
  overflowWrap: 'anywhere',
}

/** 环境检查视图依赖。 */
export interface EnvCheckViewProps {
  readonly client: PanelClient
  readonly workspaceRoot: string | undefined
  /** 面板的注入端口；这里的会话动作固定只填当前会话。 */
  readonly injection: PromptInjection
  /** 界面扩展点探测结果；由插件入口在服务就绪后更新。 */
  readonly clientCapabilities: () => readonly CapabilityDiagnostic[]
  /** 从工单列表跳转过来时，要定位到哪个后端的失败项。 */
  readonly focusBackend?: Exclude<BackendKind, 'markdown'> | null
}

type Phase = 'loading' | 'ready' | 'refreshing' | 'error'

interface EnvCheckState {
  readonly report: EnvCheckReport | null
  readonly error: RpcErrorBody | null
  readonly phase: Phase
  readonly recheck: () => void
}

/**
 * 环境检查视图根组件：打开时自动检查，重新检查时保留上一次结果与解决区。
 * @param props - 面板客户端、工作区、注入能力与界面能力读取函数。
 * @returns 检查结果列表与能力诊断。
 */
export function EnvCheckView(props: EnvCheckViewProps): React.ReactElement {
  const { report, error, phase, recheck } = useEnvCheckRequest(props.client, props.workspaceRoot)
  const busy = phase === 'loading' || phase === 'refreshing'
  const capabilities = [...(report?.capabilities ?? []), ...props.clientCapabilities()]
  const { highlighted, registerCard, jumpTo } = useRootCauseJump()
  useFocusBackend(report, props.focusBackend ?? null, jumpTo)
  const cache = useSnapshotCache(props.client, props.workspaceRoot)
  const handlers: RemedyHandlers = {
    injection: props.injection,
    busy,
    onRetry: recheck,
  }

  return (
    <div
      data-testid="env-check-view"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      <header style={ENV_HEADER_STYLE}>
        <span data-testid="env-summary" style={ENV_SUMMARY_STYLE}>
          环境检查 {report?.items.filter((item) => item.status === 'pass').length ?? 0}/
          {report?.items.length ?? 0}
        </span>
        <span data-testid="env-backend" style={ENV_BACKEND_STYLE}>
          {envBackendLabel(report?.backend ?? null)}
        </span>
        <button
          type="button"
          data-testid="env-recheck"
          disabled={busy}
          onClick={recheck}
          data-hover="soft"
          style={BUTTON_STYLE}
        >
          {busy ? '检查中…' : '重新检查'}
        </button>
      </header>

      {error === null ? null : (
        <ErrorAlert
          error={error}
          busy={busy}
          canRetry={props.workspaceRoot !== undefined}
          onRetry={recheck}
        />
      )}
      {report === null && phase === 'loading' ? (
        <div data-testid="env-loading" style={EMPTY_STYLE}>
          正在检查环境…
        </div>
      ) : null}
      {report === null ? null : (
        <div style={ENV_BODY_STYLE}>
          <ItemList
            report={report}
            highlighted={highlighted}
            registerCard={registerCard}
            onJump={jumpTo}
            handlers={handlers}
          />
          <CapabilityPanel capabilities={capabilities} />
        </div>
      )}
      {props.workspaceRoot === undefined ? null : <CacheSection state={cache} />}
    </div>
  )
}

/** 本地快照库：位置、条目数与最近写入时间，以及清空入口。 */
interface CacheState {
  readonly info: SnapshotCacheInfo | null
  readonly error: RpcErrorBody | null
  readonly notice: string | null
  readonly busy: boolean
  readonly clear: () => void
}

/**
 * 读本地快照库的信息，并提供清空它的入口。
 * @param client - 面板客户端。
 * @param workspaceRoot - 当前工作区；没有工作区时不发请求。
 * @returns 缓存信息、失败原因、反馈与清空动作。
 */
function useSnapshotCache(client: PanelClient, workspaceRoot: string | undefined): CacheState {
  const [info, setInfo] = React.useState<SnapshotCacheInfo | null>(null)
  const [error, setError] = React.useState<RpcErrorBody | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const load = React.useCallback(async (): Promise<void> => {
    if (workspaceRoot === undefined) return
    const result = await requestCache(client, workspaceRoot, false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setInfo(result.result)
  }, [client, workspaceRoot])

  React.useEffect(() => {
    setInfo(null)
    setError(null)
    setNotice(null)
    void load()
  }, [load])

  const clearAsync = React.useCallback(async (): Promise<void> => {
    if (workspaceRoot === undefined) return
    setBusy(true)
    setError(null)
    setNotice(null)
    const result = await requestCache(client, workspaceRoot, true)
    setBusy(false)
    // 清空失败要说出来，不能让用户以为已经清掉了。
    if (!result.ok) {
      setError(result.error)
      return
    }
    setNotice(`已清除 ${String(result.result.cleared)} 条本地快照。`)
    await load()
  }, [client, workspaceRoot, load])

  const clear = React.useCallback((): void => {
    void clearAsync()
  }, [clearAsync])

  return { info, error, notice, busy, clear }
}

/** 读或清空本地快照库；宿主抛错时也要变成一条能显示的失败原因。 */
async function requestCache(
  client: PanelClient,
  workspaceRoot: string,
  clear: boolean,
): Promise<RpcResult<SnapshotCacheInfo>> {
  try {
    return await client.cache(workspaceRoot, clear ? { clear: true } : undefined)
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : '未知错误'
    return {
      ok: false,
      error: { code: 'fetch-failed', message: `本地快照库操作失败：${detail}` },
    }
  }
}

function CacheSection(props: { readonly state: CacheState }): React.ReactElement {
  const info = props.state.info

  return (
    <section data-testid="env-cache" style={ENV_CACHE_SECTION_STYLE}>
      <div style={ENV_TITLE_STYLE}>本地快照库</div>
      <div data-testid="env-cache-location" style={ENV_DETAIL_STYLE}>
        {info === null ? '正在读取本地快照库…' : info.location}
      </div>
      <div data-testid="env-cache-entries" style={ENV_DETAIL_STYLE}>
        {info === null ? '条目数未知' : `${String(info.entries)} 条快照`}
      </div>
      <div data-testid="env-cache-written" style={ENV_DETAIL_STYLE}>
        {info === null
          ? '写入时间未知'
          : info.lastWrittenAt === null
            ? '还没有写入记录'
            : `最近写入：${formatRelativeTime(info.lastWrittenAt, Date.now())}`}
      </div>
      <button
        type="button"
        data-testid="env-cache-clear"
        data-hover="soft"
        disabled={props.state.busy}
        onClick={props.state.clear}
        style={BUTTON_STYLE}
      >
        {props.state.busy ? '清除中…' : '清除本地快照库'}
      </button>
      {props.state.notice === null ? null : (
        <div data-testid="env-cache-notice" style={ENV_SKIP_STYLE}>
          {props.state.notice}
        </div>
      )}
      {props.state.error === null ? null : (
        <div role="alert" data-testid="env-cache-error" style={ENV_CACHE_ERROR_STYLE}>
          {props.state.error.message}
        </div>
      )}
    </section>
  )
}

function useEnvCheckRequest(client: PanelClient, workspaceRoot: string | undefined): EnvCheckState {
  const [report, setReport] = React.useState<EnvCheckReport | null>(null)
  const [error, setError] = React.useState<RpcErrorBody | null>(null)
  const [phase, setPhase] = React.useState<Phase>('loading')
  const sequence = React.useRef(0)

  const request = React.useCallback(
    async (keepResult: boolean): Promise<void> => {
      const current = sequence.current + 1
      sequence.current = current

      if (workspaceRoot === undefined) {
        setReport(null)
        setError({
          code: 'invalid-params',
          message: '当前会话没有工作区目录，无法检查环境。请在打开的工作区里重新打开面板。',
        })
        setPhase('error')
        return
      }

      setPhase(keepResult ? 'refreshing' : 'loading')
      setError(null)
      const result = await client.envCheck(workspaceRoot)
      if (current !== sequence.current) return

      if (result.ok) {
        setReport(result.result)
        setError(null)
        setPhase('ready')
      } else {
        setError(result.error)
        setPhase('error')
      }
    },
    [client, workspaceRoot],
  )

  React.useEffect(() => {
    setReport(null)
    setError(null)
    void request(false)
  }, [request])

  const recheck = React.useCallback(() => {
    if (phase === 'loading' || phase === 'refreshing') return
    void request(true)
  }, [phase, request])

  return { report, error, phase, recheck }
}

/**
 * 从工单列表跳过来时，定位到该后端第一个失败项：滚动、聚焦并高亮，
 * 与跳过项跳根因共用同一套动作。
 */
function useFocusBackend(
  report: EnvCheckReport | null,
  backend: Exclude<BackendKind, 'markdown'> | null,
  jumpTo: (target: EnvCheckRef) => void,
): void {
  React.useEffect(() => {
    if (report === null || backend === null) return
    const target = report.items.find((item) => item.status === 'fail' && item.subject === backend)
    if (target !== undefined) jumpTo(target)
  }, [report, backend, jumpTo])
}

interface RootCauseJump {
  readonly highlighted: string | null
  readonly registerCard: (key: string, node: HTMLDivElement | null) => void
  readonly jumpTo: (target: EnvCheckRef) => void
}

/** 跳到目标项：滚动到卡片、聚焦并短暂高亮。 */
function useRootCauseJump(): RootCauseJump {
  const cards = React.useRef(new Map<string, HTMLDivElement>())
  const [highlighted, setHighlighted] = React.useState<string | null>(null)

  const registerCard = React.useCallback((key: string, node: HTMLDivElement | null): void => {
    if (node === null) cards.current.delete(key)
    else cards.current.set(key, node)
  }, [])

  const jumpTo = React.useCallback((target: EnvCheckRef): void => {
    const key = refKey(target)
    const node = cards.current.get(key)
    if (node === undefined) return
    if (typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' })
    node.focus()
    setHighlighted(key)
  }, [])

  React.useEffect(() => {
    if (highlighted === null) return undefined
    const timer = window.setTimeout(() => {
      setHighlighted(null)
    }, 1600)
    return () => {
      window.clearTimeout(timer)
    }
  }, [highlighted])

  return { highlighted, registerCard, jumpTo }
}

function refKey(ref: EnvCheckRef): string {
  return `${ref.id}:${ref.subject ?? ''}`
}

function ErrorAlert(props: {
  readonly error: RpcErrorBody
  readonly busy: boolean
  /** 没有工作区时重试也发不出请求：只说明下一步，不放无效按钮。 */
  readonly canRetry: boolean
  readonly onRetry: () => void
}): React.ReactElement {
  return (
    <div role="alert" data-testid="env-error" style={ERROR_STYLE}>
      <div>{props.error.message}</div>
      {props.canRetry ? (
        <button
          type="button"
          data-testid="env-error-retry"
          disabled={props.busy}
          onClick={props.onRetry}
          style={{ ...BUTTON_STYLE, marginTop: 6 }}
        >
          {props.busy ? '检查中…' : '重新检查'}
        </button>
      ) : null}
    </div>
  )
}

function ItemList(props: {
  readonly report: EnvCheckReport
  readonly highlighted: string | null
  readonly handlers: RemedyHandlers
  readonly registerCard: (key: string, node: HTMLDivElement | null) => void
  readonly onJump: (target: EnvCheckRef) => void
}): React.ReactElement {
  return (
    <div
      role="list"
      data-testid="env-items"
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      {props.report.items.map((item) => {
        const key = refKey(item)
        return (
          <div role="listitem" key={key}>
            <ItemCard
              item={item}
              items={props.report.items}
              report={props.report}
              highlighted={props.highlighted === key}
              handlers={props.handlers}
              registerCard={props.registerCard}
              onJump={props.onJump}
            />
          </div>
        )
      })}
    </div>
  )
}

function ItemCard(props: {
  readonly item: EnvCheckItem
  readonly items: readonly EnvCheckItem[]
  readonly report: EnvCheckReport
  readonly highlighted: boolean
  readonly handlers: RemedyHandlers
  readonly registerCard: (key: string, node: HTMLDivElement | null) => void
  readonly onJump: (target: EnvCheckRef) => void
}): React.ReactElement {
  const { item } = props
  const key = refKey(item)
  const blockedBy = item.blockedBy
  const blocker =
    blockedBy === null
      ? undefined
      : props.items.find(
          (candidate) => candidate.id === blockedBy.id && candidate.subject === blockedBy.subject,
        )
  const blockerTitle = blocker === undefined ? null : envCheckTitle(blocker)

  return (
    <div
      ref={(node) => {
        props.registerCard(key, node)
      }}
      data-testid="env-item"
      data-id={item.id}
      data-subject={item.subject ?? ''}
      data-status={item.status}
      data-highlighted={props.highlighted ? 'true' : undefined}
      tabIndex={-1}
      style={{
        ...ENV_CARD_STYLE,
        ...(props.highlighted ? ENV_CARD_HIGHLIGHT_STYLE : undefined),
      }}
    >
      <StatusIcon status={item.status} />
      <div style={{ minWidth: 0 }}>
        <div data-testid="env-item-title" style={ENV_TITLE_STYLE}>
          {envCheckTitle(item)}
        </div>
        <div data-testid="env-item-detail" style={ENV_DETAIL_STYLE}>
          {item.detail}
        </div>
        {item.status === 'fail' ? (
          <RemedySection item={item} report={props.report} handlers={props.handlers} />
        ) : null}
        {blockerTitle === null || blockedBy === null ? null : (
          <div data-testid="env-item-blocked" style={ENV_SKIP_STYLE}>
            因为「{blockerTitle}」未通过
            <button
              type="button"
              data-testid="env-jump"
              aria-label={`跳到「${blockerTitle}」`}
              onClick={() => {
                props.onJump(blockedBy)
              }}
              style={{ ...ENV_HIGHLIGHT_STYLE, marginLeft: 6 }}
            >
              跳到「{blockerTitle}」
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function StatusIcon(props: { readonly status: EnvCheckStatus }): React.ReactElement {
  const color = ENV_STATUS_COLORS[props.status]
  const path =
    props.status === 'pass'
      ? 'M4.5 8.5l2.5 2.5 4.5-5'
      : props.status === 'fail'
        ? 'M5 5l6 6M11 5l-6 6'
        : 'M4.5 8h7'

  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      role="img"
      aria-label={ENV_STATUS_LABELS[props.status]}
      style={{ color, flex: 'none', marginTop: 1 }}
    >
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.3" />
      <path d={path} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  )
}
