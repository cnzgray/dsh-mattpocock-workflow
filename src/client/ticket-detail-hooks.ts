/**
 * 工单详情视图的数据 hooks：读取详情、提交变更、按需读取补全候选、删除工单、Esc 返回。
 *
 * 写操作成功后重新读取详情（不做乐观更新），并刷新列表快照让徽标同步；
 * 删除成功后刷新列表并返回列表。
 */
import * as React from 'react'

import type {
  RpcErrorBody,
  RpcResult,
  TicketDetail,
  TicketOptions,
  TicketPatch,
  WorkspaceSnapshot,
} from '../protocol/tracker.ts'
import { copyText } from './clipboard.ts'
import { detailCacheDecision, readDetailCache, writeDetailCache } from './detail-cache.ts'
import { errorText } from './error-text.ts'
import { useI18n } from './i18n.tsx'
import type { Translate } from './i18n-runtime.ts'
import type { PanelClient } from './rpc.ts'
import type { Suggestion, SuggestionSource } from './ticket-combobox.tsx'
import type { CopyState, OptionsState } from './ticket-detail-fields.tsx'

export interface DetailRequest {
  readonly detail: TicketDetail | null
  readonly error: RpcErrorBody | null
  readonly phase: 'loading' | 'ready' | 'error'
  /** 手动重试首次读取；只在下一次读取成功前保留旧的错误页。 */
  readonly reload: () => void
  readonly replace: (detail: TicketDetail) => void
  /** 重读当前这张票：不进入加载阶段、不清空已显示的内容。 */
  readonly refresh: () => void
  /** 重读进行中：刷新按钮与写控件据此禁用。 */
  readonly refreshing: boolean
  /** 最近一次重读失败的原因；内容仍保留，下次成功时清除。 */
  readonly refreshError: RpcErrorBody | null
}

/**
 * 读取一张工单的详情；本地优先，命中且没变时秒开。
 * 缓存以列表快照里的 `updatedAt` 为有效性键；拉取失败保留已显示的内容。
 * @param client - 面板客户端。
 * @param workspaceRoot - 工作区根目录。
 * @param ref - 工单引用。
 * @param number - 数字编号；本地 Markdown 为 null。
 * @param repository - 跨仓库详情的仓库段；当前工作区仓库为 null。
 * @param currentUpdatedAt - 列表快照里这张票的更新时间；拿不到时每次都要拉。
 * @returns 详情、阶段与手动入口。
 */
export function useDetailRequest(
  client: PanelClient,
  workspaceRoot: string,
  ref: string,
  number: number | null,
  repository: string | null,
  currentUpdatedAt: string | undefined,
): DetailRequest {
  const [detail, setDetail] = React.useState<TicketDetail | null>(null)
  const [error, setError] = React.useState<RpcErrorBody | null>(null)
  const [phase, setPhase] = React.useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = React.useState(0)
  const [refreshing, setRefreshing] = React.useState(false)
  const [refreshError, setRefreshError] = React.useState<RpcErrorBody | null>(null)
  // 重读与首次读取是两条路：只有最新一次仍然有效时结果才落地，
  // 换票、重试或卸载都让在路上的那次作废。
  const readId = React.useRef(0)
  const readRunning = React.useRef(false)

  React.useEffect(() => {
    return startDetailLoad({
      client,
      workspaceRoot,
      ref,
      number,
      repository,
      currentUpdatedAt,
      attempt,
      readId,
      readRunning,
      setDetail,
      setError,
      setPhase,
      setRefreshing,
      setRefreshError,
    })
  }, [client, workspaceRoot, ref, number, repository, attempt, currentUpdatedAt])

  const refresh = (): void => {
    if (readRunning.current) return
    readRunning.current = true
    const current = readId.current + 1
    readId.current = current
    setRefreshing(true)

    void client.getDetail(workspaceRoot, ref, number, repository ?? undefined).then((result) => {
      if (readId.current !== current) return
      readRunning.current = false
      setRefreshing(false)
      applyDetailRead({
        workspaceRoot,
        result,
        cached: true,
        setDetail,
        setPhase,
        setError,
        setRefreshError,
      })
      if (result.ok) setRefreshError(null)
    })
  }

  return {
    detail,
    error,
    phase,
    reload: () => {
      setAttempt((value) => value + 1)
    },
    replace: (next) => {
      // 写操作落地的新详情同时成为缓存基准：再进入时按新更新时间上票。
      writeDetailCache(workspaceRoot, next)
      setDetail(next)
    },
    refresh,
    refreshing,
    refreshError,
  }
}

