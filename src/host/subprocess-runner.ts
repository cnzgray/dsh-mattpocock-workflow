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
 * 桌面端从 Finder 启动时 PATH 只有系统目录，Homebrew 安装的 gh / glab / tea 不在其中。
 * 先按 PATH 找，找不到再试常见的绝对路径；全部失败才算 xxx-missing。
 */
const EXECUTABLE_FALLBACKS: Readonly<Record<string, readonly string[]>> = {
  gh: ['/opt/homebrew/bin/gh', '/usr/local/bin/gh'],
  glab: ['/opt/homebrew/bin/glab', '/usr/local/bin/glab'],
  tea: ['/opt/homebrew/bin/tea', '/usr/local/bin/tea'],
  sh: ['/bin/sh'],
}

/**
 * `base64` 输出模式的包装脚本：`"$@"` 原样执行目标命令（参数不经 shell 拼接），
 * 输出经 `base64` 转成文本。支持 pipefail 的 shell 让目标命令的失败透出到退出码；
 * 不支持时只能拿到空输出，由调用方按“不是有效响应”处理。
 */
const BASE64_PIPE_SCRIPT = '(set -o pipefail) 2>/dev/null && set -o pipefail; "$@" | base64'

/**
 * 面板在后台调用 CLI，不需要遥测上报与更新检查。`glab` 默认每次调用都同步
 * 上报遥测，实测每次多花 120–170 ms；首屏要串行调用好几次 `glab`。
 */
const QUIET_CLI_ENV: Readonly<Record<string, string>> = {
  GLAB_SEND_TELEMETRY: 'false',
  GLAB_CHECK_UPDATE: 'false',
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
    const base64 = options?.stdout === 'base64'
    const argv = base64
      ? [
          await resolveExecutable(subprocess, 'sh'),
          '-c',
          BASE64_PIPE_SCRIPT,
          'sh',
          executable,
          ...args,
        ]
      : [executable, ...args]

    const abort = new AbortController()
    const disposeTimeout = timer.timeout(() => {
      abort.abort()
    }, COMMAND_TIMEOUT_MS)

    try {
      const handle = subprocess.spawn({
        argv,
        cwd: options?.cwd ?? process.cwd(),
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: STDOUT_LIMIT_BYTES },
          stderr: { maxBytes: STDERR_LIMIT_BYTES },
        },
        graceMs: TERMINATION_GRACE_MS,
        signal: abort.signal,
        env: QUIET_CLI_ENV,
      })

      const outcome = await handle.done
      const text = handle.collected.stdout?.readFrom(0).text ?? ''
      // GNU base64 每 76 列换行，macOS 不换；统一去掉空白。
      const stdout = base64 ? text.replace(/\s+/g, '') : text
      const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
      const exitCode = outcome.exitCode
      if (exitCode !== 0) {
        const label = exitCode === null ? '被信号终止' : `退出码 ${String(exitCode)}`
        throw new CommandError('failed', `${command} ${label}`, stderr, exitCode)
      }
      return { stdout, stderr, executable }
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
