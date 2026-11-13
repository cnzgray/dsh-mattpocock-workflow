/**
 * 环境检查视图。只依赖注入的面板客户端和界面能力读取函数，
 * 因此 Vitest + jsdom 就能测自动检查、三种状态、跳过原因、建议文案与能力诊断。
 */
import * as React from 'react'

import type {
  CapabilityDiagnostic,
  EnvCheckItem,
  EnvCheckReport,
  EnvCheckStatus,
} from '../protocol/env-check.ts'
import type { RpcErrorBody } from '../protocol/tracker.ts'
import { capabilityText, envCheckTitle, envSuggestionText } from './env-check-text.ts'
import {
  CAPABILITIES_STYLE,
  CAPABILITY_ROW_STYLE,
  ENV_BACKEND_STYLE,
  ENV_BODY_STYLE,
  ENV_CARD_STYLE,
  ENV_DETAIL_STYLE,
  ENV_HEADER_STYLE,
  ENV_SKIP_STYLE,
  ENV_STATUS_COLORS,
  ENV_STATUS_LABELS,
  ENV_SUGGESTION_STYLE,
  ENV_SUMMARY_STYLE,
  ENV_TITLE_STYLE,
} from './env-check-styles.ts'
import type { PanelClient } from './rpc.ts'
import { BUTTON_STYLE, COLORS, EMPTY_STYLE, ERROR_STYLE } from './task-panel-styles.ts'

/** 环境检查视图依赖。 */
export interface EnvCheckViewProps {
  readonly client: PanelClient
  readonly workspaceRoot: string | undefined
  /** 界面扩展点探测结果；由插件入口在服务就绪后更新。 */
  readonly clientCapabilities: () => readonly CapabilityDiagnostic[]
}

type Phase = 'loading' | 'ready' | 'refreshing' | 'error'

interface EnvCheckState {
  readonly report: EnvCheckReport | null
  readonly error: RpcErrorBody | null
  readonly phase: Phase
  readonly recheck: () => void
}

/**
 * 环境检查视图根组件：打开时自动检查，重新检查时保留上一次结果。
 * @param props - 面板客户端、工作区与界面能力读取函数。
 * @returns 检查结果列表与能力诊断。
 */
export function EnvCheckView(props: EnvCheckViewProps): React.ReactElement {
  const { report, error, phase, recheck } = useEnvCheckRequest(props.client, props.workspaceRoot)
  const busy = phase === 'loading' || phase === 'refreshing'
  const capabilities = mergeCapabilities(report, props.clientCapabilities)

  return (
    <div
      data-testid="env-check-view"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      <header style={ENV_HEADER_STYLE}>
        <span data-testid="env-summary" style={ENV_SUMMARY_STYLE}>
          环境检查 {countPassed(report)}/{report?.items.length ?? 0}
        </span>
        <span data-testid="env-backend" style={ENV_BACKEND_STYLE}>
          {report?.backend ?? '未判定'}
        </span>
        <button
          type="button"
          data-testid="env-recheck"
          disabled={busy}
          onClick={recheck}
          style={BUTTON_STYLE}
        >
          {busy ? '检查中…' : '重新检查'}
        </button>
      </header>

      {error === null ? null : <ErrorAlert error={error} />}
      {report === null && phase === 'loading' ? (
        <div data-testid="env-loading" style={EMPTY_STYLE}>
          正在检查环境…
        </div>
      ) : null}
      {report === null ? null : (
        <div style={ENV_BODY_STYLE}>
          <ItemList report={report} />
          <CapabilityPanel capabilities={capabilities} />
        </div>
      )}
    </div>
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
        setError({ code: 'invalid-params', message: '当前会话没有工作区目录，无法检查环境。' })
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

function countPassed(report: EnvCheckReport | null): number {
  return report?.items.filter((item) => item.status === 'pass').length ?? 0
}

function mergeCapabilities(
  report: EnvCheckReport | null,
  readClientCapabilities: () => readonly CapabilityDiagnostic[],
): readonly CapabilityDiagnostic[] {
  return [...(report?.capabilities ?? []), ...readClientCapabilities()]
}

function ErrorAlert(props: { readonly error: RpcErrorBody }): React.ReactElement {
  return (
    <div role="alert" data-testid="env-error" style={ERROR_STYLE}>
      {props.error.message}
    </div>
  )
}

function ItemList(props: { readonly report: EnvCheckReport }): React.ReactElement {
  return (
    <div
      role="list"
      data-testid="env-items"
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      {props.report.items.map((item) => (
        <div role="listitem" key={`${item.id}:${item.subject ?? ''}`}>
          <ItemCard item={item} items={props.report.items} />
        </div>
      ))}
    </div>
  )
}

function ItemCard(props: {
  readonly item: EnvCheckItem
  readonly items: readonly EnvCheckItem[]
}): React.ReactElement {
  const { item } = props
  const suggestion = envSuggestionText(item)
  const blockedTitle = blockedTitleOf(item, props.items)

  return (
    <div
      data-testid="env-item"
      data-id={item.id}
      data-subject={item.subject ?? ''}
      data-status={item.status}
      style={ENV_CARD_STYLE}
    >
      <StatusIcon status={item.status} />
      <div style={{ minWidth: 0 }}>
        <div data-testid="env-item-title" style={ENV_TITLE_STYLE}>
          {envCheckTitle(item)}
        </div>
        <div data-testid="env-item-detail" style={ENV_DETAIL_STYLE}>
          {item.detail}
        </div>
        {blockedTitle === null ? null : (
          <div data-testid="env-item-blocked" style={ENV_SKIP_STYLE}>
            因为「{blockedTitle}」未通过
          </div>
        )}
        {suggestion === null ? null : (
          <div data-testid="env-item-suggestion" style={ENV_SUGGESTION_STYLE}>
            修复：{suggestion}
          </div>
        )}
      </div>
    </div>
  )
}

function blockedTitleOf(item: EnvCheckItem, items: readonly EnvCheckItem[]): string | null {
  const blockedBy = item.blockedBy
  if (blockedBy === null) return null
  const blocker = items.find(
    (candidate) => candidate.id === blockedBy.id && candidate.subject === blockedBy.subject,
  )
  return blocker === undefined ? null : envCheckTitle(blocker)
}

function CapabilityPanel(props: {
  readonly capabilities: readonly CapabilityDiagnostic[]
}): React.ReactElement {
  const present = props.capabilities.filter((entry) => entry.status === 'present').length
  const missing = props.capabilities.length - present

  return (
    <details data-testid="capabilities" style={CAPABILITIES_STYLE}>
      <summary data-testid="capabilities-summary" style={{ cursor: 'pointer' }}>
        能力诊断 · present {present} / missing {missing}
      </summary>
      <div style={{ paddingTop: 4 }}>
        {props.capabilities.map((entry) => (
          <CapabilityRow key={`${entry.category}:${entry.id}`} diagnostic={entry} />
        ))}
      </div>
    </details>
  )
}

function CapabilityRow(props: { readonly diagnostic: CapabilityDiagnostic }): React.ReactElement {
  const text = capabilityText(props.diagnostic)
  return (
    <div
      data-testid="capability"
      data-id={props.diagnostic.id}
      data-status={props.diagnostic.status}
      style={CAPABILITY_ROW_STYLE}
    >
      <span style={{ overflowWrap: 'anywhere' }}>{text.label}</span>
      <span style={{ color: COLORS.tertiary }}>{text.category}</span>
      <span
        style={{
          color: props.diagnostic.status === 'present' ? COLORS.success : COLORS.error,
        }}
      >
        {text.state}
      </span>
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
