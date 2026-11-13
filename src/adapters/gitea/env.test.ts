import { describe, expect, it } from 'vitest'

import type { CommandOutput, CommandRunner } from '../../core/ticket.ts'
import { CommandError } from '../../core/tracker-error.ts'
import { GITEA_LOGINS_OUTPUT, failedApiCall, includeHeaders } from './fixtures.ts'
import { createGiteaEnvProbe } from './env.ts'

const ROOT = '/repo'
const REMOTE = { host: 'gitea.example.com', path: 'cnzgray/dsh-workflow' }

interface RunnerOptions {
  readonly cli?: () => CommandOutput
  readonly logins?: () => CommandOutput
  readonly api?: () => CommandOutput
}

function runner(options: RunnerOptions = {}): CommandRunner {
  return (command, args) => {
    if (command === 'tea' && args[0] === '--version') {
      return Promise.resolve(options.cli?.() ?? { stdout: 'tea version 0.16.0', stderr: '' })
    }
    if (command === 'tea' && args[0] === 'logins') {
      return Promise.resolve(options.logins?.() ?? { stdout: GITEA_LOGINS_OUTPUT, stderr: '' })
    }
    return Promise.resolve(
      options.api?.() ?? {
        stdout: JSON.stringify({ id: 1, full_name: REMOTE.path }),
        stderr: includeHeaders({}),
      },
    )
  }
}

function probe(options: RunnerOptions = {}) {
  return createGiteaEnvProbe({ run: runner(options) })
}

const NOT_FOUND = (): never => {
  throw new CommandError('not-found', '找不到 tea')
}

describe('Gitea 环境探测', () => {
  it('已安装时依据写找到的可执行文件路径', async () => {
    const result = await probe({
      cli: () => ({ stdout: '', stderr: '', executable: '/opt/homebrew/bin/tea' }),
    }).cli(ROOT)

    expect(result).toEqual({ status: 'pass', detail: '/opt/homebrew/bin/tea' })
  })

  it('版本命令失败但可执行文件存在时仍算已安装', async () => {
    const result = await probe({
      cli: () => {
        throw new CommandError('failed', 'tea 退出码 1', 'unknown flag', 1)
      },
    }).cli(ROOT)

    expect(result).toEqual({ status: 'pass', detail: 'tea' })
  })

  it('找不到 tea 时判定为未安装', async () => {
    const result = await probe({ cli: NOT_FOUND }).cli(ROOT)

    expect(result).toMatchObject({ status: 'fail', reason: 'cli-missing' })
  })

  it('远端主机在登录列表里时通过并写明主机', async () => {
    const result = await probe().auth(ROOT, REMOTE)

    expect(result).toEqual({ status: 'pass', detail: '已登录 gitea.example.com' })
  })

  it('登录列表只有其他实例时失败并点名当前主机', async () => {
    const result = await probe({
      logins: () => ({
        stdout: JSON.stringify([{ name: 'other', url: 'https://other.example.com' }]),
        stderr: '',
      }),
    }).auth(ROOT, REMOTE)

    expect(result).toEqual({
      status: 'fail',
      detail: '未登录 gitea.example.com',
      reason: 'cli-unauthenticated',
    })
  })

  it('找不到 tea 时登录检查归为未安装', async () => {
    const result = await probe({ logins: NOT_FOUND }).auth(ROOT, REMOTE)

    expect(result).toMatchObject({ status: 'fail', reason: 'cli-missing' })
  })

  it('没有远端时按未登录处理', async () => {
    const result = await probe().auth(ROOT, undefined)

    expect(result).toMatchObject({ status: 'fail', reason: 'cli-unauthenticated' })
  })

  it('仓库接口 2xx 时通过并写明 owner/repo', async () => {
    const result = await probe().repository(ROOT, REMOTE)

    expect(result).toEqual({ status: 'pass', detail: '可访问 cnzgray/dsh-workflow' })
  })

  it('404 归为仓库不存在', async () => {
    const result = await probe({
      api: () => failedApiCall(404, 'not found'),
    }).repository(ROOT, REMOTE)

    expect(result).toMatchObject({ status: 'fail', reason: 'repository-not-found' })
  })

  it('403 归为无访问权限', async () => {
    const result = await probe({
      api: () => failedApiCall(403, 'forbidden'),
    }).repository(ROOT, REMOTE)

    expect(result).toMatchObject({ status: 'fail', reason: 'repository-forbidden' })
  })

  it('401 归为令牌失效，提示重新登录', async () => {
    const result = await probe({
      api: () => failedApiCall(401, 'token expired'),
    }).repository(ROOT, REMOTE)

    expect(result).toMatchObject({ status: 'fail', reason: 'cli-unauthenticated' })
  })

  it('网络不通时归为网络不可达', async () => {
    const result = await probe({
      api: () => {
        throw new CommandError('failed', 'tea 退出码 1', 'dial tcp: connection refused', 1)
      },
    }).repository(ROOT, REMOTE)

    expect(result).toMatchObject({ status: 'fail', reason: 'repository-network' })
  })

  it('找不到 tea 时仓库检查归为未安装', async () => {
    const result = await probe({ api: NOT_FOUND }).repository(ROOT, REMOTE)

    expect(result).toMatchObject({ status: 'fail', reason: 'cli-missing' })
  })

  it('远端不是两段时按仓库不可访问处理', async () => {
    const result = await probe().repository(ROOT, {
      host: 'gitea.example.com',
      path: 'group/sub/repo',
    })

    expect(result).toMatchObject({ status: 'fail', reason: 'repository-forbidden' })
    expect(result.status === 'fail' ? result.detail : '').toContain('owner/repo')
  })

  it('依据里不出现命令原始输出中的令牌', async () => {
    const SECRET = 'SECRET-TOKEN'
    const result = await probe({
      api: () => ({
        stdout: '',
        stderr: `${includeHeaders({ status: 500 })}Authorization: token ${SECRET}\n`,
      }),
    }).repository(ROOT, REMOTE)

    expect(JSON.stringify(result)).not.toContain(SECRET)
  })
})
