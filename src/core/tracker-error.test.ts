import { describe, expect, it } from 'vitest'

import { CommandError, TrackerError } from './tracker-error.ts'

describe('工单错误', () => {
  it('保留错误码与用户可读消息', () => {
    const error = new TrackerError('gh-missing', '未找到 gh')

    expect(error.name).toBe('TrackerError')
    expect(error.code).toBe('gh-missing')
    expect(error.message).toBe('未找到 gh')
  })

  it('命令失败保留标准错误与退出码', () => {
    const error = new CommandError('failed', 'gh 退出码 1', 'not logged in', 1)

    expect(error.name).toBe('CommandError')
    expect(error.kind).toBe('failed')
    expect(error.stderr).toBe('not logged in')
    expect(error.exitCode).toBe(1)
  })

  it('找不到可执行文件时退出码为空', () => {
    const error = new CommandError('not-found', '找不到 gh')

    expect(error.stderr).toBe('')
    expect(error.exitCode).toBeNull()
  })
})
