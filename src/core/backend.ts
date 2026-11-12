/**
 * 后端选择规则。宿主只负责拿到输入（远端地址、`glab auth status` 输出），
 * 选哪种后端只在这里判定一次，测试不需要启动 DSH。
 */
import type { BackendKind } from '../protocol/tracker.ts'
import { normalizeHost, type RepositoryAddress } from './remote.ts'

const LOGGED_IN = /^\s*[✓✔]\s+Logged in to\s+(\S+)/i

/** GitHub 的主机名。后端选择与 GitHub 适配器共用。 */
export const GITHUB_HOST = 'github.com'

/** GitLab.com 的主机名。自建实例按 `glab auth status` 判断。 */
export const GITLAB_HOST = 'gitlab.com'

/**
 * 从 `glab auth status` 的输出里收集已登录主机。
 *
 * 只认“✓ Logged in to <host>”这一种行：`glab` 各版本的提示语不同，
 * 宁可漏认（回退本地 Markdown）也不误认。
 * @param output - `glab auth status` 的标准输出。
 * @returns 去重后的主机名，已规范化。
 */
export function parseGlabAuthHosts(output: string): string[] {
  const hosts: string[] = []
  const seen = new Set<string>()

  for (const line of output.split('\n')) {
    const match = LOGGED_IN.exec(line)
    if (match === null) continue
    const host = match[1]
    if (host === undefined) continue
    const normalized = normalizeHost(host)
    if (normalized.length === 0 || seen.has(normalized)) continue
    seen.add(normalized)
    hosts.push(normalized)
  }

  return hosts
}

/**
 * 选择工单后端。
 *
 * 主机比较不区分大小写、忽略端口；`origin` 已在 {@link RepositoryAddress} 里选好。
 * @param address - 当前工作区 `origin` 的地址；没有 git 或没有远端时为 undefined。
 * @param glabHosts - `glab auth status` 报告已登录的主机。
 * @returns 后端类型。
 */
export function selectBackend(
  address: RepositoryAddress | undefined,
  glabHosts: readonly string[],
): BackendKind {
  if (address === undefined) return 'markdown'

  const host = normalizeHost(address.host)
  if (host === GITHUB_HOST) return 'github'
  if (host === GITLAB_HOST) return 'gitlab'
  if (glabHosts.some((candidate) => normalizeHost(candidate) === host)) return 'gitlab'
  return 'markdown'
}
