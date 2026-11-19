/**
 * 本地快照库的文件实现：按工作区一个目录落库，提交顺序固定为
 * 「票文件 → 变化日志 → 墓碑清单 → meta」，meta 是提交点。
 *
 * 目录布局（适配器内部私事，宿主只依赖 SnapshotStore 接口）：
 * - `meta.json`：条目全部字段 + 票文件清单（引用 → 文件名 + 内容散列），是提交点；
 * - `tickets/`：每票一个文件，只重写内容变过的票；
 * - `tombstones.json`：最近一次提交删掉的票引用（墓碑，一致性判定用）；
 * - `log.json`：append-only 变化日志，超出保留上限后最旧的条目轮转掉。
 *
 * 崩溃只允许停在 meta 之前：孤儿票文件与多写的日志都不会被任何可见版本引用，
 * 孤儿文件在下一次写入时清理。读路径固定为「先 meta 定版本、再按清单读票」，
 * 个别票文件缺失或损坏时本次读降级为没有缓存，下一次全量写自愈。
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
  parseSnapshotTicket,
  readSnapshotStoreEntry,
  serializeSnapshotStoreEntry,
  type SnapshotStoreEntry,
} from '../../core/snapshot-store.ts'
import { isRecord } from '../../core/json.ts'
import type { Ticket, TicketState } from '../../core/ticket.ts'

/** 缓存条目超过多少天没有更新就淘汰。 */
export const SNAPSHOT_STORE_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** 最多保留多少个工作区的缓存。 */
export const SNAPSHOT_STORE_MAX_ENTRIES = 20

/** 变化日志保留多少条；更早的起点读不到净变化，刷新回退整份重传。 */
export const SNAPSHOT_CHANGELOG_LIMIT = 200

/**
 * 缓存目录名；DSH 数据根下的一个子目录，只属于这个插件。
 * 不跟包名走：改名时保持原值，用户已有的快照不会被丢在新目录之外。
 */
const DIRECTORY_NAME = 'dsh-mattpocock-workflow'

/** meta 文件里的一张票文件清单条目。 */
interface ManifestEntry {
  /** 工单引用，即 {@link Ticket.ref}。 */
  readonly ref: string
  /** 票文件名，相对 tickets/ 目录。 */
  readonly file: string
  /** 票文件内容散列；内容没变就不重写这个文件。 */
  readonly sha: string
}

/** 变化日志条目：一次提交里变过的票。 */
interface ChangeLogEntry {
  /** 这次提交后的库版本。 */
  readonly version: number
  /** 新增或内容变过的票引用。 */
  readonly upserted: readonly string[]
  /** 删除的票引用（墓碑）。 */
  readonly removed: readonly string[]
}

/** 按版本区间读到的净变化集。 */
export interface SnapshotChanges {
  /** 当前库版本。 */
  readonly version: number
  /** 区间内新增或变更过的票（当前状态）。 */
  readonly tickets: readonly Ticket[]
  /** 区间内被删除的票引用。 */
  readonly removed: readonly string[]
}

/** 读到的 meta：条目 + 票文件清单。 */
interface StoredMeta {
  readonly entry: SnapshotStoreEntry
  readonly manifest: readonly ManifestEntry[]
}

/** 本地快照库的读写能力。宿主只依赖这个接口，测试用内存实现。 */
export interface SnapshotStore {
  /** 读取某个工作区的缓存条目；没有、损坏或不可用时是 undefined。 */
  read(workspaceRoot: string): Promise<SnapshotStoreEntry | undefined>
  /**
   * 写入（或覆盖）某个工作区的缓存条目：票文件 → 变化日志 → 墓碑清单 → meta。
   * 返回写入后的库版本；宿主把它交给界面当新鲜度判据。
   */
  write(entry: SnapshotStoreEntry): Promise<number>
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
  /** 从缓存里移除一张票（记墓碑）；缓存里没有这张票时返回 false。 */
  removeTicket(workspaceRoot: string, ref: string): Promise<boolean>
  /** 当前库版本；没有条目时为 null。 */
  version(workspaceRoot: string): Promise<number | null>
  /**
   * 读 `(afterVersion, 当前版本]` 的净变化集（含墓碑）。
   * 起点超出日志覆盖（轮转）或条目不存在时返回 undefined，调用方回退整份重传。
   */
  changesSince(workspaceRoot: string, afterVersion: number): Promise<SnapshotChanges | undefined>
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

