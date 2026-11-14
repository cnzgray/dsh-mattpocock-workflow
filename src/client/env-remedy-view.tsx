/**
 * 解决区：失败项依据下面的一段可执行做法。
 * 按动作类型渲染会话动作、可复制命令或重试按钮；文案来自 env-remedy-text。
 */
import * as React from 'react'

import type { EnvCheckItem, EnvCheckReport } from '../protocol/env-check.ts'
import {
  ENV_COMMAND_STYLE,
  ENV_DETAIL_STYLE,
  ENV_REMEDY_ACTIONS_STYLE,
  ENV_REMEDY_COMMAND_WRAP_STYLE,
  ENV_REMEDY_LINK_STYLE,
  ENV_REMEDY_NOTICE_STYLE,
  ENV_REMEDY_STYLE,
  ENV_SKIP_STYLE,
} from './env-check-styles.ts'
import { envCheckTitle } from './env-check-text.ts'
import type { PromptInjection } from './injection.ts'
import { remedyContent, type RemedyAction } from './env-remedy-text.ts'
import { BUTTON_STYLE } from './task-panel-styles.ts'

/** 解决动作需要的界面能力与回调。 */
export interface RemedyHandlers {
  readonly injection: PromptInjection
  readonly busy: boolean
  readonly onRetry: () => void
}

/**
 * 失败项的解决区；没有解决时不渲染。
 * @param props - 失败项、报告上下文与动作回调。
 * @returns 摘要、动作与可选链接。
 */
export function RemedySection(props: {
  readonly item: EnvCheckItem
  readonly report: EnvCheckReport
  readonly handlers: RemedyHandlers
}): React.ReactElement | null {
  const remedy = props.item.remedy
  if (remedy === null) return null

  const content = remedyContent(remedy.code, {
    backend: props.report.backend,
    repository: props.report.repository,
    subject: remedy.subject ?? props.item.subject,
    title: envCheckTitle(props.item),
    detail: props.item.detail,
  })

  return (
    <div data-testid="env-remedy" data-code={remedy.code} style={ENV_REMEDY_STYLE}>
      <div data-testid="env-remedy-summary" style={ENV_DETAIL_STYLE}>
        {content.summary}
      </div>
      <RemedyActionView action={content.action} handlers={props.handlers} />
      {content.link === undefined ? null : (
        <a
          data-testid="env-remedy-link"
          href={content.link.href}
          target="_blank"
          rel="noreferrer"
          style={ENV_REMEDY_LINK_STYLE}
        >
          {content.link.label}
        </a>
      )}
    </div>
  )
}

function RemedyActionView(props: {
  readonly action: RemedyAction
  readonly handlers: RemedyHandlers
}): React.ReactElement {
  switch (props.action.kind) {
    case 'command':
      return (
        <div style={ENV_REMEDY_COMMAND_WRAP_STYLE}>
          <pre data-testid="env-remedy-command" tabIndex={0} style={ENV_COMMAND_STYLE}>
            <code>{props.action.command}</code>
          </pre>
          <CopyButton
            text={props.action.command}
            label="复制命令"
            noun="命令"
            testId="env-remedy-copy-command"
          />
        </div>
      )
    case 'session':
      return <SessionAction prompt={props.action.prompt} injection={props.handlers.injection} />
    case 'retry':
      return (
        <button
          type="button"
          data-testid="env-remedy-retry"
          disabled={props.handlers.busy}
          onClick={props.handlers.onRetry}
          style={BUTTON_STYLE}
        >
          {props.handlers.busy ? '检查中…' : '重新检查'}
        </button>
      )
  }
}

function SessionAction(props: {
  readonly prompt: string
  readonly injection: PromptInjection
}): React.ReactElement {
  const [fillFailed, setFillFailed] = React.useState(false)
  const canInject = props.injection.canInjectCurrent

  return (
    <div style={ENV_REMEDY_ACTIONS_STYLE}>
      <button
        type="button"
        data-testid="env-remedy-fill"
        aria-label="填入输入框，把解决提示词放进当前会话"
        disabled={!canInject}
        onClick={() => {
          setFillFailed(props.injection.inject(props.prompt, 'current-session') !== 'filled')
        }}
        style={BUTTON_STYLE}
      >
        填入输入框
      </button>
      <CopyButton
        text={props.prompt}
        label="复制提示词"
        noun="提示词"
        testId="env-remedy-copy-prompt"
      />
      {canInject ? null : (
        <div data-testid="env-remedy-no-session" style={ENV_SKIP_STYLE}>
          当前没有可用会话，无法填入输入框；可以复制提示词。
        </div>
      )}
      {fillFailed ? (
        <div role="status" data-testid="env-remedy-fill-failed" style={ENV_REMEDY_NOTICE_STYLE}>
          填入失败：当前会话不可用。
        </div>
      ) : null}
    </div>
  )
}

function CopyButton(props: {
  readonly text: string
  readonly label: string
  readonly noun: string
  readonly testId: string
}): React.ReactElement {
  const [state, setState] = React.useState<'idle' | 'copied' | 'failed'>('idle')

  React.useEffect(() => {
    if (state === 'idle') return undefined
    const timer = window.setTimeout(() => {
      setState('idle')
    }, 1500)
    return () => {
      window.clearTimeout(timer)
    }
  }, [state])

  return (
    <div style={ENV_REMEDY_ACTIONS_STYLE}>
      <button
        type="button"
        data-testid={props.testId}
        onClick={() => {
          void copyText(props.text).then((copied) => {
            setState(copied ? 'copied' : 'failed')
          })
        }}
        style={BUTTON_STYLE}
      >
        {state === 'copied' ? '已复制' : props.label}
      </button>
      {state === 'failed' ? (
        <span role="status" data-testid={`${props.testId}-failed`} style={ENV_REMEDY_NOTICE_STYLE}>
          复制失败，请手动选择{props.noun}。
        </span>
      ) : null}
    </div>
  )
}

async function copyText(text: string): Promise<boolean> {
  // jsdom 与部分浏览器不实现 navigator.clipboard，按可选能力处理。
  const { clipboard } = navigator as { clipboard?: Clipboard }
  if (clipboard === undefined) return false
  try {
    await clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
