/**
 * 本地快照库的文件实现：按工作区一个 JSON 文件，原子写入。
 *
 * 缓存目录在 DSH 数据根下（`$DSH_HOME/cache/dsh-mattpocock-workflow`，
 * 未设置时取 `~/.dsh/cache/dsh-mattpocock-workflow`）；解析不出来时退回系统
 * 临时目录。插件不写用户的工作区，只写自己这个目录。
 */
import { createHash } from 'node:crypto'
import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  parseSnapshotStoreEntry,
  serializeSnapshotStoreEntry,
  type SnapshotStoreEntry,
} from '../../core/snapshot-store.ts'
import type { TicketState } from '../../core/ticket.ts'

/** 缓存条目超过多少天没有更新就淘汰。 */
export const SNAPSHOT_STORE_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** 最多保留多少个工作区的缓存。 */
export const SNAPSHOT_STORE_MAX_ENTRIES = 20

/**
 * 缓存目录名；DSH 数据根下的一个子目录，只属于这个插件。
 * 不跟包名走：改名时保持原值，用户已有的快照不会被丢在新目录之外。
 */
const DIRECTORY_NAME = 'dsh-mattpocock-workflow'

/** 本地快照库的读写能力。宿主只依赖这个接口，测试用内存实现。 */
export interface SnapshotStore {
  /** 读取某个工作区的缓存条目；没有、损坏或不可用时是 undefined。 */
  read(workspaceRoot: string): Promise<SnapshotStoreEntry | undefined>
  /** 写入（或覆盖）某个工作区的缓存条目。 */
  write(entry: SnapshotStoreEntry): Promise<void>
  /** 删除某个工作区的缓存条目。 */
  remove(workspaceRoot: string): Promise<void>
  /** 列出全部可用的缓存条目。 */
  list(): Promise<readonly SnapshotStoreEntry[]>
  /** 清空缓存；返回清掉的条目数。 */
  clear(): Promise<number>
  /** 按规则淘汰过期条目；返回清掉的条目数。 */
  prune(now: number): Promise<number>
  /** 按变更补丁局部更新缓存里的一张票；缓存里没有这张票时返回 false。 */
  patchTicket(
    workspaceRoot: string,
    ref: string,
    patch: { readonly labels?: readonly string[]; readonly state?: TicketState },
  ): Promise<boolean>
  /** 从缓存里移除一张票；缓存里没有这张票时返回 false。 */
  removeTicket(workspaceRoot: string, ref: string): Promise<boolean>
  /** 缓存目录的位置，用符号形式给出。 */
  location(): string
}

/** 文件实现的依赖；测试可以注入环境变量与目录。 */
export interface SnapshotStoreDeps {
  /** 环境变量；默认读 `process.env`。 */
  readonly env?: Record<string, string | undefined>
  /** 用户主目录；默认取 `node:os` 的 homedir()。 */
  readonly home?: string | undefined
  /** 系统临时目录；默认取 `node:os` 的 tmpdir()。 */
  readonly tmp?: string | undefined
  /** 直接指定缓存根目录；给定时不看环境变量与主目录。 */
  readonly root?: string | undefined
}

/**
 * 创建基于文件系统的本地快照库。
 * @param deps - 可选的环境变量与目录覆盖。
 * @returns 本地快照库。
 */
export function createNodeSnapshotStore(deps: SnapshotStoreDeps = {}): SnapshotStore {
  const env = deps.env ?? process.env
  const root = resolveRoot(deps, env)
  const display = resolveDisplay(deps, env)
  return { ...entryOperations(root), ...ticketOperations(root), location: () => display }
}

/** 条目级别的读写与淘汰。 */
function entryOperations(
  root: string,
): Pick<SnapshotStore, 'read' | 'write' | 'remove' | 'list' | 'clear' | 'prune'> {
  const list = async (): Promise<readonly SnapshotStoreEntry[]> => {
    let names: string[]
    try {
      names = await readdir(root)
    } catch {
      return []
    }
    const entries: SnapshotStoreEntry[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      try {
        const entry = parseSnapshotStoreEntry(await readFile(join(root, name), 'utf8'))
        if (entry !== undefined) entries.push(entry)
      } catch {
        // 读不出来的条目按没有缓存处理，不让一次坏文件挡住其它条目。
      }
    }
    return entries
  }

  return {
    read: (workspaceRoot) => readEntryAt(root, workspaceRoot),

    async write(entry) {
      await writeEntryAt(root, entry)
    },

    async remove(workspaceRoot) {
      await rm(fileFor(root, workspaceRoot), { force: true })
    },

    list,

    async clear() {
      const entries = await list()
      for (const entry of entries) {
        await rm(fileFor(root, entry.workspaceRoot), { force: true })
      }
      return entries.length
    },

    async prune(now) {
      const entries = await list()
      const kept: SnapshotStoreEntry[] = []
      let removed = 0

      for (const entry of entries) {
        const gone = await isWorkspaceGone(entry.workspaceRoot)
        if (gone === true) {
          await rm(fileFor(root, entry.workspaceRoot), { force: true })
          removed += 1
          continue
        }
        // 路径暂时不可达时不删：挂载点掉线不该把缓存清掉。
        if (gone === false && now - entry.fetchedAt > SNAPSHOT_STORE_TTL_MS) {
          await rm(fileFor(root, entry.workspaceRoot), { force: true })
          removed += 1
          continue
        }
        kept.push(entry)
      }

      if (kept.length > SNAPSHOT_STORE_MAX_ENTRIES) {
        kept.sort((left, right) => left.fetchedAt - right.fetchedAt)
        for (const entry of kept.slice(0, kept.length - SNAPSHOT_STORE_MAX_ENTRIES)) {
          await rm(fileFor(root, entry.workspaceRoot), { force: true })
          removed += 1
        }
      }

      return removed
    },
  }
}