  return {
    read: (workspaceRoot) => readWorkspace(dirFor(root, workspaceRoot)),

    write: (entry) => commitEntry(dirFor(root, entry.workspaceRoot), entry),

    remove: (workspaceRoot) =>
      rm(dirFor(root, workspaceRoot), { recursive: true, force: true }).then(() => undefined),

    async list() {
      const entries: SnapshotStoreEntry[] = []
      for (const meta of await listMetas(root)) {
        const entry = await readWorkspace(dirFor(root, meta.entry.workspaceRoot))
        if (entry !== undefined) entries.push(entry)
      }
      return entries
    },

    async clear() {
      const metas = await listMetas(root)
      for (const meta of metas) {
        await rm(dirFor(root, meta.entry.workspaceRoot), { recursive: true, force: true })
      }
      return metas.length + (await sweepLegacyFiles(root))
    },

    prune: (now) => pruneDirs(root, now),

    patchTicket: (workspaceRoot, ref, patch) => patchTicketAt(root, workspaceRoot, ref, patch),

    removeTicket: (workspaceRoot, ref) => removeTicketAt(root, workspaceRoot, ref),

    version: async (workspaceRoot) =>
      (await readMetaAt(dirFor(root, workspaceRoot)))?.entry.libraryVersion ?? null,

    changesSince: (workspaceRoot, afterVersion) =>
      changesSinceAt(root, workspaceRoot, afterVersion),

    location: () => display,
  }
}

/** 列出缓存根下全部可读的 meta（损坏的目录跳过）。 */
async function listMetas(root: string): Promise<readonly StoredMeta[]> {
  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    return []
  }
  const metas: StoredMeta[] = []
  for (const name of names) {
    const meta = await readMetaAt(join(root, name))
    if (meta !== undefined) metas.push(meta)
  }
  return metas
}

/**
 * 清掉旧版布局残留的按工作区 JSON 文件（v5 起是目录）。
 * 这些文件早已按没有缓存处理，留着只会越攒越多；返回清掉的数量。
 */
async function sweepLegacyFiles(root: string): Promise<number> {
  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    return 0
  }
  let removed = 0
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const path = join(root, name)
    if ((await stat(path)).isDirectory()) continue
    await rm(path, { force: true })
    removed += 1
  }
  return removed
}

/** 按规则淘汰：工作区消失、超过 TTL、超出条目上限。 */
async function pruneDirs(root: string, now: number): Promise<number> {
  let removed = await sweepLegacyFiles(root)
  for (const meta of await listMetas(root)) {
    const workspaceRoot = meta.entry.workspaceRoot
    const gone = await isWorkspaceGone(workspaceRoot)
    if (gone === true) {
      await rm(dirFor(root, workspaceRoot), { recursive: true, force: true })
      removed += 1
      continue
    }
    // 路径暂时不可达时不删：挂载点掉线不该把缓存清掉。
    if (gone === false && now - meta.entry.fetchedAt > SNAPSHOT_STORE_TTL_MS) {
      await rm(dirFor(root, workspaceRoot), { recursive: true, force: true })
      removed += 1
    }
  }

  const kept = await listMetas(root)
  if (kept.length > SNAPSHOT_STORE_MAX_ENTRIES) {
    const sorted = [...kept].sort((left, right) => left.entry.fetchedAt - right.entry.fetchedAt)
    for (const meta of sorted.slice(0, kept.length - SNAPSHOT_STORE_MAX_ENTRIES)) {
      await rm(dirFor(root, meta.entry.workspaceRoot), { recursive: true, force: true })
      removed += 1
    }
  }
  return removed
}

