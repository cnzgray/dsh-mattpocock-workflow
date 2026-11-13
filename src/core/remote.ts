/**
 * `git remote -v` 的解析。三个后端共用这一份规则：
 * 优先 `origin`，没有时取第一个远端，再把 URL 拆成主机与路径。
 * 路径允许嵌套，GitLab 的 group 可以有多层。
 */

/** 一个 git 远端。 */
export interface RemoteEntry {
  readonly name: string
  readonly url: string
}

/** 远端地址：主机名（小写、不含端口）与仓库路径。 */
export interface RepositoryAddress {
  readonly host: string
  readonly path: string
}

const REMOTE_LINE = /^(\S+)\s+(\S+)\s+\((?:fetch|push)\)$/
const SCP_LIKE = /^[^@\s/]+@([^:/\s]+):(.+)$/
const SCHEME = /^(?:ssh|git|https?):\/\/(?:[^@/\s]+@)?([^:/\s]+)(?::\d+)?\/(.+)$/
const HOST = /^[A-Za-z0-9.-]+$/
const REPOSITORY_SEGMENT = /^[A-Za-z0-9_.-]+$/

/**
 * 解析 `git remote -v` 的输出，按出现顺序去重（fetch 与 push 是同一远端）。
 * @param output - git 的标准输出。
 * @returns 远端列表。
 */
export function parseRemotes(output: string): RemoteEntry[] {
  const seen = new Set<string>()
  const remotes: RemoteEntry[] = []

  for (const rawLine of output.split('\n')) {
    const match = REMOTE_LINE.exec(rawLine.trim())
    if (match === null) continue
    const name = match[1]
    const url = match[2]
    if (name === undefined || url === undefined) continue
    const key = `${name}\u0000${url}`
    if (seen.has(key)) continue
    seen.add(key)
    remotes.push({ name, url })
  }

  return remotes
}

/**
 * 选一个远端：优先 `origin`；没有 `origin` 时取第一个。
 * @param remotes - 已解析的远端列表。
 * @returns 选中的远端，或没有远端时的 undefined。
 */
export function pickRemote(remotes: readonly RemoteEntry[]): RemoteEntry | undefined {
  return remotes.find((remote) => remote.name === 'origin') ?? remotes[0]
}

/**
 * 解析一个远端 URL。支持 SSH 简写、`ssh://`、`https://`、`http://` 与 `git://`。
 * @param url - 远端地址。
 * @returns 主机与路径，或无法识别时的 undefined。
 */
export function parseRemoteUrl(url: string): RepositoryAddress | undefined {
  const cleaned = url
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')

  const scp = SCP_LIKE.exec(cleaned)
  if (scp !== null) return buildAddress(scp[1], scp[2])

  const scheme = SCHEME.exec(cleaned)
  if (scheme !== null) return buildAddress(scheme[1], scheme[2])

  return undefined
}

/**
 * 从远端列表里选出地址：先按 {@link pickRemote} 选远端，再解析它的 URL。
 * 选中的远端解析失败时返回 undefined，不回退到其他远端——结果才可预测。
 * @param remotes - 已解析的远端列表。
 * @returns 地址，或没有可用远端时的 undefined。
 */
export function pickRemoteAddress(remotes: readonly RemoteEntry[]): RepositoryAddress | undefined {
  const remote = pickRemote(remotes)
  return remote === undefined ? undefined : parseRemoteUrl(remote.url)
}

/**
 * 把主机名规范成用于比较的形式：去空白、转小写、去掉端口。
 * @param host - 原始主机名。
 * @returns 规范形式。
 */
export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, '')
}

/**
 * 把远端路径收窄成 `owner/name`。GitHub 与 Gitea 的仓库地址都恰好两段；
 * 嵌套 group 属于 GitLab，不能用它拼接口路径。
 * @param remote - 远端地址。
 * @returns `owner/name`，或不是合法两段路径时的 undefined。
 */
export function repositorySlug(remote: RepositoryAddress | undefined): string | undefined {
  if (remote === undefined) return undefined
  const segments = remote.path.split('/')
  if (segments.length !== 2) return undefined
  const [owner, name] = segments
  if (owner === undefined || name === undefined) return undefined
  if (!REPOSITORY_SEGMENT.test(owner) || !REPOSITORY_SEGMENT.test(name)) return undefined
  return `${owner}/${name}`
}

function buildAddress(
  host: string | undefined,
  path: string | undefined,
): RepositoryAddress | undefined {
  if (host === undefined || path === undefined) return undefined
  const normalizedHost = normalizeHost(host)
  if (normalizedHost.length === 0 || !HOST.test(normalizedHost)) return undefined

  const segments = path.split('/')
  if (segments.length === 0) return undefined
  for (const segment of segments) {
    if (segment.length === 0) return undefined
  }

  return { host: normalizedHost, path: segments.join('/') }
}
