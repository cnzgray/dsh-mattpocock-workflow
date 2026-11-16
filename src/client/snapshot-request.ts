/**
 * 面板共用的快照请求：首屏只等列表，阻塞信息由后台补齐。
 * 列表与概览都读同一份状态，这里只实现一次。
 *
 * 数据来自本地快照库时先把缓存显示出来，再自动发起一次增量刷新；
 * 刷新失败保留已有数据，只把失败原因记在状态里，不把整屏切成错误页。
 *
 * 面板是常驻的：agent 在建票、triage 之后不会通知面板，所以由面板外层给一个活动信号，
 * 信号一到就后台增量刷新一次。后台刷新不切换成「刷新中」，数据没变也不改写快照——
 * 用户看着的筛选、排序、数据时间和提示词草稿都不动。
 */
import * as React from 'react'

import type { RpcErrorBody, WorkspaceSnapshot } from '../protocol/tracker.ts'
import { useI18n } from './i18n.tsx'
import type { Translate } from './i18n-runtime.ts'
import type { PanelClient } from './rpc.ts'

/** 请求阶段。 */
export type SnapshotPhase = 'loading' | 'ready' | 'refreshing' | 'error'

export interface SnapshotRequestState {
  readonly snapshot: WorkspaceSnapshot | null
  /** 整体错误：连一份数据都没有时才出现。 */
  readonly error: RpcErrorBody | null
  /** 最近一次刷新失败的原因；有数据时用它提示，列表本身照常显示。 */
  readonly refreshError: RpcErrorBody | null
  readonly phase: SnapshotPhase
  /** 增量刷新：能只拉变化就只拉变化。 */
  readonly refresh: () => void
  /** 全量刷新：忽略本地快照库重拉一次。 */
  readonly refreshFull: () => void
  /** 向后扩一页列表窗口；界面只在还有更多时调用。 */
  readonly loadMore: () => void
  /** 最近一次扩窗失败的原因；列表保持原样，可重试。 */
  readonly moreError: RpcErrorBody | null
  /** 扩窗请求进行中。 */
  readonly moreLoading: boolean
}

/** 请求选项。 */
export interface SnapshotRequestOptions {
  /**
   * agent 侧的活动信号：值一变就后台刷新一次。
   * 面板在详情态也照样刷新，回到列表时看到的就是这一轮之后的数据。
   */
  readonly signal?: number | undefined
}

/** 请求方式：读缓存、增量刷新、全量刷新、后台自动刷新。 */
type RequestMode = 'get' | 'refresh' | 'refresh-full' | 'auto'

/**
 * 快照旁边要显示的失败原因。
 * 客户端刚失败的原因优先，其次是宿主记在快照里的原因；两者都没有但数据陈旧时，
 * 说明数据不是最新的。
 * @param snapshot - 当前快照；没有数据时为 null。
 * @param refreshError - 客户端最近一次刷新失败的原因。
 * @param t - 翻译入口；省略时用内置中文。
 * @returns 要显示的原因文案；没有原因时为 null。
 */
export function snapshotRefreshNotice(
  snapshot: WorkspaceSnapshot | null,
  refreshError: RpcErrorBody | null,
  t: Translate,
): string | null {
  if (refreshError !== null) return refreshError.message
  const hostMessage = snapshot?.refreshError?.message
  if (hostMessage !== undefined) return hostMessage
  if (snapshot?.stale === true) return t('snapshot.stale')
  return null
}

/**
 * 新快照是否会改变界面看得到的东西。
 *
 * 只比数据本身：新建、改标签、改状态、关闭都会让它变；数据时间不算，
 * 一次没拉到新东西的刷新不该让列表和数据时间闪一下。
 * `blockersFinalized` 也不算：列表阶段的临时判定随后会被补齐结果覆盖，
 * 拿它比会让 GitLab / Gitea 每次都「有变化」，静默刷新就退化成每次都重绘。
 * @param previous - 当前显示的快照；没有数据时为 null。
 * @param next - 刚拉回来的快照。
 * @returns 会变时为 true。
 */
export function snapshotVisibleChange(
  previous: WorkspaceSnapshot | null,
  next: WorkspaceSnapshot,
): boolean {
  if (previous === null) return true
  return visibleKey(previous) !== visibleKey(next)
}