/** 按变更补丁局部更新一张票：重写票文件、记日志、推进版本。 */
async function patchTicketAt(
  root: string,
  workspaceRoot: string,
  ref: string,
  patch: { readonly labels?: readonly string[]; readonly state?: TicketState },
): Promise<boolean> {
  const dir = dirFor(root, workspaceRoot)
  const meta = await readMetaAt(dir)
  if (meta === undefined) return false
  const item = meta.manifest.find((entry) => entry.ref === ref)
  if (item === undefined) return false
  const ticket = await readTicketAt(dir, item)
  if (ticket === undefined) return false

  const updated = {
    ...ticket,
    ...(patch.labels === undefined ? {} : { labels: patch.labels }),
    ...(patch.state === undefined ? {} : { state: patch.state }),
  }
  const sha = digest(JSON.stringify(updated))
  await writeAtomic(join(ticketsDirOf(dir), item.file), JSON.stringify(updated))
  await appendLog(dir, meta.entry.libraryVersion + 1, [ref], [])
  await writeMeta(dir, { ...meta.entry, libraryVersion: meta.entry.libraryVersion + 1 }, [
    ...meta.manifest.filter((entry) => entry.ref !== ref),
    { ...item, sha },
  ])
  return true
}

/** 移除一张票：记墓碑与日志、推进版本；票文件留到下一次写入时清扫。 */
async function removeTicketAt(root: string, workspaceRoot: string, ref: string): Promise<boolean> {
  const dir = dirFor(root, workspaceRoot)
  const meta = await readMetaAt(dir)
  if (meta === undefined) return false
  if (!meta.manifest.some((entry) => entry.ref === ref)) return false
  const newVersion = meta.entry.libraryVersion + 1
  await appendLog(dir, newVersion, [], [ref])
  await writeAtomic(tombstonesPathOf(dir), JSON.stringify([ref]))
  await writeMeta(
    dir,
    { ...meta.entry, libraryVersion: newVersion },
    meta.manifest.filter((entry) => entry.ref !== ref),
  )
  return true
}

/** 读 `(afterVersion, 当前版本]` 的净变化集；起点超出日志覆盖时返回 undefined。 */
async function changesSinceAt(
  root: string,
  workspaceRoot: string,
  afterVersion: number,
): Promise<SnapshotChanges | undefined> {
  const dir = dirFor(root, workspaceRoot)
  const meta = await readMetaAt(dir)
  if (meta === undefined) return undefined
  if (!Number.isInteger(afterVersion) || afterVersion < 0) return undefined
  const current = meta.entry.libraryVersion
  if (afterVersion > current) return undefined
  if (afterVersion === current) return { version: current, tickets: [], removed: [] }

  const log = await readLogAt(dir)
  // 日志损坏：覆盖区间不可知，不拿空集冒充没有变化，交给调用方回退整份。
  if (log === null) return undefined
  const oldest = log.length === 0 ? current : (log[0]?.version ?? current)
  // 起点比日志覆盖还旧：净变化算不全，交给调用方回退整份。
  if (afterVersion < oldest - 1) return undefined

  const upserted = new Set<string>()
  const removed = new Set<string>()
  for (const entry of log) {
    if (entry.version <= afterVersion) continue
    for (const ref of entry.upserted) {
      upserted.add(ref)
      removed.delete(ref)
    }
    for (const ref of entry.removed) {
      removed.add(ref)
      upserted.delete(ref)
    }
  }

  const byRef = new Map(meta.manifest.map((item) => [item.ref, item]))
  const tickets: Ticket[] = []
  for (const ref of upserted) {
    const item = byRef.get(ref)
    if (item === undefined) return undefined
    const ticket = await readTicketAt(dir, item)
    if (ticket === undefined) return undefined
    tickets.push(ticket)
  }
  return { version: current, tickets, removed: [...removed] }
}

/** 读一个工作区目录的完整条目；票文件缺失或损坏时降级为没有缓存。 */
async function readWorkspace(dir: string): Promise<SnapshotStoreEntry | undefined> {
  const meta = await readMetaAt(dir)
  if (meta === undefined) return undefined
  const tickets: Ticket[] = []
  for (const item of meta.manifest) {
    const ticket = await readTicketAt(dir, item)
    if (ticket === undefined) return undefined
    tickets.push(ticket)
  }
  return { ...meta.entry, tickets }
}

