/**
 * 把 DSH 的 `subprocess` 服务包装成 core 的 {@link CommandRunner}。
 * 只做进程生命周期与输出收集，命令语义和错误码由 adapter 决定。
 */
import type { CommandRunner } from '../core/ticket.ts'
import { CommandError } from '../core/tracker-error.ts'
import type { SubprocessLike, TimerLike } from './dsh-types.ts'

/** 一次命令最多保留的输出；GraphQL 响应远小于此。 */
const STDOUT_LIMIT_BYTES = 8 * 1024 * 1024
/** 标准错误只用于诊断，留小一点。 */
const STDERR_LIMIT_BYTES = 256 * 1024
/** 远端命令的最长执行时间；超时后由子进程服务终止。 */
const COMMAND_TIMEOUT_MS = 30_000
/** 终止阶段留给子进程服务的时间。 */
const TERMINATION_GRACE_MS = 5_000
/**
 * 桌面端从 Finder 启动时 PATH 只有系统目录，Homebrew 安装的 gh 不在其中。
 * 先按 PATH 找，找不到再试常见的绝对路径；全部失败才算 gh-missing。
 */
const EXECUTABLE_FALLBACKS: Readonly<Record<string, readonly string[]>> = {
  gh: ['/opt/homebrew/bin/gh', '/usr/local/bin/gh'],
}

/**
 * 创建命令执行器。
 * @param subprocess - DSH 子进程服务。
 * @param timer - DSH 计时服务，用于命令超时。
 * @returns 满足 core `CommandRunner` 的函数。
 */
export function createCommandRunner(subprocess: SubprocessLike, timer: TimerLike): CommandRunner {
  return async (command, args, options) => {
    const executable = await resolveExecutable(subprocess, command)

    const abort = new AbortController()
    const disposeTimeout = timer.timeout(() => {
      abort.abort()
    }, COMMAND_TIMEOUT_MS)

    try {
      const handle = subprocess.spawn({
        argv: [executable, ...args],
        cwd: options?.cwd ?? process.cwd(),
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: STDOUT_LIMIT_BYTES },
          stderr: { maxBytes: STDERR_LIMIT_BYTES },
        },
        graceMs: TERMINATION_GRACE_MS,
        signal: abort.signal,
      })

      const outcome = await handle.done
      const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
      const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
      const exitCode = outcome.exitCode
      if (exitCode !== 0) {
        const label = exitCode === null ? '被信号终止' : `退出码 ${String(exitCode)}`
        throw new CommandError('failed', `${command} ${label}`, stderr, exitCode)
      }
      return stdout
    } finally {
      disposeTimeout()
    }
  }
}

async function resolveExecutable(subprocess: SubprocessLike, command: string): Promise<string> {
  for (const candidate of [command, ...(EXECUTABLE_FALLBACKS[command] ?? [])]) {
    try {
      return await subprocess.resolveExecutable(candidate)
    } catch {
      // 探测下一个候选；全部失败后统一报 not-found。
    }
  }
  throw new CommandError('not-found', `找不到可执行文件：${command}`, '', null)
}
