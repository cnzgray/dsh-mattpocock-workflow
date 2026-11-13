/**
 * 工单后端类型。宿主按工作区的 `origin` 远端自动选择，界面只据此显示徽标：
 * - `github`：`github.com` 仓库，通过 `gh` 读取；
 * - `gitlab`：`gitlab.com` 或 `glab` 已登录的自建实例，通过 `glab` 读取；
 * - `gitea`：`tea` 已登录的自建实例，通过 `tea` 读取；
 * - `markdown`：其余情况，读取工作区里的 `.scratch/<feature>/issues/*.md`。
 *
 * 单独成文件：快照契约和环境检查契约都要用它，放在其中一个文件里会让两个
 * protocol 模块互相引用。
 */
export type BackendKind = 'github' | 'gitlab' | 'gitea' | 'markdown'

/**
 * 后端在界面与错误提示里的显示名。宿主写「哪个后端不支持哪项能力」、
 * 界面画后端徽标都用这一份，两处文案不会脱节。
 */
export const BACKEND_LABELS: Record<BackendKind, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  gitea: 'Gitea',
  markdown: '本地',
}
