/**
 * 刷新退避闸门：连续失败后的冷却与半开试探。
 *
 * 每次失败把冷却按指数拉长（可被服务端 Retry-After 覆盖），冷却期内刷新不发后端、
 * 直接回本地缓存；冷却到期自然放行一次试探，成功一次立刻归零。
 * 思路对齐 skills-deck 的失败窗口（failure-window）：defer 不是拒绝，是稍等。
 */

/** 一个工作区的退避状态视图。 */
export interface RefreshGuardView {
  /** 连续失败次数；成功一次归零。 */
  readonly failuresSinceSuccess: number
  /** 冷却截止时刻；不在冷却中是 0。 */
  readonly coolingUntil: number
}

/** 退避闸门口：状态按工作区隔离，时钟由调用方传入，闸门自己不碰时间。 */
export interface RefreshGuard {
  /**
   * 冷却截止时刻；不在冷却中（或已到期）返回 null。到期即放行一次试探。
   * @param workspaceRoot - 工作区根目录。
   * @param at - 当前时刻。
   */
  blockedUntil(workspaceRoot: string, at: number): number | null
  /**
   * 成功一次：失败计数立刻归零，冷却取消。
   * @param workspaceRoot - 工作区根目录。
   */
  noteSuccess(workspaceRoot: string): void
  /**
   * 记录一次失败，返回新的冷却截止时刻。
   * retryAfterMs 给定时优先于指数退避（仍受上限约束）。
   * @param workspaceRoot - 工作区根目录。
   * @param at - 当前时刻。
   * @param retryAfterMs - 服务端要求的重试等待（毫秒）。
   */
  noteFailure(workspaceRoot: string, at: number, retryAfterMs?: number): number
  /** 诊断读数：当前失败计数与冷却截止。 */
  view(workspaceRoot: string): RefreshGuardView
}

/** 闸门参数；缺省 5 秒起步、5 分钟封顶。 */
export interface RefreshGuardOptions {
  /** 第一次失败的冷却时长。 */
  readonly baseMs?: number
  /** 冷却时长上限。 */
  readonly maxMs?: number
}

/**
 * 创建退避闸门。
 * @param options - 冷却步长与上限。
 */
export function createRefreshGuard(options: RefreshGuardOptions = {}): RefreshGuard {
  const baseMs = options.baseMs ?? 5_000
  const maxMs = options.maxMs ?? 300_000
  const states = new Map<string, { failuresSinceSuccess: number; coolingUntil: number }>()

  function stateOf(workspaceRoot: string) {
    let state = states.get(workspaceRoot)
    if (state === undefined) {
      state = { failuresSinceSuccess: 0, coolingUntil: 0 }
      states.set(workspaceRoot, state)
    }
    return state
  }

  return {
    blockedUntil(workspaceRoot, at) {
      const state = states.get(workspaceRoot)
      if (state === undefined || state.coolingUntil <= at) return null
      return state.coolingUntil
    },
    noteSuccess(workspaceRoot) {
      const state = stateOf(workspaceRoot)
      state.failuresSinceSuccess = 0
      state.coolingUntil = 0
    },
    noteFailure(workspaceRoot, at, retryAfterMs) {
      const state = stateOf(workspaceRoot)
      state.failuresSinceSuccess += 1
      // 指数退避：第 1 次 base，第 2 次 2×base，第 3 次 4×base……封顶 maxMs。
      const backoffMs = Math.min(baseMs * 2 ** Math.min(state.failuresSinceSuccess - 1, 16), maxMs)
      const waitMs =
        retryAfterMs !== undefined && retryAfterMs > 0 ? Math.min(retryAfterMs, maxMs) : backoffMs
      state.coolingUntil = at + waitMs
      return state.coolingUntil
    },
    view(workspaceRoot) {
      const state = states.get(workspaceRoot)
      return state === undefined ? { failuresSinceSuccess: 0, coolingUntil: 0 } : { ...state }
    },
  }
}