/** startDetailLoad 依赖的状态落地口：加载与重读共用同一套判定。 */
interface DetailLoadTarget {
  readonly client: PanelClient
  readonly workspaceRoot: string
  readonly ref: string
  readonly number: number | null
  /** 跨仓库详情的仓库段；当前工作区仓库为 null。 */
  readonly repository: string | null
  readonly currentUpdatedAt: string | undefined
  readonly readId: React.RefObject<number>
  readonly readRunning: React.RefObject<boolean>
  readonly setDetail: (detail: TicketDetail | null) => void
  readonly setError: (error: RpcErrorBody | null) => void
  readonly setPhase: (phase: 'loading' | 'ready' | 'error') => void
  readonly setRefreshing: (refreshing: boolean) => void
  readonly setRefreshError: (error: RpcErrorBody | null) => void
}

/**
 * 首读与换票：本地优先，命中且列表时间未变时秒开（不发请求）；
 * 有缓存但票已变更时先显示缓存、后台静默拉新。返回 effect 清理函数。
 */
function startDetailLoad(target: DetailLoadTarget & { readonly attempt: number }): () => void {
  const {
    client,
    workspaceRoot,
    ref,
    number,
    repository,
    currentUpdatedAt,
    readId,
    readRunning,
    setDetail,
    setError,
    setPhase,
    setRefreshing,
    setRefreshError,
  } = target
  let active = true
  // 换一张票时先作废在路上的读取；内容是否清空看缓存里有没有可立刻显示的。
  readId.current += 1
  readRunning.current = false
  setError(null)
  setRefreshing(false)
  setRefreshError(null)

  const hit = readDetailCache(workspaceRoot, ref)
  const decision = detailCacheDecision(hit, currentUpdatedAt)
  if (decision === 'hit') {
    // 缓存命中且列表显示这张票没变更：秒开，不进入加载阶段、不发请求。
    if (hit !== null) setDetail(hit.detail)
    setPhase('ready')
    return () => {
      active = false
      readId.current += 1
    }
  }
  if (decision === 'stale') {
    // 有缓存但票已变更（或拿不到列表时间）：先显示缓存，后台静默拉新。
    if (hit !== null) setDetail(hit.detail)
    setPhase('ready')
  } else {
    setDetail(null)
    setPhase('loading')
  }

  void client.getDetail(workspaceRoot, ref, number, repository ?? undefined).then((result) => {
    if (!active) return
    applyDetailRead({
      workspaceRoot,
      result,
      cached: decision !== 'miss',
      setDetail,
      setPhase,
      setError,
      setRefreshError,
    })
  })

  return () => {
    active = false
    readId.current += 1
  }
}

/** 落地一次详情读取：成功写缓存并显示；有缓存时失败只记原因，没有才进错误页。 */
function applyDetailRead(options: {
  readonly workspaceRoot: string
  readonly result: RpcResult<TicketDetail>
  /** 失败时是否有已显示的内容可以保留。 */
  readonly cached: boolean
  readonly setDetail: (detail: TicketDetail) => void
  readonly setPhase: (phase: 'loading' | 'ready' | 'error') => void
  readonly setError: (error: RpcErrorBody | null) => void
  readonly setRefreshError: (error: RpcErrorBody) => void
}): void {
  const { result } = options
  if (result.ok) {
    writeDetailCache(options.workspaceRoot, result.result)
    options.setDetail(result.result)
    options.setPhase('ready')
    return
  }
  if (options.cached) {
    options.setRefreshError(result.error)
    return
  }
  options.setError(result.error)
  options.setPhase('error')
}

