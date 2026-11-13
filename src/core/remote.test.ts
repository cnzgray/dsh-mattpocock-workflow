import { describe, expect, it } from 'vitest'

import {
  parseRemotes,
  parseRemoteUrl,
  pickRemote,
  pickRemoteAddress,
  repositorySlug,
  type RemoteEntry,
} from './remote.ts'

describe('git 远端解析', () => {
  it('同一个远端的 fetch 与 push 只保留一条', () => {
    const remotes = parseRemotes(
      [
        'origin\tgit@github.com:cnzgray/dsh-mattpocock-workflow.git (fetch)',
        'origin\tgit@github.com:cnzgray/dsh-mattpocock-workflow.git (push)',
        '',
      ].join('\n'),
    )

    expect(remotes).toEqual([
      { name: 'origin', url: 'git@github.com:cnzgray/dsh-mattpocock-workflow.git' },
    ])
  })

  it('忽略不符合 git remote 格式的行', () => {
    expect(parseRemotes('hello world\n')).toEqual([])
  })
})

describe('远端 URL 解析', () => {
  it.each([
    ['git@gitlab.com:group/sub/project.git', 'gitlab.com', 'group/sub/project'],
    ['ssh://git@gitlab.example.com:2222/group/project.git', 'gitlab.example.com', 'group/project'],
    [
      'https://github.com/cnzgray/dsh-mattpocock-workflow.git',
      'github.com',
      'cnzgray/dsh-mattpocock-workflow',
    ],
    ['https://user@github.com/cnzgray/repo', 'github.com', 'cnzgray/repo'],
    ['http://github.com/cnzgray/repo/', 'github.com', 'cnzgray/repo'],
    ['git://gitlab.com/group/deep/project', 'gitlab.com', 'group/deep/project'],
  ])('把 %s 拆成主机与路径', (url, host, path) => {
    expect(parseRemoteUrl(url)).toEqual({ host, path })
  })

  it('主机名不区分大小写，比较时忽略端口', () => {
    expect(parseRemoteUrl('https://GitLab.COM:8443/group/project.git')).toEqual({
      host: 'gitlab.com',
      path: 'group/project',
    })
  })

  it('拒绝无法识别的地址', () => {
    expect(parseRemoteUrl('ftp://example.com/group/project')).toBeUndefined()
    expect(parseRemoteUrl('/local/path/repo.git')).toBeUndefined()
    expect(parseRemoteUrl('https://github.com/only-owner')).toEqual({
      host: 'github.com',
      path: 'only-owner',
    })
  })
})

describe('远端选择', () => {
  const remotes: readonly RemoteEntry[] = [
    { name: 'upstream', url: 'git@github.com:someone/other.git' },
    { name: 'origin', url: 'git@github.com:cnzgray/dsh-mattpocock-workflow.git' },
  ]

  it('优先 origin，即使它排在后面', () => {
    expect(pickRemote(remotes)?.name).toBe('origin')
  })

  it('没有 origin 时取第一个远端', () => {
    expect(pickRemote(remotes.slice(0, 1))?.name).toBe('upstream')
  })

  it('没有远端时返回 undefined', () => {
    expect(pickRemote([])).toBeUndefined()
    expect(pickRemoteAddress([])).toBeUndefined()
  })

  it('origin 无法解析时不回退到其他远端', () => {
    expect(
      pickRemoteAddress([
        { name: 'origin', url: '/local/path/repo.git' },
        { name: 'upstream', url: 'git@github.com:someone/other.git' },
      ]),
    ).toBeUndefined()
  })
})

describe('仓库路径收窄', () => {
  it('两段路径拼成 owner/name', () => {
    expect(repositorySlug({ host: 'github.com', path: 'owner/repo' })).toBe('owner/repo')
    expect(repositorySlug({ host: 'gitea.example.com', path: 'cnzgray/dsh-workflow' })).toBe(
      'cnzgray/dsh-workflow',
    )
  })

  it('嵌套路径与非法片段返回 undefined', () => {
    expect(repositorySlug({ host: 'gitea.example.com', path: 'group/sub/repo' })).toBeUndefined()
    expect(repositorySlug({ host: 'gitea.example.com', path: 'owner' })).toBeUndefined()
    expect(repositorySlug({ host: 'gitea.example.com', path: 'owner/re po' })).toBeUndefined()
    expect(repositorySlug(undefined)).toBeUndefined()
  })
})