/**
 * 提交一次写入：票文件 → 变化日志 → 墓碑清单 → 孤儿清理 → meta（提交点）。
 * 只重写内容变过或文件丢了的票；返回新的库版本。
 */
async function commitEntry(dir: string, entry: SnapshotStoreEntry): Promise<number> {
  const old = await readMetaAt(dir)
  const newVersion = (old?.entry.libraryVersion ?? 0) + 1

  const previous = new Map((old?.manifest ?? []).map((item) => [item.ref, item]))
  const nextRefs = new Set<string>()
  const manifest: ManifestEntry[] = []
  const upserted: ManifestEntry[] = []
  for (const ticket of entry.tickets) {
    const file = ticketFileFor(ticket.ref)
    const sha = digest(JSON.stringify(ticket))
    const prior = previous.get(ticket.ref)
    // 内容没变且文件还在才不重写；文件缺失（崩溃残留被外部清掉）时补写。
    const unchanged =
      prior?.sha === sha && prior.file === file && (await ticketFileExists(dir, prior.file))
    if (!unchanged) {
      upserted.push({ ref: ticket.ref, file, sha })
    }
    nextRefs.add(ticket.ref)
    manifest.push({ ref: ticket.ref, file, sha })
  }
  const removed = (old?.manifest ?? [])
    .filter((item) => !nextRefs.has(item.ref))
    .map((item) => item.ref)

  await mkdir(ticketsDirOf(dir), { recursive: true, mode: 0o700 })
  for (const item of upserted) {
    const ticket = entry.tickets.find((candidate) => candidate.ref === item.ref)
    if (ticket === undefined) continue
    await writeAtomic(join(ticketsDirOf(dir), item.file), JSON.stringify(ticket))
  }

  if (upserted.length > 0 || removed.length > 0) {
    const log = (await readLogAt(dir)) ?? []
    log.push({ version: newVersion, upserted: upserted.map((item) => item.ref), removed })
    while (log.length > SNAPSHOT_CHANGELOG_LIMIT) log.shift()
    await writeAtomic(logPathOf(dir), JSON.stringify(log))
  }
  await writeAtomic(tombstonesPathOf(dir), JSON.stringify(removed))

  const live = new Set(manifest.map((item) => item.file))
  // 本轮删掉的票走墓碑不物理删除：读到旧 meta 的并发方仍能拿到完整一致的一版。
  // 它们的文件与崩溃残留一起，在下一次写入时清扫。
  for (const ref of removed) live.add(ticketFileFor(ref))
  await sweepOrphans(dir, live)

  const stored: SnapshotStoreEntry = { ...entry, libraryVersion: newVersion }
  await writeMeta(dir, stored, manifest)
  return newVersion
}

/** 读 meta.json；没有或损坏时是 undefined。 */
async function readMetaAt(dir: string): Promise<StoredMeta | undefined> {
  let raw: string
  try {
    raw = await readFile(metaPathOf(dir), 'utf8')
  } catch {
    return undefined
  }
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!isRecord(payload)) return undefined
  const entry = readSnapshotStoreEntry(payload)
  if (entry === undefined) return undefined
  const manifest = readManifest(payload.manifest)
  if (manifest === undefined) return undefined
  return { entry, manifest }
}

/** 校验票文件清单。 */
function readManifest(value: unknown): readonly ManifestEntry[] | undefined {
  if (!Array.isArray(value)) return undefined
  const manifest: ManifestEntry[] = []
  for (const item of value) {
    if (!isRecord(item)) return undefined
    if (typeof item.ref !== 'string' || item.ref.length === 0) return undefined
    if (typeof item.file !== 'string' || item.file.length === 0) return undefined
    if (typeof item.sha !== 'string' || item.sha.length === 0) return undefined
    manifest.push({ ref: item.ref, file: item.file, sha: item.sha })
  }
  return manifest
}

/** 读一个票文件；缺失或损坏时是 undefined。 */
async function readTicketAt(dir: string, item: ManifestEntry): Promise<Ticket | undefined> {
  try {
    return parseSnapshotTicket(await readFile(join(ticketsDirOf(dir), item.file), 'utf8'))
  } catch {
    return undefined
  }
}