export interface TicketMutation {
  readonly busy: boolean
  readonly error: RpcErrorBody | null
  readonly apply: (patch: TicketPatch) => void
}

export function useTicketMutation(
  client: PanelClient,
  options: {
    readonly workspaceRoot: string
    readonly ref: string
    readonly number: number | null
    /** 跨仓库详情的仓库段；写操作不会发生，但复查仍需读对仓库。 */
    readonly repository: string | null
    readonly onUpdated: (detail: TicketDetail) => void
    /** 写操作后重建的快照：技能动作可能变了，详情头部据此更新徽标。 */
    readonly onSnapshot: (snapshot: WorkspaceSnapshot) => void
  },
): TicketMutation {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<RpcErrorBody | null>(null)
  const running = React.useRef(false)

  const apply = (patch: TicketPatch): void => {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError(null)

    void (async () => {
      try {
        const result = await client.updateTicket(
          options.workspaceRoot,
          options.ref,
          options.number,
          patch,
        )
        if (!result.ok) {
          setError(result.error)
          return
        }

        // 写已落地：详情复查与列表刷新同时进行，任一失败都不影响另一项。
        // 列表徽标要同步；详情复查成功才替换显示值（不做乐观更新）。
        // 没带 ifVersion 的刷新回整份快照；变化行/未变回包由面板自己的刷新周期收敛。
        const [fresh, snapshot] = await Promise.all([
          client.getDetail(
            options.workspaceRoot,
            options.ref,
            options.number,
            options.repository ?? undefined,
          ),
          client.refresh(options.workspaceRoot),
        ])
        if (snapshot.ok && snapshot.result.kind === 'full') {
          options.onSnapshot(snapshot.result.snapshot)
        }
        if (!fresh.ok) {
          setError(fresh.error)
          return
        }
        options.onUpdated(fresh.result)
      } finally {
        running.current = false
        setBusy(false)
      }
    })()
  }

  return { busy, error, apply }
}

export function useEscapeKey(onBack: () => void): void {
  const handler = React.useRef(onBack)
  handler.current = onBack

  React.useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') handler.current()
    }
    window.addEventListener('keydown', listener)
    return () => {
      window.removeEventListener('keydown', listener)
    }
  }, [])
}

type OptionsLoad =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly options: TicketOptions }
  | { readonly status: 'failed'; readonly error: RpcErrorBody }

/**
 * 补全候选与标签颜色。标签颜色要在小块上显示，所以可写标签的后端在详情打开时就读一次；
 * 其余情况等用户展开编辑器才读。读取失败不影响手动输入。
 * @param client - 面板客户端。
 * @param workspaceRoot - 工作区根目录。
 * @param eager - 是否在挂载时就读取（详情可写标签时为 true）。
 * @returns 两组候选、标签颜色表与请求入口。
 */
export function useTicketOptions(
  client: PanelClient,
  workspaceRoot: string,
  eager: boolean,
): OptionsState {
  const { t } = useI18n()
  const [load, setLoad] = React.useState<OptionsLoad>({ status: 'idle' })
  const started = React.useRef(false)
  const mounted = React.useRef(true)

  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const request = React.useCallback((): void => {
    if (started.current) return
    started.current = true
    setLoad({ status: 'loading' })
    void client.getOptions(workspaceRoot).then((result) => {
      if (!mounted.current) return
      setLoad(
        result.ok
          ? { status: 'ready', options: result.result }
          : { status: 'failed', error: result.error },
      )
    })
  }, [client, workspaceRoot])

  React.useEffect(() => {
    if (eager) request()
  }, [eager, request])

  // 不缓存：失败原因与候选说明在渲染期按当前语言物化，语言切换必须重新取词。
  return optionsState(load, request, t)
}

