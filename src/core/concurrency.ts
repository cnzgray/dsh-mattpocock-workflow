/**
 * 有并发上限的批量映射。命令型后端要给每张开放工单查阻塞关系，
 * 一张票一个请求，全部同时发出去会把自建实例打满。
 */

/**
 * 按上限并发执行，结果顺序与输入一致。
 *
 * 任一任务失败后不再启动新任务，全部在跑的任务结束后抛出第一个错误：
 * 阻塞关系查不到时宁可整次拉取失败，也不返回残缺的阻塞数。
 * @param items - 输入条目。
 * @param limit - 同时执行的任务数上限，小于 1 时按 1 处理。
 * @param worker - 单个条目的处理函数。
 * @returns 与输入同序的结果。
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const runners = Math.min(Math.max(1, Math.trunc(limit)), items.length)
  const results = new Map<number, R>()
  const errors: Error[] = []
  let next = 0

  const run = async (): Promise<void> => {
    while (errors.length === 0) {
      const index = next
      next += 1
      const item = items[index]
      if (index >= items.length || item === undefined) return
      try {
        results.set(index, await worker(item))
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  await Promise.all(Array.from({ length: runners }, run))

  const failure = errors[0]
  if (failure !== undefined) throw failure

  return items.map((_, index) => {
    const result = results.get(index)
    if (result === undefined) throw new Error('并发映射没有返回结果')
    return result
  })
}
