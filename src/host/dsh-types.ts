/**
 * DSH 宿主服务的最小本地声明。DSH 没有随包发布的公开类型入口，
 * 这里只声明插件实际用到的成员；每次 `ctx.get` 后仍要做存在性检查。
 */
import { isRecord } from '../core/json.ts'

/** DSH 日志器：与 cordis LoggerService 的方法形状一致。 */
export interface DshLogger {
  info(...args: readonly unknown[]): void
  warn(...args: readonly unknown[]): void
  error(...args: readonly unknown[]): void
}

/** 插件拿到的宿主上下文。 */
export interface DshContext {
  logger(name?: string): DshLogger
  get(name: string): unknown
  inject(deps: readonly string[], callback: (scope: DshContext) => void): unknown
  effect(setup: () => () => void, label?: string): unknown
}

/** 收集模式的一路输出。 */
export interface CollectedOutputLike {
  readFrom(offset: number): { readonly text: string }
}

/** 子进程句柄。 */
export interface SubprocessHandleLike {
  readonly collected: {
    readonly stdout?: CollectedOutputLike
    readonly stderr?: CollectedOutputLike
  }
  readonly done: Promise<{ readonly exitCode: number | null }>
}

/** 子进程启动请求。 */
export interface SubprocessSpawnSpecLike {
  readonly argv: readonly string[]
  readonly cwd: string
  readonly stdio: {
    readonly stdin: 'ignore'
    readonly stdout: { readonly maxBytes: number }
    readonly stderr: { readonly maxBytes: number }
  }
  readonly graceMs: number
  readonly signal?: AbortSignal
}

/** DSH 子进程服务。 */
export interface SubprocessLike {
  resolveExecutable(command: string): Promise<string>
  spawn(spec: SubprocessSpawnSpecLike): SubprocessHandleLike
}

/** `connection.fetch.register` 接收的路由。 */
export interface ConnectionRouteLike {
  readonly path: string
  readonly methods: readonly string[]
  readonly requestBody: 'buffered'
  readonly fetch: (request: Request) => Promise<Response>
}

/** `connection` 服务里插件用到的部分。 */
export interface ConnectionLike {
  readonly fetch: {
    register(route: ConnectionRouteLike): () => Promise<void>
  }
}

/** `timer` 服务里插件用到的部分。 */
export interface TimerLike {
  timeout(callback: () => void, delay: number): () => void
}

/** `skills` 服务里插件用到的部分：当前工作区的技能清单。 */
export interface SkillsLike {
  list(options?: {
    readonly cwd?: string | undefined
  }): Promise<readonly { readonly name: string }[]>
}

/** 插件内嵌技能：注册后由 DSH 在内存里提供，不写用户的技能目录。 */
export interface SkillRegistrationLike {
  readonly name: string
  readonly description: string
  /** 技能正文；用户消息里的手势命中时作为 instructions 注入这一轮。 */
  readonly content: string
  /** 技能来源；运行时注册的技能用 `runtime`，加载时 DSH 会校验。 */
  readonly source: string
  /** 调用策略；省略时模型和用户都能调用。 */
  readonly invocation?:
    | {
        readonly modelInvocable: boolean
        readonly userInvocable: boolean
      }
    | undefined
}

/** `skills` 服务里插件用到的注册部分。 */
export interface SkillRegistryLike extends SkillsLike {
  register(skill: SkillRegistrationLike): () => void
}

/**
 * 收窄 `subprocess` 服务。
 * @param value - `ctx.get('subprocess')` 的返回值。
 * @returns 服务可用时返回声明，否则 undefined。
 */
export function readSubprocess(value: unknown): SubprocessLike | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.resolveExecutable !== 'function') return undefined
  if (typeof value.spawn !== 'function') return undefined
  return value as unknown as SubprocessLike
}

/**
 * 收窄 `connection` 服务。
 * @param value - `ctx.get('connection')` 的返回值。
 * @returns 服务可用且带 fetch 注册表时返回声明，否则 undefined。
 */
export function readConnection(value: unknown): ConnectionLike | undefined {
  if (!isRecord(value)) return undefined
  const fetch = value.fetch
  if (!isRecord(fetch)) return undefined
  if (typeof fetch.register !== 'function') return undefined
  return value as unknown as ConnectionLike
}

/**
 * 收窄 `timer` 服务。
 * @param value - `ctx.get('timer')` 的返回值。
 * @returns 服务可用时返回声明，否则 undefined。
 */
export function readTimer(value: unknown): TimerLike | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.timeout !== 'function') return undefined
  return value as unknown as TimerLike
}

/**
 * 收窄 `skills` 服务。
 * @param value - `ctx.get('skills')` 的返回值。
 * @returns 服务可用时返回声明，否则 undefined。
 */
export function readSkills(value: unknown): SkillsLike | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.list !== 'function') return undefined
  return value as unknown as SkillsLike
}

/**
 * 收窄 `skills` 服务的注册能力。
 * @param value - `ctx.get('skills')` 的返回值。
 * @returns 服务可用且能注册内嵌技能时返回声明，否则 undefined。
 */
export function readSkillRegistry(value: unknown): SkillRegistryLike | undefined {
  const skills = readSkills(value)
  if (skills === undefined) return undefined
  if (!isRecord(value)) return undefined
  if (typeof value.register !== 'function') return undefined
  return value as unknown as SkillRegistryLike
}
