/**
 * 剪贴板：优先调用浏览器剪贴板 API，不可用或写入失败时把原因交给界面。
 * 界面永远保留可全选的只读地址，静默失败在这里不存在。
 */

/** 一次复制的结果。 */
export interface CopyOutcome {
  readonly status: 'copied' | 'failed'
  /** 失败原因，给用户看的；成功时没有。 */
  readonly message?: string
}

/**
 * 把文本写入剪贴板。
 * @param text - 要复制的文本。
 * @returns 成功或带原因的失败。
 */
export async function copyText(text: string): Promise<CopyOutcome> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
    return { status: 'failed', message: '当前环境没有剪贴板 API，请手动选中链接复制。' }
  }

  try {
    await clipboard.writeText(text)
    return { status: 'copied' }
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知错误'
    return { status: 'failed', message: `复制失败：${detail}。请手动选中链接复制。` }
  }
}
