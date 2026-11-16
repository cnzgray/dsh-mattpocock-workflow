/**
 * 本地快照库的条目模型：缓存文件里存什么、怎么校验。
 *
 * 纯逻辑：core 不做 IO。文件读写在 adapters/fs，条目能不能用在这里判定——
 * 格式版本不符或内容损坏时按「没有缓存」处理，不让一次坏文件卡住面板。
 */
import type { BackendKind } from '../protocol/backend.ts'
import { isRecord } from './json.ts'
import type { HierarchyKind, Ticket, TicketAuthor, TicketState } from './ticket.ts'

/**
 * 本地快照库的格式版本。版本不符的条目一律按没有缓存处理。
 * 2：工单带上网页地址；旧缓存没有地址，作废后重拉一次补齐。
 * 3：条目带当前登录用户，工单带分配人；旧缓存作废后重拉一次补齐人员筛选所需的数据。
 * 4：快照带上父子能力、工单带上父级引用；旧缓存没有父子字段，
 *    留着会画出一棵缺边却看似完整的树，作废后重拉一次补齐。
 */
export const SNAPSHOT_STORE_VERSION = 4

/** 缓存文件里存的后端类型。 */
const BACKENDS: readonly BackendKind[] = ['github', 'gitlab', 'gitea', 'markdown']

/** 本地快照库里的一条记录：某个工作区最近一次成功拉取的工单数据。 */
export interface SnapshotStoreEntry {
  /** 格式版本；当前只认 {@link SNAPSHOT_STORE_VERSION}。 */
  readonly version: number
  /** 工作区根路径；用来确认这份缓存属于哪个工作区。 */
  readonly workspaceRoot: string
  /** 拉取时的后端类型。 */
  readonly backend: BackendKind
  /** 拉取时的仓库显示名。 */
  readonly repository: string
  /**
   * 仓库身份：后端类型 + 实例主机 + 仓库路径。
   * 宿主用它确认这份缓存属于当前仓库；换远端或换后端时身份对不上，缓存作废。
   */
  readonly repositoryKey: string
  /** 拉取时的实例主机；本地 Markdown 为 null。 */
  readonly repositoryHost: string | null
  /** 拉取时的当前登录用户登录名；识别不出时为 null。 */
  readonly viewer: string | null
  /** 拉取时刻（毫秒时间戳），也是下一次增量的窗口起点。 */
  readonly fetchedAt: number
  /** 当时加载到的票数。 */
  readonly loaded: number
  /** 当时的仓库总票数。 */
  readonly total: number
  /** 列表覆盖的上限；缺省表示覆盖全部。 */
  readonly windowLimit?: number
  /** 拉取时的父子关系来源；与工单上的父级引用一起决定列表能不能画树。 */
  readonly hierarchy: HierarchyKind
  /** 当时拿到的工单原始数据，不含判定结果。 */
  readonly tickets: readonly Ticket[]
}

/**
 * 把条目序列化成缓存文件的内容。
 * @param entry - 要保存的条目。
 * @returns JSON 文本。
 */
export function serializeSnapshotStoreEntry(entry: SnapshotStoreEntry): string {
  return JSON.stringify({
    version: entry.version,
    workspaceRoot: entry.workspaceRoot,
    backend: entry.backend,
    repository: entry.repository,
    repositoryKey: entry.repositoryKey,
    repositoryHost: entry.repositoryHost,
    viewer: entry.viewer,
    fetchedAt: entry.fetchedAt,
    loaded: entry.loaded,
    total: entry.total,
    ...(entry.windowLimit === undefined ? {} : { windowLimit: entry.windowLimit }),
    hierarchy: entry.hierarchy,
    tickets: entry.tickets,
  })
}

/**
 * 解析缓存文件的内容。
 * @param raw - 文件里的 JSON 文本。
 * @returns 可用的条目；格式版本不符或内容损坏时返回 undefined。
 */
export function parseSnapshotStoreEntry(raw: string): SnapshotStoreEntry | undefined {
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return undefined
  }
  return readEntry(payload)
}

/**
 * 校验一份已解析的 JSON。
 * @param value - 解析后的内容。
 * @returns 可用的条目；任何一项不合要求都返回 undefined。
 */
