import { describe, expect, it } from 'vitest'

import {
  parseGithubRepository,
  parseRemotes,
  pickGithubRepository,
  repositoryLabel,
} from './remotes.ts'

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

describe('GitHub 仓库地址解析', () => {
  it.each([
    ['git@github.com:cnzgray/dsh-mattpocock-workflow.git', 'cnzgray/dsh-mattpocock-workflow'],
    ['ssh://git@github.com/cnzgray/dsh-mattpocock-workflow.git', 'cnzgray/dsh-mattpocock-workflow'],
    ['https://github.com/cnzgray/dsh-mattpocock-workflow.git', 'cnzgray/dsh-mattpocock-workflow'],
    ['https://github.com/cnzgray/dsh-mattpocock-workflow', 'cnzgray/dsh-mattpocock-workflow'],
    ['https://github.com/cnzgray/dsh-mattpocock-workflow/', 'cnzgray/dsh-mattpocock-workflow'],
  ])('识别 %s', (url, expected) => {
    const repository = parseGithubRepository(url)

    expect(repository).toEqual({ owner: expected.split('/')[0], name: expected.split('/')[1] })
  })

  it('拒绝非 github.com 的远端', () => {
    expect(
      parseGithubRepository('git@gitlab.com:cnzgray/dsh-mattpocock-workflow.git'),
    ).toBeUndefined()
    expect(parseGithubRepository('git@github.example.com:cnzgray/repo.git')).toBeUndefined()
  })

  it('拒绝缺少 owner 或 name 的地址', () => {
    expect(parseGithubRepository('https://github.com/only-owner')).toBeUndefined()
    expect(parseGithubRepository('https://github.com/a/b/c')).toBeUndefined()
  })
})

describe('仓库选择', () => {
  it('origin 是 GitHub 时优先用 origin', () => {
    const repository = pickGithubRepository([
      { name: 'upstream', url: 'git@github.com:someone/other.git' },
      { name: 'origin', url: 'git@github.com:cnzgray/dsh-mattpocock-workflow.git' },
    ])

    expect(repository === undefined ? undefined : repositoryLabel(repository)).toBe(
      'cnzgray/dsh-mattpocock-workflow',
    )
  })

  it('origin 不是 GitHub 时按顺序取第一个 GitHub 远端', () => {
    const repository = pickGithubRepository([
      { name: 'origin', url: 'git@gitlab.com:cnzgray/dsh-mattpocock-workflow.git' },
      { name: 'upstream', url: 'https://github.com/cnzgray/dsh-mattpocock-workflow.git' },
    ])

    expect(repository === undefined ? undefined : repositoryLabel(repository)).toBe(
      'cnzgray/dsh-mattpocock-workflow',
    )
  })

  it('没有 GitHub 远端时返回 undefined', () => {
    expect(pickGithubRepository([])).toBeUndefined()
  })
})
