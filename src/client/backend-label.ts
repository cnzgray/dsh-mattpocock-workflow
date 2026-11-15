/**
 * 后端在界面上的短名。工单列表徽标、详情头部与环境检查共用这一份推导，
 * 新增后端只改这一处；本地面板显示名跟随界面语言。
 */
import { BACKEND_LABELS, type BackendKind } from '../protocol/backend.ts'
import type { Translate } from './i18n-runtime.ts'

/**
 * 后端的短显示名。
 * @param backend - 后端类型。
 * @param t - 翻译入口；省略时用内置中文。
 * @returns GitHub / GitLab / Gitea 原样，本地 Markdown 按语言显示。
 */
export function backendLabel(backend: BackendKind, t: Translate): string {
  return backend === 'markdown' ? t('backend.markdown') : BACKEND_LABELS[backend]
}
