/**
 * 服务端插件入口。DSH 按默认导出加载：inject 里列出的服务就绪后才调用 apply。
 * 这里只做组装：工单规则在 core，各后端读取在 adapters，RPC 契约在 protocol。
 *
 * 每个 `ctx.get` 都做存在性检查：DSH 版本不同或某个服务缺失时，
 * 插件降级并记日志，而不是抛错让整个客户端加载失败。
 */
import { createNodeEnvFiles } from '../adapters/fs/env-files.ts'
import { createGiteaEnvProbe } from '../adapters/gitea/env.ts'
import { createGithubEnvProbe } from '../adapters/github/env.ts'
import { createGitlabEnvProbe } from '../adapters/gitlab/env.ts'
import { createLocalIssuesProbe } from '../adapters/markdown/env.ts'
import { createNodeWorkspaceFiles } from '../adapters/markdown/files.ts'
import type { CommandRunner } from '../core/ticket.ts'
import { HOST_CAPABILITY_IDS, type CapabilityDiagnostic } from '../protocol/env-check.ts'
import { TRACKER_LABELS } from '../protocol/labels.ts'
import { RPC_METHODS, RPC_PATH } from '../protocol/tracker.ts'
import { createBackendResolver } from './backend-resolver.ts'
import {
  readConnection,
  readSkills,
  readSubprocess,
  readTimer,
  type DshContext,
  type DshLogger,
  type TimerLike,
} from './dsh-types.ts'
import { createEnvCheckService, type SkillCatalog } from './env-check-service.ts'
import { createProbeDeadline, ENV_PROBE_TIMEOUT_MS } from './probe-deadline.ts'
import type { LogSink } from './log.ts'
import { createRpcFetchHandler, type RpcHandler } from './rpc-http.ts'
import { createSnapshotService } from './snapshot-service.ts'
import { createTicketService } from './ticket-service.ts'
import { createCommandRunner } from './subprocess-runner.ts'
import { registerWorkflowCommands } from './workflow-commands.ts'

const PLUGIN_NAME = 'dsh-mattpocock-workflow'

const plugin = {
  inject: ['subprocess', 'timer'] as string[],
  apply(rawCtx: unknown): void {
    const ctx = rawCtx as DshContext
    const logger = ctx.logger(PLUGIN_NAME)

    // 入池命令是插件自带的内嵌技能：技能服务就绪后注册，缺失时只降级。
    if (ctx.get('skills') === undefined) {
      logger.info('%s', 'skills 服务尚未就绪，入池命令等待注册。')
    }
    ctx.inject(['skills'], (scope) => {
      registerWorkflowCommands(scope, logger)
    })

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

      const rpc = createRpcHandler(
        scope,
        createCommandRunner(subprocess, timer),
        timer,
        createLog(logger),
      )

      let dispose: (() => Promise<void>) | undefined
      try {
        dispose = connection.fetch.register({
          path: RPC_PATH,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: createRpcFetchHandler(rpc),
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

/**
 * 组装快照与环境检查两个服务，并按方法名分发。
 * @param scope - connection 就绪后的宿主上下文。
 * @param run - 注入式命令执行器。
 * @param timer - 计时服务，用于探测超时。
 * @param log - 日志出口。
 * @returns RPC 处理器。
 */
function createRpcHandler(
  scope: DshContext,
  run: CommandRunner,
  timer: TimerLike,
  log: LogSink,
): RpcHandler {
  const now = (): number => Date.now()
  const workspaceFiles = createNodeWorkspaceFiles()
  const resolve = createBackendResolver({ run, now, files: workspaceFiles })
  // 环境检查每次都重新探测后端：刚装好 glab / tea 或刚加上远端时要能马上看到变化。
  const resolveFresh = createBackendResolver({ run, now, files: workspaceFiles, cache: false })

  const snapshot = createSnapshotService({ resolve, now, labels: TRACKER_LABELS, log })
  const ticket = createTicketService({ resolve, now, log })
  const envCheck = createEnvCheckService({
    resolve: resolveFresh,
    github: createGithubEnvProbe({ run }),
    gitlab: createGitlabEnvProbe({ run }),
    gitea: createGiteaEnvProbe({ run }),
    files: createNodeEnvFiles(),
    localIssues: createLocalIssuesProbe({ files: workspaceFiles }),
    skills: createSkillCatalog(scope),
    capabilities: () => readHostCapabilities(scope),
    now,
    deadline: createProbeDeadline(timer, ENV_PROBE_TIMEOUT_MS),
    log,
  })

  return {
    handle: (method, params) => {
      if (method === RPC_METHODS.envCheck) return envCheck.handle(method, params)
      if (
        method === RPC_METHODS.ticketGet ||
        method === RPC_METHODS.ticketUpdate ||
        method === RPC_METHODS.ticketOptions ||
        method === RPC_METHODS.ticketDelete
      ) {
        return ticket.handle(method, params)
      }
      return snapshot.handle(method, params)
    },
  }
}

function createLog(logger: DshLogger): LogSink {
  return (level, event, fields) => {
    try {
      logger[level]('%s %o', event, fields)
    } catch (logError) {
      // 日志出口失败不能影响 RPC 响应，但也不能静默吞掉。
      console.error(`[${PLUGIN_NAME}] 日志写入失败`, logError)
    }
  }
}

function createSkillCatalog(scope: DshContext): SkillCatalog {
  return {
    async names(workspaceRoot) {
      const registry = readSkills(scope.get('skills'))
      if (registry === undefined) throw new Error('skills 服务不可用')
      const skills = await registry.list({ cwd: workspaceRoot })
      return skills.map((skill) => skill.name)
    },
  }
}

function readHostCapabilities(scope: DshContext): readonly CapabilityDiagnostic[] {
  return HOST_CAPABILITY_IDS.map((id) => ({
    id,
    category: 'host-service' as const,
    status: scope.get(id) === undefined ? ('missing' as const) : ('present' as const),
  }))
}

export default plugin
