/**
 * 能力诊断面板：插件用到的 DSH 宿主服务与界面扩展点是否可用。
 * 缺失项除状态外还写明影响与补法，文案来自词典。
 */
import * as React from 'react'

import type { CapabilityDiagnostic } from '../protocol/env-check.ts'
import {
  CAPABILITIES_STYLE,
  CAPABILITY_IMPACT_STYLE,
  CAPABILITY_ROW_STYLE,
} from './env-check-styles.ts'
import { capabilityText } from './env-check-text.ts'
import { useI18n } from './i18n.tsx'
import { COLORS } from './task-panel-styles.ts'

/**
 * 默认折叠的能力诊断。
 * @param props - 宿主与界面能力合并后的列表。
 * @returns 折叠面板与逐行说明。
 */
export function CapabilityPanel(props: {
  readonly capabilities: readonly CapabilityDiagnostic[]
}): React.ReactElement {
  const { t } = useI18n()
  const present = props.capabilities.filter((entry) => entry.status === 'present').length
  const missing = props.capabilities.length - present

  return (
    <details data-testid="capabilities" style={CAPABILITIES_STYLE}>
      <summary data-testid="capabilities-summary" style={{ cursor: 'pointer' }}>
        {t('capability.summary', { present, missing })}
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
  const { t } = useI18n()
  const text = capabilityText(props.diagnostic, t)
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
      {text.impact === null ? null : (
        <div data-testid="capability-impact" style={CAPABILITY_IMPACT_STYLE}>
          <div>
            {t('capability.impactLabel')}
            {text.impact}
          </div>
          {text.fix === null ? null : (
            <div>
              {t('capability.fixLabel')}
              {text.fix}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
