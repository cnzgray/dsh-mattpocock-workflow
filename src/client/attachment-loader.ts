/**
 * 正文内联附件的取图入口：经宿主取回图片字节，拼成 data URL。
 *
 * 同一份详情里正文与评论可能引用同一张图，重渲染也会再次挂载图片组件；
 * 按附件地址缓存进行中的请求，一张图只请求一次。失败结果同样缓存，不反复重试。
 */
import type { PanelClient } from './rpc.ts'

/** 按根相对的 `/uploads/...` 地址取图；成功给 data URL，失败给 null。 */
export type AttachmentLoader = (path: string) => Promise<string | null>

/**
 * 创建带缓存的取图函数。
 * @param client - 面板客户端。
 * @param workspaceRoot - 当前工作区。
 * @returns 取图函数。
 */
export function createAttachmentLoader(
  client: Pick<PanelClient, 'getAttachment'>,
  workspaceRoot: string,
): AttachmentLoader {
  const cache = new Map<string, Promise<string | null>>()
  return (path) => {
    const cached = cache.get(path)
    if (cached !== undefined) return cached
    const pending = client.getAttachment(workspaceRoot, path).then(
      (result) =>
        result.ok ? `data:${result.result.mediaType};base64,${result.result.base64}` : null,
      () => null,
    )
    cache.set(path, pending)
    return pending
  }
}
