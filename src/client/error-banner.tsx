/**
 * 快照读取失败时的统一提示。列表与概览共用同一组文案与“查看环境检查”入口，
 * 不各自维护一份。
 */
import * as React from 'react'

import type { ErrorCode, RpcErrorBody } from '../protocol/tracker.ts'
import { errorText, isEnvIssue } from './error-text.ts'
import { BUTTON_STYLE, ERROR_STYLE } from './task-panel-styles.ts'

/** 错误横幅依赖。 */
export interface ErrorBannerProps {
  readonly error: RpcErrorBody
  /** 环境问题错误码的后续入口；其他错误不显示按钮。 */
  readonly onOpenEnvCheck: (code: ErrorCode) => void
}

/**
 * 渲染错误提示与可选的环境检查入口。
 * @param props - 错误与跳转回调。
 * @returns 错误横幅。
 */
export function ErrorBanner(props: ErrorBannerProps): React.ReactElement {
  return (
    <div role="alert" data-testid="error" style={ERROR_STYLE}>
      <div>{errorText(props.error)}</div>
      {isEnvIssue(props.error.code) ? (
        <button
          type="button"
          data-testid="open-env-check"
          data-hover="soft"
          onClick={() => {
            props.onOpenEnvCheck(props.error.code)
          }}
          style={{ ...BUTTON_STYLE, marginTop: 6 }}
        >
          查看环境检查
        </button>
      ) : null}
    </div>
  )
}
