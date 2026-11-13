import { describe, expect, it } from 'vitest'

import { chooseBackend, parseLoggedInHosts, parseTeaLoginHosts } from './backend.ts'

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

  it('自建主机出现在 tea 已登录列表里时走 Gitea', () => {
    expect(
      chooseBackend(
        { host: 'gitea.example.com', path: 'owner/repo' },
        [],
        ['gitea.example.com'],
      ),
    ).toEqual({ kind: 'gitea', source: 'tea-auth' })
  })

  it('同一个主机同时出现在 glab 与 tea 登录列表里时以 GitLab 为准', () => {
    expect(
      chooseBackend({ host: 'example.com', path: 'owner/repo' }, ['example.com'], ['example.com']),
    ).toEqual({ kind: 'gitlab', source: 'glab-auth' })
  })

  it('tea 已登录的主机也要忽略端口与大小写', () => {
    expect(
      chooseBackend(
        { host: 'Gitea.Example.COM:3000', path: 'owner/repo' },
        [],
        ['gitea.example.com'],
      ),
    ).toEqual({ kind: 'gitea', source: 'tea-auth' })
  })

  it('两个登录列表都不匹配时回退本地 Markdown', () => {
    expect(
      chooseBackend(
        { host: 'gitea.example.com', path: 'owner/repo' },
        ['gitlab.example.com'],
        ['other.example.com'],
      ),
    ).toEqual({ kind: 'markdown', source: 'unsupported-remote' })
  })
})

describe('登录状态解析', () => {
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

describe('tea 登录状态解析', () => {
  it('从 logins list 的 JSON 里收集实例主机并去重', () => {
    const output = JSON.stringify([
      {
        name: 'gitea',
        url: 'https://gitea.example.com',
        ssh_host: 'gitea.example.com',
        user: 'someone',
        default: true,
      },
      {
        name: 'work',
        url: 'https://Git.Example.COM:3000/',
        ssh_host: '',
        user: 'dev',
        default: false,
      },
      {
        name: 'same',
        url: 'https://gitea.example.com/',
        ssh_host: 'gitea.example.com',
        user: 'other',
        default: false,
      },
    ])

    expect(parseTeaLoginHosts(output)).toEqual(['gitea.example.com', 'git.example.com'])
  })

  it('URL 缺失时退回 SSH 主机', () => {
    const output = JSON.stringify([
      { name: 'a', url: '', ssh_host: 'git.internal:2222', user: 'dev', default: true },
    ])

    expect(parseTeaLoginHosts(output)).toEqual(['git.internal'])
  })

  it('跳过没有可用主机的条目，非法 JSON 返回空列表', () => {
    expect(
      parseTeaLoginHosts(JSON.stringify([{ name: 'a', url: '', ssh_host: '', user: 'dev' }])),
    ).toEqual([])
    expect(parseTeaLoginHosts('no logins')).toEqual([])
    expect(parseTeaLoginHosts('{"not":"an array"}')).toEqual([])
  })
})
