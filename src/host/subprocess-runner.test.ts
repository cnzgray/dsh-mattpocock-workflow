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

    await expect(run('gh', ['api', 'graphql'], { cwd: '/repo' })).resolves.toBe('ok')
    expect(lookups).toEqual(['gh', '/opt/homebrew/bin/gh'])
    expect(specs[0]?.argv).toEqual(['/opt/homebrew/bin/gh', 'api', 'graphql'])
    expect(specs[0]?.cwd).toBe('/repo')
    expect(delays).toEqual([30_000])
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

  it('命令结束后释放超时计时器', async () => {
    const { subprocess } = fakeSubprocess({ resolve: () => '/usr/bin/gh', stdout: 'ok' })
    const { timer, disposed } = fakeTimer()
    const run = createCommandRunner(subprocess, timer)

    await run('gh', [], { cwd: '/repo' })

    expect(disposed).toEqual([true])
  })
})
