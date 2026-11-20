/**
 * 视图偏好：按工作区记住筛选、排序键与方向。
 *
 * 纯模块：存储对象由调用方注入，不直接触碰全局对象；任何存储或数据异常都静默
 * 回退默认值，不影响面板其余功能。
 */
import type { SortDirection, TicketFilter, TicketSortKey } from './ticket-view.ts'

/** 列表布局：平铺或父子。 */
export type TicketLayout = 'flat' | 'tree'

/** 列表行可配置显示的字段；键名与偏好字段一致。 */
export type RowField = 'showAuthor' | 'showCreatedAt' | 'showUpdatedAt' | 'showAssignees'

/** 行内显示的当前开关：配置入口与行渲染共用同一份形状。 */
export type RowFields = Readonly<Record<RowField, boolean>>

/** 面板的一份视图偏好。 */
export interface ViewPreference {
  readonly filter: TicketFilter
  readonly sortKey: TicketSortKey
  readonly direction: SortDirection
  /** 只看分配给我的工单；默认关闭。 */
  readonly assignedToMe: boolean
  /** 只看我创建的工单；默认关闭。 */
  readonly createdByMe: boolean
  /** 列表布局；旧存档没有这个字段时回退平铺。 */
  readonly layout: TicketLayout
  /** 行内是否显示创建人；默认显示，与加入开关前的显示一致。 */
  readonly showAuthor: boolean
  /** 行内是否显示相对创建时间；默认显示，与加入开关前的显示一致。 */
  readonly showCreatedAt: boolean
  /** 行内是否显示更新时间；默认关闭，与加入开关前的显示一致。 */
  readonly showUpdatedAt: boolean
  /** 行内是否显示分配人；默认关闭，与加入开关前的显示一致。 */
  readonly showAssignees: boolean
}

/** 没有存档时使用的视图：只看未关闭工单，可接的排在前面，平铺显示且不按人员筛选。 */
export const DEFAULT_VIEW: ViewPreference = {
  filter: 'open',
  sortKey: 'status',
  direction: 'asc',
  assignedToMe: false,
  createdByMe: false,
  layout: 'flat',
  showAuthor: true,
  showCreatedAt: true,
  showUpdatedAt: false,
  showAssignees: false,
}