/** 票文件是否还在磁盘上。 */
async function ticketFileExists(dir: string, file: string): Promise<boolean> {
  try {
    await stat(join(ticketsDirOf(dir), file))
    return true
  } catch {
    return false
  }
}

/**
 * 读变化日志；没有时按空日志处理（这个版本还没有变化记录）。
 * 文件损坏（存在但解析不了或结构不对）时返回 null：调用方按「覆盖不可知」降级，
 * 增量请求回退整份，不拿空集冒充没有变化。
 */
async function readLogAt(dir: string): Promise<ChangeLogEntry[] | null> {
  let raw: string
  try {
    raw = await readFile(logPathOf(dir), 'utf8')
  } catch {
    return []
  }
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(payload)) return null
  const log: ChangeLogEntry[] = []
  for (const item of payload) {
    if (!isRecord(item)) return null
    if (typeof item.version !== 'number' || !Number.isInteger(item.version)) return null
    if (!Array.isArray(item.upserted) || !item.upserted.every((ref) => typeof ref === 'string')) {
      return null
    }
    if (!Array.isArray(item.removed) || !item.removed.every((ref) => typeof ref === 'string')) {
      return null
    }
    log.push({ version: item.version, upserted: item.upserted, removed: item.removed })
  }
  return log
}

/** 追加一条变化日志（保留上限内最旧的条目轮转掉）；损坏的日志从头重建。 */
async function appendLog(
  dir: string,
  version: number,
  upserted: readonly string[],
  removed: readonly string[],
): Promise<void> {
  const log = (await readLogAt(dir)) ?? []
  log.push({ version, upserted, removed })
  while (log.length > SNAPSHOT_CHANGELOG_LIMIT) log.shift()
  await writeAtomic(logPathOf(dir), JSON.stringify(log))
}

/** 写 meta（提交点）：条目 + 最新票文件清单。 */
async function writeMeta(
  dir: string,
  entry: SnapshotStoreEntry,
  manifest: readonly ManifestEntry[],
): Promise<void> {
  const fields = JSON.parse(serializeSnapshotStoreEntry(entry)) as Record<string, unknown>
  const payload = { ...fields, manifest }
  await writeAtomic(metaPathOf(dir), JSON.stringify(payload))
}

/** 清理 tickets/ 下不被当前清单引用的文件：上一次提交的墓碑票与崩溃残留。 */
async function sweepOrphans(dir: string, live: ReadonlySet<string>): Promise<void> {
  let names: string[]
  try {
    names = await readdir(ticketsDirOf(dir))
  } catch {
    return
  }
  for (const name of names) {
    if (!live.has(name)) await rm(join(ticketsDirOf(dir), name), { force: true })
  }
}

/**
 * 写一个文件：先写临时文件再改名，替换是原子的。
 * 缓存里有工单标题与创建人，文件权限收紧到只有本人可读。
 */
async function writeAtomic(target: string, content: string): Promise<void> {
  await mkdir(join(target, '..'), { recursive: true, mode: 0o700 }).catch(() => undefined)
  const temporary = `${target}.${String(process.pid)}.tmp`
  try {
    await writeFile(temporary, content, { mode: 0o600 })
    await rename(temporary, target)
    await chmod(target, 0o600)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

/** 内容的稳定散列。 */
function digest(content: string): string {
  return createHash('sha1').update(content).digest('hex')
}

/** 某个工作区对应的缓存目录。 */
function dirFor(root: string, workspaceRoot: string): string {
  return join(root, keyOf(workspaceRoot))
}

/** 工作区根路径派生的目录名：不含路径信息，也不会有非法字符。 */
function keyOf(workspaceRoot: string): string {
  return createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 16)
}

/** 票文件名：引用派生，稳定不变。 */
function ticketFileFor(ref: string): string {
  return `${createHash('sha256').update(ref).digest('hex').slice(0, 16)}.json`
}

function metaPathOf(dir: string): string {
  return join(dir, 'meta.json')
}

function ticketsDirOf(dir: string): string {
  return join(dir, 'tickets')
}

function tombstonesPathOf(dir: string): string {
  return join(dir, 'tombstones.json')
}

function logPathOf(dir: string): string {
  return join(dir, 'log.json')
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
