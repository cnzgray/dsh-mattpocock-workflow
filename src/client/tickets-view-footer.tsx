/**
 * 列表底部的注入状态：没有可用会话、提示词刚填入或注入失败时说明原因。
 * 正常情况（能填当前会话且没有提示）不占位置。
 */
import * as React from 'react'

import { useI18n } from './i18n.tsx'
import type { PromptInjection } from './injection.ts'
import { COLORS } from './task-panel-styles.ts'
import type { NoticeTone } from './use-draft-injection.ts'

/** 列表底部提示。 */
export function Footer(props: {
  readonly injection: PromptInjection
  readonly notice: string | null
  readonly tone: NoticeTone | null
}): React.ReactElement | null {
  const { t } = useI18n()
  if (props.injection.canInjectCurrent && props.notice === null) return null

  return (
    <footer
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '8px 12px',
        borderTop: `1px solid ${COLORS.border}`,
      }}
    >
      {props.injection.canInjectCurrent ? null : (
        <div data-testid="no-session-hint" style={{ color: COLORS.secondary, fontSize: 12 }}>
          {t(
            props.injection.canStartNewSession
              ? 'injection.footerNewSession'
              : 'injection.footerUnavailable',
          )}
        </div>
      )}
      {props.notice === null ? null : (
        <div
          role="status"
          data-testid="inject-notice"
          style={{ color: props.tone === 'error' ? COLORS.warn : COLORS.secondary, fontSize: 12 }}
        >
          {props.notice}
        </div>
      )}
    </footer>
  )
}
