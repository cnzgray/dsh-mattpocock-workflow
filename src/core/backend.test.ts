import { describe, expect, it } from 'vitest'

import { parseGlabAuthHosts, selectBackend } from './backend.ts'

describe('后端选择', () => {
  it('没有远端时走本地 Markdown', () => {
    expect(selectBackend(undefined, ['gitlab.com'])).toBe('markdown')
  })

  it('github.com 走 GitHub，不受 glab 登录列表影响', () => {
    expect(selectBackend({ host: 'github.com', path: 'owner/repo' }, ['github.com'])).toBe('github')
  })

  it('.gitlab.com 走 GitLab', () => {
    expect(selectBackend({ host: 'gitlab.com', path: 'group/repo' }, [])).toBe('gitlab')
  })

  it('自建主机出现在 glab 已登录列表里时走 GitLab', () => {
    expect(
      selectBackend({ host: 'gitlab.example.com', path: 'group/repo' }, ['gitlab.example.com']),
    ).toBe('gitlab')
  })

  it('自建主机没有登录时回退本地 Markdown', () => {
    expect(selectBackend({ host: 'gitlab.example.com', path: 'group/repo' }, [])).toBe('markdown')
  })

  it('主机比较不区分大小写并忽略端口', () => {
    expect(
      selectBackend({ host: 'GitLab.Example.COM:8443', path: 'g/r' }, ['gitlab.example.com']),
    ).toBe('gitlab')
  })

  it('glab 已登录的任意主机都走 GitLab', () => {
    expect(selectBackend({ host: 'example.com', path: 'group/repo' }, ['example.com'])).toBe(
      'gitlab',
    )
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

    expect(parseGlabAuthHosts(output)).toEqual(['gitlab.com', 'gitlab.example.com'])
  })

  it('识别不同版本的勾号并忽略失败行', () => {
    const output = [
      '✔ Logged in to gitlab.com as a',
      'X No token found for gitlab.example.com',
    ].join('\n')

    expect(parseGlabAuthHosts(output)).toEqual(['gitlab.com'])
  })

  it('没有可识别的行时返回空列表', () => {
    expect(parseGlabAuthHosts('')).toEqual([])
    expect(parseGlabAuthHosts('glab: not logged in')).toEqual([])
  })
})
