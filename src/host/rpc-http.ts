/**
 * 把 HTTP 请求翻译成快照服务的 `handle(method, params)` 调用。
 * 只做传输层校验，业务结果原样放进响应体。
 */
import { ERROR_CODES, type ErrorCode, type RpcResult } from '../protocol/tracker.ts'

/** 插件 RPC 的入口形状；快照服务与环境检查服务都实现它。 */
export interface RpcHandler {
  handle(method: string, params: unknown): Promise<RpcResult<unknown>>
}

/**
 * 创建挂到 `connection.fetch` 上的路由处理器。
 * @param service - 按方法名分发的 RPC 处理器。
 * @returns 接收 Fetch Request、返回 JSON 响应的处理器。
 */
export function createRpcFetchHandler(
  service: RpcHandler,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'POST') {
      return new Response('method not allowed', { status: 405 })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return jsonResponse(failure(ERROR_CODES.invalidRequest, '请求体不是有效 JSON。'), 400)
    }

    const call = readRequest(body)
    if (call === undefined) {
      return jsonResponse(failure(ERROR_CODES.invalidRequest, '请求缺少 method 或 params。'), 400)
    }

    const result = await service.handle(call.method, call.params)
    return jsonResponse(result, 200)
  }
}

function readRequest(
  value: unknown,
): { readonly method: string; readonly params: unknown } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  if (!('method' in value) || !('params' in value)) return undefined
  const method = value.method
  if (typeof method !== 'string' || method.length === 0) return undefined
  return { method, params: value.params }
}

function jsonResponse(body: RpcResult<unknown>, status: number): Response {
  return Response.json(body, { status })
}

function failure(code: ErrorCode, message: string): RpcResult<unknown> {
  return { ok: false, error: { code, message } }
}