/** Web Storage 里用到的部分；测试可以注入内存实现。 */
export interface PreferenceStorage {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

// 浏览器本地存储的键前缀，用户已保存的视图偏好按它归属；改包名时保持原值。
const KEY_PREFIX = 'dsh-mattpocock-workflow:view:'
const STORAGE_VERSION = 1
const MAX_ENTRIES = 50

// 用穷尽的 Record 而不是数组：联合类型新增成员时这里必须同步，否则类型检查失败。
const FILTERS: Record<TicketFilter, true> = {
  all: true,
  open: true,
  closed: true,
  blocked: true,
  ready: true,
}

const SORT_KEYS: Record<TicketSortKey, true> = {
  updated: true,
  created: true,
  number: true,
  title: true,
  status: true,
}

const DIRECTIONS: Record<SortDirection, true> = { asc: true, desc: true }

const LAYOUTS: Record<TicketLayout, true> = { flat: true, tree: true }

/**
 * 读取某个工作区的视图偏好。
 * @param storage - 浏览器存储；不可用时传 undefined。
 * @param workspaceRoot - 工作区根路径；没有工作区时不读。
 * @returns 存档合法时返回存档，否则返回默认视图或逐字段回退后的结果。
 */
export function readViewPreference(
  storage: PreferenceStorage | undefined,
  workspaceRoot: string | undefined,
): ViewPreference {
  if (storage === undefined || workspaceRoot === undefined) return DEFAULT_VIEW

  let raw: string | null
  try {
    raw = storage.getItem(keyFor(workspaceRoot))
  } catch {
    return DEFAULT_VIEW
  }
  if (raw === null) return DEFAULT_VIEW

  const stored = parseStored(raw)
  if (stored === null) return DEFAULT_VIEW

  return {
    filter: isFilter(stored.filter) ? stored.filter : DEFAULT_VIEW.filter,
    sortKey: isSortKey(stored.sortKey) ? stored.sortKey : DEFAULT_VIEW.sortKey,
    direction: isDirection(stored.direction) ? stored.direction : DEFAULT_VIEW.direction,
    assignedToMe: isBoolean(stored.assignedToMe) ? stored.assignedToMe : DEFAULT_VIEW.assignedToMe,
    createdByMe: isBoolean(stored.createdByMe) ? stored.createdByMe : DEFAULT_VIEW.createdByMe,
    layout: isLayout(stored.layout) ? stored.layout : DEFAULT_VIEW.layout,
    showAuthor: isBoolean(stored.showAuthor) ? stored.showAuthor : DEFAULT_VIEW.showAuthor,
    showCreatedAt: isBoolean(stored.showCreatedAt)
      ? stored.showCreatedAt
      : DEFAULT_VIEW.showCreatedAt,
    showUpdatedAt: isBoolean(stored.showUpdatedAt)
      ? stored.showUpdatedAt
      : DEFAULT_VIEW.showUpdatedAt,
    showAssignees: isBoolean(stored.showAssignees)
      ? stored.showAssignees
      : DEFAULT_VIEW.showAssignees,
  }
}

/**
 * 写入某个工作区的视图偏好，并按保存时间淘汰超量的孤儿条目。
 * @param storage - 浏览器存储；不可用时传 undefined。
 * @param workspaceRoot - 工作区根路径；没有工作区时不写。
 * @param preference - 要保存的偏好。
 * @param now - 保存时间来源，测试可注入固定时钟。
 */
export function writeViewPreference(
  storage: PreferenceStorage | undefined,
  workspaceRoot: string | undefined,
  preference: ViewPreference,
  now: () => number = Date.now,
): void {
  if (storage === undefined || workspaceRoot === undefined) return

  try {
    storage.setItem(
      keyFor(workspaceRoot),
      JSON.stringify({
        filter: preference.filter,
        sortKey: preference.sortKey,
        direction: preference.direction,
        assignedToMe: preference.assignedToMe,
        createdByMe: preference.createdByMe,
        layout: preference.layout,
        showAuthor: preference.showAuthor,
        showCreatedAt: preference.showCreatedAt,
        showUpdatedAt: preference.showUpdatedAt,
        showAssignees: preference.showAssignees,
        savedAt: now(),
        version: STORAGE_VERSION,
      }),
    )
    evictOldest(storage)
  } catch {
    // 隐私模式、存储被禁用或配额满：不记忆偏好，面板照常。
  }
}

function keyFor(workspaceRoot: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(workspaceRoot)}`
}

function parseStored(raw: string): Record<string, unknown> | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  if (!('version' in value) || value.version !== STORAGE_VERSION) return null
  return value
}

/** 只按保存时间淘汰最旧的条目；存档损坏的条目视为最旧。 */
function evictOldest(storage: PreferenceStorage): void {
  const entries: { readonly key: string; readonly savedAt: number }[] = []
  const length = storage.length

  for (let index = 0; index < length; index += 1) {
    const key = storage.key(index)
    if (!key?.startsWith(KEY_PREFIX)) continue
    entries.push({ key, savedAt: savedAtOf(storage, key) })
  }
  if (entries.length <= MAX_ENTRIES) return

  entries.sort((left, right) => left.savedAt - right.savedAt)
  for (const entry of entries.slice(0, entries.length - MAX_ENTRIES)) {
    storage.removeItem(entry.key)
  }
}

function savedAtOf(storage: PreferenceStorage, key: string): number {
  const raw = storage.getItem(key)
  if (raw === null) return 0
  const stored = parseStored(raw)
  const savedAt = stored?.savedAt
  return typeof savedAt === 'number' && Number.isFinite(savedAt) ? savedAt : 0
}

function isFilter(value: unknown): value is TicketFilter {
  return typeof value === 'string' && Object.hasOwn(FILTERS, value)
}

function isSortKey(value: unknown): value is TicketSortKey {
  return typeof value === 'string' && Object.hasOwn(SORT_KEYS, value)
}

function isDirection(value: unknown): value is SortDirection {
  return typeof value === 'string' && Object.hasOwn(DIRECTIONS, value)
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

function isLayout(value: unknown): value is TicketLayout {
  return typeof value === 'string' && Object.hasOwn(LAYOUTS, value)
}
