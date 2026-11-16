/**
 * 列表视图的仓库行：仓库标识、后端与数据来源、快照时间、刷新失败原因与两个刷新按钮。
 * 与列表主体分开，保持刷新状态集中在一个组件里。
 */
import * as React from 'react'

import type { SnapshotSource, WorkspaceSnapshot } from '../protocol/tracker.ts'
import { backendLabel } from './backend-label.ts'
import { FolderIcon, RefreshIcon } from './icons.tsx'
import { useI18n } from './i18n.tsx'
import { formatRelativeTime } from './relative-time.ts'
import {
  AGE_STYLE,
  BACKEND_BADGE_STYLE,
  BUTTON_STYLE,
  COLORS,
  HEADER_STYLE,
  REFRESH_BUTTON_STYLE,
  REPO_CHIP_STYLE,
  REPO_HOST_STYLE,
  REPO_NAME_STYLE,
} from './task-panel-styles.ts'

/** 全量刷新是次要动作：描边按钮，和刷新按钮并排但不同层级。 */
const SECONDARY_BUTTON_STYLE: React.CSSProperties = {
  ...BUTTON_STYLE,
  padding: '2px 6px',
  fontSize: 12,
  color: COLORS.secondary,
}

/** 刷新失败原因：贴在数据时间旁边，说明数据没更新，但不盖住列表。 */
const REFRESH_ERROR_STYLE: React.CSSProperties = {
  color: COLORS.error,
  fontSize: 12,
  maxWidth: 160,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

/** 列表视图仓库行依赖。 */
export interface TicketsHeaderProps {
  readonly snapshot: WorkspaceSnapshot | null
  readonly now: number
  readonly loading: boolean
  readonly busy: boolean
  /** 数据旁边的失败原因：有数据时显示在时间旁边，不用整屏横幅盖住列表。 */
  readonly notice: string | null
  readonly onRefresh: () => void
  readonly onRefreshFull: () => void
}

/** 列表视图仓库行。 */
export function TicketsHeader(props: TicketsHeaderProps): React.ReactElement {
  const { t } = useI18n()

  return (
    <header style={HEADER_STYLE}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <div style={REPO_CHIP_STYLE}>
          <FolderIcon />
          <span
            data-testid="repo-name"
            style={REPO_NAME_STYLE}
            {...(props.snapshot === null ? {} : { title: props.snapshot.repository })}
          >
            {props.snapshot?.repository ??
              (props.loading ? t('repo.identifying') : t('repo.unidentified'))}
          </span>
        </div>
        {props.snapshot === null ? null : (
          <span data-testid="backend-badge" style={BACKEND_BADGE_STYLE}>
            {backendLabel(props.snapshot.backend, t)}
          </span>
        )}
        {/* 数据来源：本地缓存的数据不是实时的，必须让用户一眼看出来。 */}
        {props.snapshot === null ? null : <SourceBadge source={props.snapshot.source} />}
        {/* 自建 Gitea 可能同时登录多个实例，主机名是区分同名仓库的唯一线索。 */}
        {props.snapshot?.backend === 'gitea' && props.snapshot.repositoryHost !== null ? (
          <span
            data-testid="repo-host"
            title={props.snapshot.repositoryHost}
            style={REPO_HOST_STYLE}
          >
            {props.snapshot.repositoryHost}
          </span>
        ) : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 'none' }}>
        <span data-testid="snapshot-age" style={AGE_STYLE}>
          {props.snapshot === null
            ? t('snapshot.none')
            : formatRelativeTime(props.snapshot.fetchedAt, props.now, t)}
        </span>
        {props.notice === null ? null : (
          <span data-testid="refresh-error" title={props.notice} style={REFRESH_ERROR_STYLE}>
            {props.notice}
          </span>
        )}
        <button
          type="button"
          data-testid="refresh"
          data-hover="soft"
          disabled={props.busy}
          onClick={props.onRefresh}
          style={{ ...REFRESH_BUTTON_STYLE, opacity: props.busy ? 0.6 : 1 }}
        >
          <RefreshIcon />
          {props.busy ? t('refresh.busy') : t('refresh.action')}
        </button>
        <button
          type="button"
          data-testid="refresh-full"
          data-hover="soft"
          disabled={props.busy}
          onClick={props.onRefreshFull}
          style={{ ...SECONDARY_BUTTON_STYLE, opacity: props.busy ? 0.6 : 1 }}
        >
          {t('refresh.full')}
        </button>
      </div>
    </header>
  )
}

/** 数据来源徽标：本地缓存的数据不是实时的，标出来才不会误判。 */
function SourceBadge(props: { readonly source: SnapshotSource }): React.ReactElement {
  const { t } = useI18n()
  return (
    <span
      data-testid="snapshot-source"
      style={{
        ...BACKEND_BADGE_STYLE,
        color: props.source === 'cache' ? COLORS.warn : COLORS.secondary,
      }}
    >
      {props.source === 'cache' ? t('source.cache') : t('source.live')}
    </span>
  )
}
