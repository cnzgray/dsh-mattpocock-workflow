/**
 * 父子布局的控件与说明：布局切换段、层级来源的悬停说明。
 * 从列表视图拆出来，列表本身只负责状态与渲染顺序。
 */
import * as React from 'react'

import type { WorkspaceSnapshot } from '../protocol/tracker.ts'
import { useI18n } from './i18n.tsx'
import { FlatListIcon, TreeListIcon } from './icons.tsx'
import type { MessageKey } from './messages.ts'
import {
  CHIP_ACTIVE_STYLE,
  CHIP_STYLE,
  ICON_CHIP_STYLE,
  ICON_SEGMENTED_STYLE,
} from './task-panel-styles.ts'
import type { TicketLayout } from './view-preference.ts'

/**
 * 布局控件的悬停说明：结合后端与父子能力枚举写明层级来源。
 * @param snapshot - 当前快照。
 * @returns 说明文案的词典键。
 */
export function hierarchyHintKey(snapshot: WorkspaceSnapshot): MessageKey {
  if (snapshot.hierarchy === 'none') {
    if (snapshot.backend === 'gitea') return 'layout.giteaUnavailable'
    if (snapshot.backend === 'gitlab') return 'layout.gitlabUnavailable'
    return 'layout.none'
  }
  if (snapshot.backend === 'github') return 'layout.github'
  if (snapshot.backend === 'gitlab') return 'layout.gitlab'
  return 'layout.markdown'
}

/** 布局切换：平铺与父子两个图标段。没有父子能力的后端只禁用父子这一段。 */
export function LayoutControl(props: {
  readonly layout: TicketLayout
  readonly hierarchyAvailable: boolean
  readonly hierarchyHint: string
  readonly onLayout: (layout: TicketLayout) => void
}): React.ReactElement {
  const { t } = useI18n()
  return (
    <div role="group" aria-label={t('layout.group')} style={ICON_SEGMENTED_STYLE}>
      <button
        type="button"
        data-testid="layout-flat"
        aria-pressed={props.layout === 'flat'}
        data-hover="soft"
        aria-label={t('layout.flat')}
        title={t('layout.flatTitle')}
        onClick={() => {
          props.onLayout('flat')
        }}
        style={{
          ...CHIP_STYLE,
          ...ICON_CHIP_STYLE,
          ...(props.layout === 'flat' ? CHIP_ACTIVE_STYLE : undefined),
        }}
      >
        <FlatListIcon />
      </button>
      <button
        type="button"
        data-testid="layout-tree"
        aria-pressed={props.layout === 'tree'}
        disabled={!props.hierarchyAvailable}
        data-hover="soft"
        aria-label={t('layout.tree')}
        title={props.hierarchyHint}
        onClick={() => {
          props.onLayout('tree')
        }}
        style={{
          ...CHIP_STYLE,
          ...ICON_CHIP_STYLE,
          ...(props.layout === 'tree' ? CHIP_ACTIVE_STYLE : undefined),
        }}
      >
        <TreeListIcon />
      </button>
    </div>
  )
}
