/**
 * 从 `git remote -v` 的输出里解析 GitHub 仓库标识。
 * 只认 github.com；GitHub Enterprise 的域名不在此列。
 */

/** 一个 git 远端。 */
export interface RemoteEntry {
  readonly name: string
  readonly url: string
}

/** GitHub 仓库的 owner 与 name。 */
export interface GithubRepository {
  readonly owner: string
  readonly name: string
}

const REMOTE_LINE = /^(\S+)\s+(\S+)\s+\((?:fetch|push)\)$/
const SEGMENT = /^[A-Za-z0-9_.-]+$/

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
 * 解析一个 GitHub 远端 URL。支持 SSH 简写、`ssh://`、`https://` 与 `git://`。
 * @param url - 远端地址。
 * @returns owner/name，或无法识别时的 undefined。
 */
export function parseGithubRepository(url: string): GithubRepository | undefined {
  const cleaned = url
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
  const path = githubPath(cleaned)
  if (path === undefined) return undefined

  const segments = path.split('/')
  if (segments.length !== 2) return undefined
  const owner = segments[0]
  const name = segments[1]
  if (owner === undefined || name === undefined) return undefined
  if (!SEGMENT.test(owner) || !SEGMENT.test(name)) return undefined

  return { owner, name }
}

/**
 * 选一个 GitHub 仓库：优先 `origin`，否则按远端出现顺序取第一个能解析的。
 * @param remotes - 已解析的远端列表。
 * @returns 仓库标识，或没有 GitHub 远端时的 undefined。
 */
export function pickGithubRepository(
  remotes: readonly RemoteEntry[],
): GithubRepository | undefined {
  const origin = remotes.find((remote) => remote.name === 'origin')
  if (origin !== undefined) {
    const repository = parseGithubRepository(origin.url)
    if (repository !== undefined) return repository
  }

  for (const remote of remotes) {
    const repository = parseGithubRepository(remote.url)
    if (repository !== undefined) return repository
  }

  return undefined
}

/**
 * 把仓库标识格式化为 `owner/name`。
 * @param repository - owner 与 name。
 * @returns 快照里展示的仓库名。
 */
export function repositoryLabel(repository: GithubRepository): string {
  return `${repository.owner}/${repository.name}`
}

function githubPath(url: string): string | undefined {
  const prefixes = [
    'git@github.com:',
    'ssh://git@github.com/',
    'https://github.com/',
    'http://github.com/',
    'git://github.com/',
  ]

  for (const prefix of prefixes) {
    if (url.startsWith(prefix)) return url.slice(prefix.length)
  }

  return undefined
}
