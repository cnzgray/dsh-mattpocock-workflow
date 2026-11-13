import { describe, expect, it } from 'vitest'

import { chooseBackend, parseLoggedInHosts } from './backend.ts'

describe('后端选择', () => {
  it('没有远端时走本地 Markdown', () => {
    expect(chooseBackend(undefined, ['gitlab.com'])).toEqual({
      kind: 'markdown',
      source: 'no-remote',
    })
  })

  it('github.com 走 GitHub，不受 glab 登录列表影响', () => {
    expect(chooseBackend({ host: 'github.com', path: 'owner/repo' }, ['github.com'])).toEqual({
      kind: 'github',
      source: 'remote',
    })
  })

  it('.gitlab.com 走 GitLab', () => {
    expect(chooseBackend({ host: 'gitlab.com', path: 'group/repo' }, [])).toEqual({
      kind: 'gitlab',
      source: 'remote',
    })
  })

  it('自建主机出现在 glab 已登录列表里时走 GitLab', () => {
    expect(
      chooseBackend({ host: 'gitlab.example.com', path: 'group/repo' }, ['gitlab.example.com']),
    ).toEqual({ kind: 'gitlab', source: 'glab-auth' })
  })

  it('自建主机没有登录时回退本地 Markdown', () => {
    expect(chooseBackend({ host: 'gitlab.example.com', path: 'group/repo' }, [])).toEqual({
      kind: 'markdown',
      source: 'unsupported-remote',
    })
  })

  it('主机比较不区分大小写并忽略端口', () => {
    expect(
      chooseBackend({ host: 'GitLab.Example.COM:8443', path: 'g/r' }, ['gitlab.example.com']),
    ).toEqual({ kind: 'gitlab', source: 'glab-auth' })
  })

  it('glab 已登录的任意主机都走 GitLab', () => {
    expect(chooseBackend({ host: 'example.com', path: 'group/repo' }, ['example.com'])).toEqual({
      kind: 'gitlab',
      source: 'glab-auth',
    })
  })
})

describe('glab 登录状态解析', () => {
  it('收集已登录主机并去重', () => {
    const output = [
      'gitlab.com',
      '  ✓ Logged in to gitlab.com as someone (keyring)',
      '  ✓ Git operations for gitlab.com configured to use ssh protocol.',
      'gitlab.example.com',
      '  ✓ Logged in to gitlab.example.com as someone (/config.yml)',
      'gitlab.com',
      '  ✓ Logged in to gitlab.com as someone (keyring)',
      '',
    ].join('\n')

    expect(parseLoggedInHosts(output)).toEqual(['gitlab.com', 'gitlab.example.com'])
  })

  it('识别不同版本的勾号并忽略失败行', () => {
    const output = [
      '✔ Logged in to gitlab.com as a',
      'X No token found for gitlab.example.com',
    ].join('\n')

    expect(parseLoggedInHosts(output)).toEqual(['gitlab.com'])
  })

  it('没有可识别的行时返回空列表', () => {
    expect(parseLoggedInHosts('')).toEqual([])
    expect(parseLoggedInHosts('glab: not logged in')).toEqual([])
  })
})
