/**
 * RPC 参数校验。快照服务与工单服务共用同一份形状定义，
 * 参数不合法时都返回 `invalid-params`，不把脏数据传给适配器。
 */

/** 一个工作区定位参数。 */
export interface WorkspaceParams {
  readonly workspaceRoot: string
}

/** 工单详情与变更共用的定位参数。 */
export interface TicketParams {
  readonly workspaceRoot: string
  readonly ref: string
  readonly number: number | null
}

/**
 * 读取非空的工作区根目录。
 * @param params - 任意请求参数。
 * @returns 工作区根目录；缺失时 undefined。
 */
export function readWorkspaceRoot(params: unknown): string | undefined {
  if (typeof params !== 'object' || params === null) return undefined
  if (!('workspaceRoot' in params)) return undefined
  const root = params.workspaceRoot
  return typeof root === 'string' && root.length > 0 ? root : undefined
}

/**
 * 读取一张票的定位参数：工作区、引用与非负编号（本地 Markdown 为 null）。
 * @param params - 任意请求参数。
 * @returns 定位参数；任一字段不合法时 undefined。
 */
export function readTicketParams(params: unknown): TicketParams | undefined {
  const workspaceRoot = readWorkspaceRoot(params)
  if (workspaceRoot === undefined || typeof params !== 'object' || params === null) return undefined
  if (!('ref' in params)) return undefined
  const ref = params.ref
  if (typeof ref !== 'string' || ref.length === 0) return undefined
  if (!('number' in params)) return undefined
  const number = params.number
  if (number !== null && !(typeof number === 'number' && Number.isInteger(number) && number > 0)) {
    return undefined
  }
  return { workspaceRoot, ref, number }
}