function visibleKey(snapshot: WorkspaceSnapshot): string {
  return JSON.stringify({
    backend: snapshot.backend,
    repository: snapshot.repository,
    repositoryHost: snapshot.repositoryHost,
    // 切换 CLI 账号后只有身份变化：后台刷新也要落地，人员筛选才能按新身份匹配。
    viewer: snapshot.viewer,
    loaded: snapshot.loaded,
    total: snapshot.total,
    hierarchy: snapshot.hierarchy,
    source: snapshot.source,
    stale: snapshot.stale,
    refreshError: snapshot.refreshError,
    metrics: snapshot.metrics,
    tickets: snapshot.tickets,
  })
}

/** 一次请求的结果：已应用的数据，或失败时的 null。 */
interface Loader {
  readonly snapshot: WorkspaceSnapshot | null
  readonly error: RpcErrorBody | null
  readonly refreshError: RpcErrorBody | null
  readonly phase: SnapshotPhase
  readonly moreError: RpcErrorBody | null
  readonly moreLoading: boolean
  readonly load: (mode: RequestMode) => Promise<WorkspaceSnapshot | null>
  readonly more: () => void
}

/**
 * 读取一个工作区的快照，并在首屏之后补齐阻塞信息。
 * @param client - 面板客户端。
 * @param workspaceRoot - 当前工作区；没有工作区时直接进入错误态。
 * @param options - 活动信号。
 * @returns 快照、错误、阶段与两个刷新入口。
 */
export function useSnapshotRequest(
  client: PanelClient,
  workspaceRoot: string | undefined,
  options?: SnapshotRequestOptions,
): SnapshotRequestState {
  const { t } = useI18n()
  const { snapshot, error, refreshError, phase, moreError, moreLoading, load, more } =
    useSnapshotLoader(client, workspaceRoot, t)
  const signal = options?.signal ?? 0
  // 一轮缓存只自动刷新一次：刷新失败时不再反复打宿主。
  const autoRefreshed = React.useRef(false)
  // 后台刷新不叠在别的请求上：正在跑就记下来，等空下来再补一次。用户点的手动刷新照常发。
  const inFlight = React.useRef(0)
  const queued = React.useRef(false)
  const handledSignal = React.useRef(signal)
  // 补发用状态而不是直接调用 run：换工作区后旧请求的收尾不能拿旧工作区再拉一次。
  const [retry, setRetry] = React.useState(0)
  const handledRetry = React.useRef(0)

  const run = React.useCallback(
    async (mode: RequestMode): Promise<void> => {
      if (mode === 'auto' && inFlight.current > 0) {
        queued.current = true
        return
      }
      inFlight.current += 1
      try {
        const applied = await load(mode)
        if (applied !== null && applied.source === 'live') autoRefreshed.current = false
        // 来自本地快照库：数据已经显示出来，再自动刷新一次让它收敛到最新。
        if (mode !== 'auto' && applied !== null && applied.source === 'cache') {
          if (autoRefreshed.current) return
          autoRefreshed.current = true
          const refreshed = await load('refresh')
          if (refreshed !== null && refreshed.source === 'live') autoRefreshed.current = false
        }
      } finally {
        inFlight.current -= 1
        if (inFlight.current === 0 && queued.current) {
          queued.current = false
          setRetry((value) => value + 1)
        }
      }
    },
    [load],
  )

  // 补发一次被压下的后台刷新；走当前这份 run，工作区换了也是新工作区。
  React.useEffect(() => {
    if (retry === handledRetry.current) return
    handledRetry.current = retry
    void run('auto')
  }, [retry, run])

  React.useEffect(() => {
    autoRefreshed.current = false
    void run('get')
  }, [run])

  // agent 那边刚静下来：后台刷新一次，不打断正在看的视图。
  React.useEffect(() => {
    if (signal === handledSignal.current) return
    handledSignal.current = signal
    if (workspaceRoot === undefined) return
    void run('auto')
  }, [signal, workspaceRoot, run])

  // 换工作区时丢掉压下的补发：新工作区有自己的首屏加载，旧仓库的刷新没有意义。
  React.useEffect(() => {
    queued.current = false
  }, [workspaceRoot])

  const refresh = React.useCallback(() => {
    if (phase === 'loading' || phase === 'refreshing') return
    void run('refresh')
  }, [phase, run])

  const refreshFull = React.useCallback(() => {
    if (phase === 'loading' || phase === 'refreshing') return
    void run('refresh-full')
  }, [phase, run])

  return {
    snapshot,
    error,
    refreshError,
    phase,
    refresh,
    refreshFull,
    loadMore: more,
    moreError,
    moreLoading,
  }
}