function readEntry(value: unknown): SnapshotStoreEntry | undefined {
  if (!isRecord(value)) return undefined
  if (value.version !== SNAPSHOT_STORE_VERSION) return undefined

  const workspaceRoot = readString(value.workspaceRoot)
  const repository = readString(value.repository)
  const repositoryKey = readString(value.repositoryKey)
  const fetchedAt = readNumber(value.fetchedAt)
  const loaded = readNumber(value.loaded)
  const total = readNumber(value.total)
  if (
    workspaceRoot === undefined ||
    repository === undefined ||
    repositoryKey === undefined ||
    fetchedAt === undefined ||
    loaded === undefined ||
    total === undefined
  ) {
    return undefined
  }

  const backend = value.backend
  if (typeof backend !== 'string' || !BACKENDS.includes(backend as BackendKind)) return undefined

  const repositoryHost = value.repositoryHost
  if (repositoryHost !== null && typeof repositoryHost !== 'string') return undefined

  const viewer = value.viewer
  if (viewer !== null && typeof viewer !== 'string') return undefined

  const windowLimit = value.windowLimit
  if (
    windowLimit !== undefined &&
    (typeof windowLimit !== 'number' || !Number.isFinite(windowLimit))
  ) {
    return undefined
  }

  const hierarchy = readHierarchy(value.hierarchy)
  if (hierarchy === undefined) return undefined

  const tickets = readTickets(value.tickets)
  if (tickets === undefined) return undefined

  return {
    version: SNAPSHOT_STORE_VERSION,
    workspaceRoot,
    backend: backend as BackendKind,
    repository,
    repositoryKey,
    repositoryHost: repositoryHost ?? null,
    viewer,
    fetchedAt,
    loaded,
    total,
    ...(windowLimit === undefined ? {} : { windowLimit }),
    hierarchy,
    tickets,
  }
}

/** 校验工单数组；任何一张票不合法就整份作废。 */
function readTickets(value: unknown): readonly Ticket[] | undefined {
  if (!Array.isArray(value)) return undefined
  const tickets: Ticket[] = []
  for (const item of value) {
    const ticket = readTicket(item)
    if (ticket === undefined) return undefined
    tickets.push(ticket)
  }
  return tickets
}

/** 校验一张票。 */
function readTicket(value: unknown): Ticket | undefined {
  if (!isRecord(value)) return undefined

  const ref = readString(value.ref)
  const title = readString(value.title)
  const createdAt = readString(value.createdAt)
  const updatedAt = readString(value.updatedAt)
  const state = readState(value.state)
  const openBlockers = readNumber(value.openBlockers)
  if (
    ref === undefined ||
    title === undefined ||
    createdAt === undefined ||
    updatedAt === undefined ||
    state === undefined ||
    openBlockers === undefined
  ) {
    return undefined
  }

  const number = value.number
  if (number !== null && (typeof number !== 'number' || !Number.isInteger(number))) return undefined

  const labels = readStringArray(value.labels)
  if (labels === undefined) return undefined

  const assignees = readStringArray(value.assignees)
  if (assignees === undefined) return undefined

  const author = readAuthor(value.author)
  if (author === undefined) return undefined

  const closedAt = value.closedAt
  if (closedAt !== undefined && typeof closedAt !== 'string') return undefined

  const url = value.url
  if (url !== undefined && typeof url !== 'string') return undefined

  let blockedBy: readonly string[] | undefined
  if (value.blockedBy !== undefined) {
    blockedBy = readStringArray(value.blockedBy)
    if (blockedBy === undefined) return undefined
  }

  const parent = value.parent
  if (parent !== undefined && (typeof parent !== 'string' || parent.length === 0)) {
    return undefined
  }

  return {
    ref,
    number: number ?? null,
    title,
    state,
    labels,
    author,
    assignees,
    createdAt,
    updatedAt,
    openBlockers,
    ...(closedAt === undefined ? {} : { closedAt }),
    ...(url === undefined ? {} : { url }),
    ...(blockedBy === undefined ? {} : { blockedBy }),
    ...(typeof parent === 'string' ? { parent } : {}),
  }
}

/** 校验父子能力枚举；缺字段或取值不认识时整份作废。 */
function readHierarchy(value: unknown): HierarchyKind | undefined {
  if (value === 'native' || value === 'convention' || value === 'none') return value
  return undefined
}

/** 校验创建人；本地 Markdown 没有创建人，整体为 null。 */
function readAuthor(value: unknown): TicketAuthor | null | undefined {
  if (value === null || value === undefined) return null
  if (!isRecord(value)) return undefined
  const login = readString(value.login)
  if (login === undefined) return undefined
  const displayName = value.displayName
  if (displayName !== null && typeof displayName !== 'string') return undefined
  const avatarUrl = value.avatarUrl
  if (avatarUrl !== null && typeof avatarUrl !== 'string') return undefined
  return {
    login,
    displayName: displayName ?? null,
    avatarUrl: avatarUrl ?? null,
  }
}

/** 校验工单状态。 */
function readState(value: unknown): TicketState | undefined {
  if (value === 'open' || value === 'closed') return value
  return undefined
}

/** 读一个非空字符串。 */
function readString(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  return value
}

/** 读一个有限数字。 */
function readNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value
}

/** 读一个字符串数组。 */
function readStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') return undefined
    items.push(item)
  }
  return items
}