function optionsState(load: OptionsLoad, request: () => void, t: Translate): OptionsState {
  if (load.status !== 'ready') {
    const source: SuggestionSource =
      load.status === 'failed'
        ? {
            status: 'unavailable',
            reason: t('detail.optionsFailed', { detail: errorText(load.error, t) }),
          }
        : { status: 'loading' }
    return { labels: source, assignees: source, labelColors: new Map(), request }
  }

  const labels: Suggestion[] = load.options.labels.map((label) => ({
    value: label.name,
    detail: label.description,
    color: label.color ?? 'transparent',
  }))
  const assignees: Suggestion[] = load.options.assignees.map((user) => ({
    value: user.username,
    detail: user.name,
    color: null,
  }))
  const labelColors = new Map<string, string>()
  for (const label of load.options.labels) {
    if (label.color !== null) labelColors.set(label.name, label.color)
  }

  return {
    labels: { status: 'ready', items: labels },
    assignees: { status: 'ready', items: assignees },
    labelColors,
    request,
  }
}

/** 删除工单的状态与入口。 */
export interface TicketDeletion {
  /** 确认面板是否打开。 */
  readonly confirming: boolean
  readonly deleting: boolean
  readonly error: RpcErrorBody | null
  readonly open: () => void
  readonly cancel: () => void
  readonly confirm: () => void
}

/**
 * 删除流程：打开确认面板 → 用户输入确认词 → 删除 → 刷新列表 → 走调用方的返回入口
 * （面板里弹一层返回栈，栈空时回列表）。删除失败时留在面板里显示原因，不返回。
 * @param client - 面板客户端。
 * @param target - 工作区与工单定位，以及删除成功后的去处。
 * @returns 删除状态与入口。
 */
export function useTicketDeletion(
  client: PanelClient,
  target: {
    readonly workspaceRoot: string
    readonly ref: string
    readonly number: number | null
    readonly onDeleted: () => void
  },
): TicketDeletion {
  const [confirming, setConfirming] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [error, setError] = React.useState<RpcErrorBody | null>(null)

  const confirm = (): void => {
    if (deleting) return
    setDeleting(true)
    setError(null)
    void (async () => {
      const result = await client.deleteTicket(target.workspaceRoot, target.ref, target.number)
      if (!result.ok) {
        setError(result.error)
        setDeleting(false)
        return
      }
      // 删除已落地：刷新列表快照再返回，列表里不会残留这张票。
      await client.refresh(target.workspaceRoot)
      target.onDeleted()
    })()
  }

  return {
    confirming,
    deleting,
    error,
    open: () => {
      setError(null)
      setConfirming(true)
    },
    cancel: () => {
      setConfirming(false)
      setError(null)
    },
    confirm,
  }
}

/** “已复制”对勾停留的时长。 */
const COPIED_RESET_MS = 2000

/**
 * 复制链接：成功后两秒回到 idle（图标从对勾变回链接）；失败保持，直到下一次复制。
 * @param url - 工单地址；null 时复制不做任何事。
 * @returns 复制状态与触发入口。
 */
export function useCopyLink(
  url: string | null,
  t: Translate,
): {
  readonly copy: CopyState
  readonly onCopy: () => void
} {
  const [copy, setCopy] = React.useState<CopyState>({ status: 'idle' })

  React.useEffect(() => {
    if (copy.status !== 'copied') return
    const timer = setTimeout(() => {
      setCopy({ status: 'idle' })
    }, COPIED_RESET_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [copy])

  return {
    copy,
    onCopy: () => {
      if (url === null) return
      void copyText(url, t).then(setCopy)
    },
  }
}