/** 落地一次拉取要用到的状态：几个 ref 与 setState 总是一起出现。 */
interface LoadTarget {
  readonly client: PanelClient
  readonly workspaceRoot: string | undefined
  readonly sequence: React.RefObject<number>
  readonly latest: React.RefObject<WorkspaceSnapshot | null>
  readonly hasData: React.RefObject<boolean>
  readonly setSnapshot: (next: WorkspaceSnapshot | null) => void
  readonly setError: (next: RpcErrorBody | null) => void
  readonly setRefreshError: (next: RpcErrorBody | null) => void
  readonly setPhase: (next: SnapshotPhase) => void
  readonly setMoreError: (next: RpcErrorBody | null) => void
  readonly setMoreLoading: (next: boolean) => void
  readonly t: Translate
}

/**
 * 快照的读取与落地：一次请求、一次落地，失败时按有没有旧数据决定去留。
 * @param client - 面板客户端。
 * @param workspaceRoot - 当前工作区。
 * @returns 当前状态与发起请求的入口。
 */
function useSnapshotLoader(
  client: PanelClient,
  workspaceRoot: string | undefined,
  t: Translate,
): Loader {
  const [snapshot, setSnapshot] = React.useState<WorkspaceSnapshot | null>(null)
  const [error, setError] = React.useState<RpcErrorBody | null>(null)
  const [refreshError, setRefreshError] = React.useState<RpcErrorBody | null>(null)
  const [phase, setPhase] = React.useState<SnapshotPhase>('loading')
  const [moreError, setMoreError] = React.useState<RpcErrorBody | null>(null)
  const [moreLoading, setMoreLoading] = React.useState(false)
  const sequence = React.useRef(0)
  // 已经拿到过数据：刷新失败时要靠它决定是保留列表还是切错误页。
  const hasData = React.useRef(false)
  // 当前显示的那份数据：后台刷新要靠它判断有没有新东西可显示。
  const latest = React.useRef<WorkspaceSnapshot | null>(null)
  // 扩窗不叠发：同一时刻只允许一个「加载更多」在路上。
  const moreRunning = React.useRef(false)

  const target = React.useMemo<LoadTarget>(
    () => ({
      client,
      workspaceRoot,
      sequence,
      latest,
      hasData,
      setSnapshot,
      setError,
      setRefreshError,
      setPhase,
      setMoreError,
      setMoreLoading,
      t,
    }),
    [client, workspaceRoot, t],
  )
  const load = React.useCallback(
    (mode: RequestMode): Promise<WorkspaceSnapshot | null> => loadSnapshot(target, mode),
    [target],
  )
  const more = React.useCallback((): void => {
    void loadMoreSnapshot(target, moreRunning)
  }, [target])

  // 换工作区时清掉上一份数据，不让旧仓库的票留在新仓库的列表里。
  React.useEffect(() => {
    setSnapshot(null)
    setError(null)
    setRefreshError(null)
    setMoreError(null)
    setMoreLoading(false)
    hasData.current = false
    latest.current = null
    moreRunning.current = false
  }, [workspaceRoot])

  return { snapshot, error, refreshError, phase, moreError, moreLoading, load, more }
}

/**
 * 一次拉取。
 * @param target - 落地要用的状态。
 * @param mode - 请求方式。
 * @returns 已落地的数据；失败或过期时为 null。
 */
async function loadSnapshot(
  target: LoadTarget,
  mode: RequestMode,
): Promise<WorkspaceSnapshot | null> {
  const current = target.sequence.current + 1
  target.sequence.current = current
  target.setMoreError(null)

  if (target.workspaceRoot === undefined) {
    target.setSnapshot(null)
    target.latest.current = null
    target.hasData.current = false
    target.setError({ code: 'invalid-params', message: target.t('error.snapshotNoWorkspace') })
    target.setPhase('error')
    return null
  }

  // 后台刷新不当成一次「刷新中」：按钮不变、列表不换、数据时间不动。
  const quiet = mode === 'auto' && target.hasData.current
  if (!quiet) target.setPhase(mode === 'get' ? 'loading' : 'refreshing')
  target.setError(null)
  const result =
    mode === 'get'
      ? await target.client.get(target.workspaceRoot)
      : await target.client.refresh(target.workspaceRoot, { full: mode === 'refresh-full' })
  if (current !== target.sequence.current) return null

  if (!result.ok) return applyFailure(target, mode, quiet, result.error)
  const root = target.workspaceRoot
  return quiet
    ? applyQuiet(target, root, current, result.result)
    : applyLoaded(target, root, current, result.result)
}

