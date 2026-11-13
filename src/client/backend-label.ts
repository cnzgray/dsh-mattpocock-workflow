/**
 * 后端在界面上的短名。工单列表徽标与环境检查的 candidate 标题共用这一张表，
 * 新增后端只改这一处。
 */
import type { BackendKind } from '../protocol/backend.ts'

export const BACKEND_LABELS: Readonly<Record<string, string>> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  gitea: 'Gitea',
  markdown: '本地',
} satisfies Record<BackendKind, string>
