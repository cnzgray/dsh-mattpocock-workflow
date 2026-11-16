import { describe, expect, it } from 'vitest'

import type { CommandOptions, CommandRunner } from '../../core/ticket.ts'
import { CommandError, TrackerError } from '../../core/tracker-error.ts'
import { ATTACHMENT_MAX_BYTES, readGitlabAttachment, uploadEndpointSegment } from './attachment.ts'
import { GITLAB_PROJECT_ENDPOINT } from './detail-fixtures.ts'
import { GITLAB_REMOTES_OUTPUT } from './fixtures.ts'

const SECRET = 'f0fbf025e4c7f2a49dbc24c93a22f055'
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).toString(
  'base64',
)

interface Call {
  readonly command: string
  readonly args: readonly string[]
  readonly options: CommandOptions | undefined
}

function glabReturning(respond: () => string): { run: CommandRunner; calls: Call[] } {
  const calls: Call[] = []
  const run: CommandRunner = (command, args, options) => {
    calls.push({ command, args, options })
    if (command === 'git') return Promise.resolve({ stdout: GITLAB_REMOTES_OUTPUT, stderr: '' })
    return Promise.resolve({ stdout: respond(), stderr: '' })
  }
  return { run, calls }
}

describe('GitLab 正文内联图片', () => {
  it('用已登录的 glab 按当前项目的 uploads 接口取回图片字节', async () => {
    const { run, calls } = glabReturning(() => PNG)

    const attachment = await readGitlabAttachment(
      { run },
      '/workspace',
      `/uploads/${SECRET}/%E5%B7%A5%E8%B5%84%20gzt-1.png`,
    )

    expect(attachment).toEqual({ mediaType: 'image/png', base64: PNG })
    expect(calls.at(-1)).toEqual({
      command: 'glab',
      args: ['api', `${GITLAB_PROJECT_ENDPOINT}/uploads/${SECRET}/%E5%B7%A5%E8%B5%84%20gzt-1.png`],
      options: { cwd: '/workspace', stdout: 'base64' },
    })
  })

  it.each([
    ['其他相对地址', '/assets/logo.png'],
    ['外链', 'https://example.com/a.png'],
    ['带主机的同实例地址', `https://gitlab.com/uploads/${SECRET}/a.png`],
    ['secret 不合法', '/uploads/not-a-secret/a.png'],
    ['多段路径', `/uploads/${SECRET}/a/b.png`],
    ['编码后越出目录', `/uploads/${SECRET}/..%2F..%2Fetc%2Fpasswd`],
    ['点点', `/uploads/${SECRET}/..`],
    ['带查询串', `/uploads/${SECRET}/a.png?x=1`],
  ])('%s不抓取', async (_name, path) => {
    const { run, calls } = glabReturning(() => PNG)

    await expect(readGitlabAttachment({ run }, '/workspace', path)).rejects.toBeInstanceOf(
      TrackerError,
    )
    expect(uploadEndpointSegment(path)).toBeUndefined()
    expect(calls).toEqual([])
  })

  it('响应不是图片时失败（例如被重定向到登录页）', async () => {
    const html = Buffer.from('<!DOCTYPE html><html>sign in</html>').toString('base64')
    const { run } = glabReturning(() => html)

    await expect(
      readGitlabAttachment({ run }, '/workspace', `/uploads/${SECRET}/a.png`),
    ).rejects.toMatchObject({ code: 'fetch-failed' })
  })

  it('空响应或损坏的 base64 时失败', async () => {
    for (const body of ['', 'not base64!']) {
      const { run } = glabReturning(() => body)
      await expect(
        readGitlabAttachment({ run }, '/workspace', `/uploads/${SECRET}/a.png`),
      ).rejects.toMatchObject({ code: 'fetch-failed' })
    }
  })

  it('超过大小上限时失败', async () => {
    const big = PNG + 'A'.repeat(Math.ceil((ATTACHMENT_MAX_BYTES * 4) / 3) + 4)
    const { run } = glabReturning(() => big)

    await expect(
      readGitlabAttachment({ run }, '/workspace', `/uploads/${SECRET}/a.png`),
    ).rejects.toMatchObject({ code: 'fetch-failed' })
  })

  it('404 / 未登录按 glab 的错误映射', async () => {
    const run: CommandRunner = (command) => {
      if (command === 'git') return Promise.resolve({ stdout: GITLAB_REMOTES_OUTPUT, stderr: '' })
      return Promise.reject(new CommandError('failed', 'glab 退出码 1', '404 Not Found', 1))
    }

    await expect(
      readGitlabAttachment({ run }, '/workspace', `/uploads/${SECRET}/a.png`),
    ).rejects.toMatchObject({ code: 'fetch-failed' })
  })

  it('识别 JPEG、GIF、WebP，拒绝 SVG', async () => {
    const cases: readonly [readonly number[], string | null][] = [
      [[0xff, 0xd8, 0xff, 0xe0], 'image/jpeg'],
      [[0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 'image/gif'],
      [[0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50], 'image/webp'],
      [[...Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">')], null],
    ]
    for (const [bytes, mediaType] of cases) {
      const { run } = glabReturning(() => Buffer.from(bytes).toString('base64'))
      const result = readGitlabAttachment({ run }, '/workspace', `/uploads/${SECRET}/a`)
      if (mediaType === null) {
        await expect(result).rejects.toMatchObject({ code: 'fetch-failed' })
      } else {
        await expect(result).resolves.toMatchObject({ mediaType })
      }
    }
  })
})