/**
 * 扩一页列表窗口。
 *
 * 宿主负责合并、排序与窗口上限；界面只替换快照。失败时保留现有列表，
 * 把原因交给哨兵显示重试入口。刷新会推进序号，旧扩窗结果不能覆盖新列表。
 * @param target - 落地要用的状态。
 * @param running - 扩窗是否已在路上，防止叠发。
 * @returns 已落地的数据；失败、叠发或过期时为 null。
 */
async function loadMoreSnapshot(
  target: LoadTarget,
  running: React.RefObject<boolean>,
): Promise<WorkspaceSnapshot | null> {
  if (target.workspaceRoot === undefined || running.current) return null

  running.current = true
  target.setMoreLoading(true)
  target.setMoreError(null)

  const current = target.sequence.current + 1
  target.sequence.current = current
  const root = target.workspaceRoot

  try {
    const result = await target.client.more(root)
    if (current !== target.sequence.current) return null
    if (!result.ok) {
      target.setMoreError(result.error)
      return null
    }

    commit(target, result.result)
    if (result.result.blockersFinalized) return result.result

    // 扩窗后的新票也要补齐原生阻塞数；失败时保留列表阶段的结果。
    const finalized = await target.client.resolveBlockers(root)
    if (current !== target.sequence.current) return null
    if (!finalized.ok) return result.result
    commit(target, finalized.result)
    return finalized.result
  } finally {
    running.current = false
    target.setMoreLoading(false)
  }
}

/**
 * 失败：有旧数据就保留列表、只记原因；没有再切错误页。
 * @returns 始终为 null。
 */
function applyFailure(
  target: LoadTarget,
  mode: RequestMode,
  quiet: boolean,
  error: RpcErrorBody,
): null {
  if (!quiet && (mode === 'get' || !target.hasData.current)) {
    target.setError(error)
    target.setPhase('error')
    return null
  }
  target.setRefreshError(error)
  if (!quiet) target.setPhase('ready')
  return null
}

/**
 * 后台刷新的落地：先补齐阻塞再和当前显示比较，没有可见变化就不改写。
 * @returns 已落地的数据；没变化时是当前显示的那份。
 */
async function applyQuiet(
  target: LoadTarget,
  root: string,
  current: number,
  result: WorkspaceSnapshot,
): Promise<WorkspaceSnapshot | null> {
  let settled = result
  if (!settled.blockersFinalized) {
    const finalized = await target.client.resolveBlockers(root)
    // 刷新会推进序号；旧补齐结果不能覆盖新列表。
    if (current !== target.sequence.current) return null
    // 补齐失败时这份结果不可比：保留当前数据，下一轮再试。
    if (!finalized.ok) return null
    settled = finalized.result
  }

  const previous = target.latest.current
  if (
    previous !== null &&
    previous.blockersFinalized &&
    !snapshotVisibleChange(previous, settled)
  ) {
    // 数据没变：不落地、不重绘，但这次刷新是成功的，失败原因要清掉。
    target.setRefreshError(null)
    return previous
  }
  commit(target, settled)
  target.setRefreshError(null)
  return settled
}

/**
 * 首屏与手动刷新的落地：先把列表显示出来，阻塞信息随后补齐。
 * @returns 补齐后的数据（补齐失败时是首屏那份）。
 */
async function applyLoaded(
  target: LoadTarget,
  root: string,
  current: number,
  result: WorkspaceSnapshot,
): Promise<WorkspaceSnapshot | null> {
  commit(target, result)
  target.setError(null)
  target.setRefreshError(null)
  target.setPhase('ready')
  if (result.blockersFinalized) return result

  const finalized = await target.client.resolveBlockers(root)
  // 刷新会推进序号；旧补齐结果不能覆盖新列表。
  if (current !== target.sequence.current) return null
  // 补齐失败保留首屏结果：列表已经可用，不弹错误横幅。
  if (!finalized.ok) return result
  commit(target, finalized.result)
  return finalized.result
}

function commit(target: LoadTarget, next: WorkspaceSnapshot): void {
  target.setSnapshot(next)
  target.latest.current = next
  target.hasData.current = true
}
