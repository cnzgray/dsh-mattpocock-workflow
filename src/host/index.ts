/**
 * 服务端插件入口。DSH 按默认导出加载：inject 里列出的服务就绪后才调用 apply。
 * 这里只做组装：工单规则在 core，各后端读取在 adapters，RPC 契约在 protocol。
 *
 * 每个 `ctx.get` 都做存在性检查：DSH 版本不同或某个服务缺失时，
 * 插件降级并记日志，而不是抛错让整个客户端加载失败。
 */
import { TRACKER_LABELS } from '../protocol/labels.ts'
import { RPC_PATH } from '../protocol/tracker.ts'
import { createBackendResolver } from './backend-resolver.ts'
import { readConnection, readSubprocess, readTimer, type DshContext } from './dsh-types.ts'
import { createRpcFetchHandler } from './rpc-http.ts'
import { createSnapshotService } from './snapshot-service.ts'
import { createCommandRunner } from './subprocess-runner.ts'

const PLUGIN_NAME = 'dsh-mattpocock-workflow'

const plugin = {
  inject: ['subprocess', 'timer'] as string[],
  apply(rawCtx: unknown): void {
    const ctx = rawCtx as DshContext
    const logger = ctx.logger(PLUGIN_NAME)

    // connection 是可选依赖：没有它时面板仍可加载，只是没有 RPC 通道。
    ctx.inject(['connection'], (scope) => {
      const connection = readConnection(scope.get('connection'))
      if (connection === undefined) {
        logger.warn('%s', 'connection 服务不可用，工单 RPC 未注册。')
        return
      }

      const subprocess = readSubprocess(scope.get('subprocess'))
      const timer = readTimer(scope.get('timer'))
      if (subprocess === undefined || timer === undefined) {
        logger.warn('%s', 'subprocess 或 timer 服务不可用，工单 RPC 未注册。')
        return
      }

      const run = createCommandRunner(subprocess, timer)
      const resolve = createBackendResolver({ run, now: () => Date.now() })
      const service = createSnapshotService({
        resolve,
        now: () => Date.now(),
        labels: TRACKER_LABELS,
        log: (level, event, fields) => {
          try {
            logger[level]('%s %o', event, fields)
          } catch (logError) {
            // 日志出口失败不能影响 RPC 响应，但也不能静默吞掉。
            console.error(`[${PLUGIN_NAME}] 日志写入失败`, logError)
          }
        },
      })

      let dispose: (() => Promise<void>) | undefined
      try {
        dispose = connection.fetch.register({
          path: RPC_PATH,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: createRpcFetchHandler(service),
        })
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        logger.error('%s %s', '工单 RPC 注册失败：', reason)
        return
      }
      scope.effect(
        () => () => {
          void dispose()
        },
        `${PLUGIN_NAME}: ${RPC_PATH}`,
      )
      logger.info('%s %s', '工单 RPC 已注册：', RPC_PATH)
    })
  },
}

export default plugin
