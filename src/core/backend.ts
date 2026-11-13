/**
 * 后端选择规则。宿主只负责拿到输入（远端地址、`glab auth status` 输出），
 * 选哪种后端只在这里判定一次，测试不需要启动 DSH。
 */
import type { BackendKind } from '../protocol/backend.ts'
import { normalizeHost, type RepositoryAddress } from './remote.ts'

const LOGGED_IN = /^\s*[✓✔]\s+Logged in to\s+(\S+)/i

/** GitHub 的主机名。后端选择与 GitHub 适配器共用。 */
export const GITHUB_HOST = 'github.com'

/** GitLab.com 的主机名。自建实例按 `glab auth status` 判断。 */
export const GITLAB_HOST = 'gitlab.com'

/** 判定一个工作区用哪个后端时所依据的事实。 */
export type BackendSource = 'remote' | 'glab-auth' | 'no-remote' | 'unsupported-remote'

/** 后端判定结果：选中的后端与依据。 */
export interface BackendChoice {
  readonly kind: BackendKind
  /** `remote` 是主机名直接命中，`glab-auth` 是自建实例已登录，其余是回退本地。 */
  readonly source: BackendSource
}

/**
 * 从 `gh auth status` / `glab auth status` 的输出里收集已登录主机。
 *
 * 只认“✓ Logged in to <host>”这一种行：两个 CLI 各版本的提示语不同，
 * 宁可漏认（回退本地 Markdown）也不误认。
 * @param output - 登录状态命令的标准输出与标准错误。
 * @returns 去重后的主机名，已规范化。
 */
export function parseLoggedInHosts(output: string): string[] {
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
 * @returns 后端类型与判定依据。
 */
export function chooseBackend(
  address: RepositoryAddress | undefined,
  glabHosts: readonly string[],
): BackendChoice {
  if (address === undefined) return { kind: 'markdown', source: 'no-remote' }

  const host = normalizeHost(address.host)
  if (host === GITHUB_HOST) return { kind: 'github', source: 'remote' }
  if (host === GITLAB_HOST) return { kind: 'gitlab', source: 'remote' }
  if (glabHosts.some((candidate) => normalizeHost(candidate) === host)) {
    return { kind: 'gitlab', source: 'glab-auth' }
  }
  return { kind: 'markdown', source: 'unsupported-remote' }
}