/** 缓存里单张票的局部更新。 */
function ticketOperations(root: string): Pick<SnapshotStore, 'patchTicket' | 'removeTicket'> {
  return {
    async patchTicket(workspaceRoot, ref, patch) {
      const entry = await readEntryAt(root, workspaceRoot)
      if (entry === undefined) return false
      const index = entry.tickets.findIndex((ticket) => ticket.ref === ref)
      if (index < 0) return false
      const current = entry.tickets[index]
      if (current === undefined) return false

      const updated = {
        ...current,
        ...(patch.labels === undefined ? {} : { labels: patch.labels }),
        ...(patch.state === undefined ? {} : { state: patch.state }),
      }
      const tickets = [...entry.tickets]
      tickets[index] = updated
      await writeEntryAt(root, { ...entry, tickets })
      return true
    },

    async removeTicket(workspaceRoot, ref) {
      const entry = await readEntryAt(root, workspaceRoot)
      if (entry === undefined) return false
      const tickets = entry.tickets.filter((ticket) => ticket.ref !== ref)
      if (tickets.length === entry.tickets.length) return false
      await writeEntryAt(root, { ...entry, tickets })
      return true
    },
  }
}

/** 某个工作区对应的缓存文件路径。 */
function fileFor(root: string, workspaceRoot: string): string {
  return join(root, `${keyOf(workspaceRoot)}.json`)
}

/** 读一个条目；读不到或内容不合法时是 undefined。 */
async function readEntryAt(
  root: string,
  workspaceRoot: string,
): Promise<SnapshotStoreEntry | undefined> {
  try {
    const raw = await readFile(fileFor(root, workspaceRoot), 'utf8')
    return parseSnapshotStoreEntry(raw)
  } catch {
    return undefined
  }
}

/**
 * 写一个条目：先写临时文件再改名，替换是原子的。
 * 缓存里有工单标题与创建人，文件权限收紧到只有本人可读。
 */
async function writeEntryAt(root: string, entry: SnapshotStoreEntry): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 })
  const target = fileFor(root, entry.workspaceRoot)
  const temporary = `${target}.${String(process.pid)}.tmp`
  try {
    await writeFile(temporary, serializeSnapshotStoreEntry(entry), { mode: 0o600 })
    await rename(temporary, target)
    // 覆盖写不会重置权限，显式改一次。
    await chmod(target, 0o600)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

/**
 * 判断工作区目录是否已经不在了。
 * @param workspaceRoot - 工作区根目录。
 * @returns 目录确实不存在时为 true；目录不可达时为 false；目录还在时为 undefined。
 */
async function isWorkspaceGone(workspaceRoot: string): Promise<boolean | undefined> {
  try {
    await stat(workspaceRoot)
    return undefined
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return true
    // 权限不足、挂载点掉线、设备未就绪都算「暂时不可达」，不删缓存。
    return false
  }
}

/** 工作区根路径派生的文件名：不含路径信息，也不会有非法字符。 */
function keyOf(workspaceRoot: string): string {
  return createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 16)
}

/** 解析缓存根目录。 */
function resolveRoot(deps: SnapshotStoreDeps, env: Record<string, string | undefined>): string {
  if (deps.root !== undefined && deps.root.length > 0) return deps.root
  const home = resolveHome(deps, env)
  if (home !== undefined) return join(home, 'cache', DIRECTORY_NAME)
  const tmp = resolveTmp(deps)
  return join(tmp, `${DIRECTORY_NAME}-cache`)
}

/** 缓存位置的符号形式：不给用户看机器上的绝对路径。 */
function resolveDisplay(deps: SnapshotStoreDeps, env: Record<string, string | undefined>): string {
  if (deps.root !== undefined && deps.root.length > 0) return deps.root
  const configured = env.DSH_HOME
  if (configured !== undefined && configured.trim().length > 0) {
    return `$DSH_HOME/cache/${DIRECTORY_NAME}`
  }
  const home = resolveHome(deps, env)
  if (home !== undefined) return `~/.dsh/cache/${DIRECTORY_NAME}`
  return '系统临时目录'
}

/** 解析 DSH 数据根：环境变量优先，其次用户主目录。 */
function resolveHome(
  deps: SnapshotStoreDeps,
  env: Record<string, string | undefined>,
): string | undefined {
  const configured = env.DSH_HOME
  if (configured !== undefined && configured.trim().length > 0) return configured.trim()
  if (deps.home !== undefined && deps.home.length > 0) return deps.home
  try {
    const home = homedir()
    return home.length > 0 ? join(home, '.dsh') : undefined
  } catch {
    return undefined
  }
}

/** 解析系统临时目录。 */
function resolveTmp(deps: SnapshotStoreDeps): string {
  if (deps.tmp !== undefined && deps.tmp.length > 0) return deps.tmp
  try {
    return tmpdir()
  } catch {
    return '.'
  }
}
