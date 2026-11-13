import { describe, expect, it } from 'vitest'

import { CommandError } from '../core/tracker-error.ts'
import type { SubprocessLike, SubprocessSpawnSpecLike, TimerLike } from './dsh-types.ts'
import { createCommandRunner } from './subprocess-runner.ts'

interface FakeOptions {
  readonly resolve?: (command: string) => string | undefined
  readonly exitCode?: number | null
  readonly stdout?: string
  readonly stderr?: string
}

function fakeSubprocess(options: FakeOptions): {
  readonly subprocess: SubprocessLike
  readonly lookups: string[]
  readonly specs: SubprocessSpawnSpecLike[]
} {
  const lookups: string[] = []
  const specs: SubprocessSpawnSpecLike[] = []
  const subprocess: SubprocessLike = {
    resolveExecutable(command) {
      lookups.push(command)
      const resolved = options.resolve?.(command)
      return resolved === undefined
        ? Promise.reject(new Error(`not found: ${command}`))
        : Promise.resolve(resolved)
    },
    spawn(spec) {
      specs.push(spec)
      return {
        collected: {
          stdout: { readFrom: () => ({ text: options.stdout ?? '' }) },
          stderr: { readFrom: () => ({ text: options.stderr ?? '' }) },
        },
        done: Promise.resolve({ exitCode: options.exitCode ?? 0 }),
      }
    },
  }
  return { subprocess, lookups, specs }
}

function fakeTimer(): {
  readonly timer: TimerLike
  readonly disposed: boolean[]
  readonly delays: number[]
} {
  const disposed: boolean[] = []
  const delays: number[] = []
  const timer: TimerLike = {
    timeout(callback, delay) {
      delays.push(delay)
      if (typeof callback !== 'function') throw new Error('缺少超时回调')
      disposed.push(false)
      const index = disposed.length - 1
      return () => {
        disposed[index] = true
      }
    },
  }
  return { timer, disposed, delays }
}

describe('命令执行器', () => {
  it('PATH 找不到 gh 时回退到 Homebrew 的绝对路径', async () => {
    const { subprocess, lookups, specs } = fakeSubprocess({
      resolve: (command) => (command === '/opt/homebrew/bin/gh' ? command : undefined),
      stdout: 'ok',
    })
    const { timer, delays } = fakeTimer()
    const run = createCommandRunner(subprocess, timer)

    await expect(run('gh', ['api', 'graphql'], { cwd: '/repo' })).resolves.toEqual({
      stdout: 'ok',
      stderr: '',
      executable: '/opt/homebrew/bin/gh',
    })
    expect(lookups).toEqual(['gh', '/opt/homebrew/bin/gh'])
    expect(specs[0]?.argv).toEqual(['/opt/homebrew/bin/gh', 'api', 'graphql'])
    expect(specs[0]?.cwd).toBe('/repo')
    expect(delays).toEqual([30_000])
  })

  it('PATH 找不到 glab 时回退到 Homebrew 的绝对路径', async () => {
    const { subprocess, lookups, specs } = fakeSubprocess({
      resolve: (command) => (command === '/opt/homebrew/bin/glab' ? command : undefined),
      stdout: 'ok',
    })
    const { timer } = fakeTimer()
    const run = createCommandRunner(subprocess, timer)

    await expect(run('glab', ['auth', 'status'], { cwd: '/repo' })).resolves.toEqual({
      stdout: 'ok',
      stderr: '',
      executable: '/opt/homebrew/bin/glab',
    })
    expect(lookups).toEqual(['glab', '/opt/homebrew/bin/glab'])
    expect(specs[0]?.argv).toEqual(['/opt/homebrew/bin/glab', 'auth', 'status'])
  })

  it('PATH 找不到 tea 时回退到 Homebrew 的绝对路径', async () => {
    const { subprocess, lookups, specs } = fakeSubprocess({
      resolve: (command) => (command === '/opt/homebrew/bin/tea' ? command : undefined),
      stdout: '[]',
    })
    const { timer } = fakeTimer()
    const run = createCommandRunner(subprocess, timer)

    await expect(
      run('tea', ['logins', 'list', '--output', 'json'], { cwd: '/repo' }),
    ).resolves.toEqual({
      stdout: '[]',
      stderr: '',
      executable: '/opt/homebrew/bin/tea',
    })
    expect(lookups).toEqual(['tea', '/opt/homebrew/bin/tea'])
    expect(specs[0]?.argv).toEqual(['/opt/homebrew/bin/tea', 'logins', 'list', '--output', 'json'])
  })

  it('子进程关闭 glab 的遥测上报与更新检查', async () => {
    const { subprocess, specs } = fakeSubprocess({ resolve: (command) => command, stdout: 'ok' })
    const { timer } = fakeTimer()
    const run = createCommandRunner(subprocess, timer)

    await run('glab', ['api', 'projects/1/issues'], { cwd: '/repo' })

    expect(specs[0]?.env).toMatchObject({
      GLAB_SEND_TELEMETRY: 'false',
      GLAB_CHECK_UPDATE: 'false',
    })
  })

  it('命令非零退出时抛带标准错误的 CommandError', async () => {
    const { subprocess } = fakeSubprocess({
      resolve: () => '/usr/bin/gh',
      exitCode: 1,
      stderr: 'gh auth login',
    })
    const { timer } = fakeTimer()
    const run = createCommandRunner(subprocess, timer)

    await expect(run('gh', ['api'], { cwd: '/repo' })).rejects.toMatchObject({
      kind: 'failed',
      stderr: 'gh auth login',
      exitCode: 1,
    })
  })

  it('所有候选都找不到时抛 not-found', async () => {
    const { subprocess, lookups } = fakeSubprocess({})
    const { timer } = fakeTimer()
    const run = createCommandRunner(subprocess, timer)

    await expect(run('gh', [], { cwd: '/repo' })).rejects.toBeInstanceOf(CommandError)
    expect(lookups).toEqual(['gh', '/opt/homebrew/bin/gh', '/usr/local/bin/gh'])
  })

  it('成功时同时返回标准输出与标准错误', async () => {
    const { subprocess } = fakeSubprocess({
      resolve: () => '/usr/bin/glab',
      stdout: '',
      stderr: '✓ Logged in to gitlab.example.com',
    })
    const { timer } = fakeTimer()
    const run = createCommandRunner(subprocess, timer)

    await expect(run('glab', ['auth', 'status'], { cwd: '/repo' })).resolves.toEqual({
      stdout: '',
      stderr: '✓ Logged in to gitlab.example.com',
      executable: '/usr/bin/glab',
    })
  })

  it('命令结束后释放超时计时器', async () => {
    const { subprocess } = fakeSubprocess({ resolve: () => '/usr/bin/gh', stdout: 'ok' })
    const { timer, disposed } = fakeTimer()
    const run = createCommandRunner(subprocess, timer)

    await run('gh', [], { cwd: '/repo' })

    expect(disposed).toEqual([true])
  })
})
