/**
 * 错误码到用户可操作提示的映射。列表视图与详情视图共用同一套文案，
 * 同一个后端故障在两个入口不会给出两种说法。
 */
import { ENV_ISSUE_ERROR_CODES, type ErrorCode, type RpcErrorBody } from '../protocol/tracker.ts'

const ERROR_MESSAGES: Partial<Record<ErrorCode, string>> = {
  'gh-missing': '未找到 gh 命令，请先安装 GitHub CLI（https://cli.github.com）。',
  'gh-unauthenticated': 'gh 未登录，请运行 gh auth login 后重试。',
  'glab-missing': '未找到 glab 命令，请先安装 GitLab CLI（https://gitlab.com/gitlab-org/cli）。',
  'glab-unauthenticated': 'glab 未登录或令牌已失效，请运行 glab auth login 后重试。',
  'tea-missing': '未找到 tea 命令，请先安装 Gitea CLI（https://gitea.com/gitea/tea）。',
  'tea-unauthenticated': 'tea 未登录该实例或令牌已失效，请运行 tea login add 后重试。',
  'markdown-read-failed': '读取 .scratch 里的工单失败，请检查文件读取权限。',
  'ticket-not-found': '找不到这张工单，它可能已被删除。',
}

/**
 * 把 RPC 错误翻译成一句可操作的提示。
 * @param error - 宿主返回的错误体。
 * @returns 固定文案；没有固定文案时用后端给的诊断。
 */
export function errorText(error: RpcErrorBody): string {
  return ERROR_MESSAGES[error.code] ?? error.message
}

/**
 * 是否属于环境问题；列表视图据此给出「查看环境检查」入口。
 * @param code - 错误码。
 * @returns 环境类错误码时为 true。
 */
export function isEnvIssue(code: ErrorCode): boolean {
  return ENV_ISSUE_ERROR_CODES.includes(code)
}
