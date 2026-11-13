import { describe, expect, it } from 'vitest'

import { PANEL_SKILLS, REQUIRED_SKILLS } from '../protocol/env-check.ts'
import { TrackerError } from '../core/tracker-error.ts'
import {
  CATALOG,
  HOME,
  ROOT,
  fakeFiles,
  fakeProbe,
  harness,
  item,
  report,
} from './env-check-test-support.ts'

describe('环境检查的解决', () => {
  it('CLI 未安装时不再探测登录与仓库，并标为跳过', async () => {
    const github = fakeProbe('github', {
      cli: { status: 'fail', detail: '未找到 gh', reason: 'cli-missing' },
    })
    const { service } = harness({ github, skills: CATALOG })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(item(result.items, 'cli', 'github')).toMatchObject({
      status: 'fail',
      remedy: { code: 'install-cli', subject: 'github' },
    })
    expect(item(result.items, 'auth', 'github')).toMatchObject({
      status: 'skipped',
      remedy: null,
      blockedBy: { id: 'cli', subject: 'github' },
    })
    expect(github.calls).toEqual(['cli'])
  })

  it('未登录时不再探测仓库可达', async () => {
    const github = fakeProbe('github', {
      auth: { status: 'fail', detail: '未登录', reason: 'cli-unauthenticated' },
    })
    const { service } = harness({ github, skills: CATALOG })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(item(result.items, 'repository', 'github')).toMatchObject({
      status: 'skipped',
      blockedBy: { id: 'auth', subject: 'github' },
    })
    expect(github.calls).toEqual(['cli', 'auth'])
  })

  it('仓库不存在、无权限与网络失败给出不同的解决', async () => {
    const missing = harness({
      github: fakeProbe('github', {
        repository: {
          status: 'fail',
          detail: '仓库不存在',
          reason: 'repository-not-found',
        },
      }),
      skills: CATALOG,
    })
    const forbidden = harness({
      github: fakeProbe('github', {
        repository: {
          status: 'fail',
          detail: '没有访问权限或仓库不存在',
          reason: 'repository-forbidden',
        },
      }),
      skills: CATALOG,
    })
    const network = harness({
      github: fakeProbe('github', {
        repository: { status: 'fail', detail: '网络不可达', reason: 'repository-network' },
      }),
      skills: CATALOG,
    })

    const forbiddenReport = report(
      await forbidden.service.handle('env.check', { workspaceRoot: ROOT }),
    )
    const networkReport = report(await network.service.handle('env.check', { workspaceRoot: ROOT }))

    const missingReport = report(await missing.service.handle('env.check', { workspaceRoot: ROOT }))
    expect(item(missingReport.items, 'repository', 'github').remedy).toEqual({
      code: 'check-remote-address',
      subject: null,
    })
    expect(item(forbiddenReport.items, 'repository', 'github').remedy).toEqual({
      code: 'check-repository-access',
      subject: null,
    })
    expect(item(networkReport.items, 'repository', 'github').remedy).toEqual({
      code: 'check-network',
      subject: null,
    })
  })

  it('探测自身抛错时给出重试，而不是指向网络', async () => {
    const broken = fakeProbe('github', {})
    const throwing = {
      ...broken,
      cli: () => Promise.reject(new Error('探测实现坏了')),
    }
    const { service } = harness({ github: throwing, skills: CATALOG })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(item(result.items, 'cli', 'github')).toMatchObject({
      status: 'fail',
      remedy: { code: 'retry', subject: null },
    })
  })

  it('后端判定失败时三项后端相关检查全部跳过，并点名缺工具的后端', async () => {
    const github = fakeProbe('github', {})
    const gitlab = fakeProbe('gitlab', {})
    const { service, logs } = harness({
      resolveError: new TrackerError('glab-missing', '未找到 glab'),
      skills: CATALOG,
      github,
      gitlab,
    })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(result.backend).toBeNull()
    expect(item(result.items, 'backend', 'gitlab')).toMatchObject({
      status: 'fail',
      remedy: { code: 'install-cli', subject: 'gitlab' },
    })
    for (const id of ['cli', 'auth', 'repository']) {
      expect(item(result.items, id, 'gitlab')).toMatchObject({
        status: 'skipped',
        blockedBy: { id: 'backend', subject: 'gitlab' },
      })
    }
    expect(github.calls).toEqual([])
    expect(gitlab.calls).toEqual([])
    expect(logs.at(0)?.fields.backend).toBeNull()
  })

  it('工作区未初始化时给出初始化工作区的会话动作', async () => {
    const { service } = harness({
      skills: CATALOG,
      files: fakeFiles({ home: HOME, files: [] }),
    })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(item(result.items, 'workspace', null)).toMatchObject({
      status: 'fail',
      remedy: { code: 'init-workspace', subject: null },
    })
  })

  it('初始化技能本身缺失时，工作区的解决先指向安装该技能', async () => {
    const others = REQUIRED_SKILLS.filter((name) => name !== PANEL_SKILLS.setup)
    const files = fakeFiles({
      home: HOME,
      files: others.map((name) => `${HOME}/.agents/skills/${name}/SKILL.md`),
    })
    const { service } = harness({ skills: { names: () => Promise.resolve([]) }, files })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(item(result.items, 'workspace', null).status).toBe('fail')
    expect(item(result.items, 'workspace', null).remedy).toEqual({
      code: 'install-skill',
      subject: PANEL_SKILLS.setup,
    })
    expect(item(result.items, 'skill', PANEL_SKILLS.setup).remedy).toEqual({
      code: 'install-skill',
      subject: PANEL_SKILLS.setup,
    })
  })

  it('报告带后端判定出的仓库标识，本地 Markdown 与判定失败为 null', async () => {
    const github = harness({ skills: CATALOG })
    const markdown = harness({ kind: 'markdown', source: 'no-remote', skills: CATALOG })
    const failed = harness({
      skills: CATALOG,
      resolveError: new TrackerError('fetch-failed', '远端不可读'),
    })

    expect(
      report(await github.service.handle('env.check', { workspaceRoot: ROOT })).repository,
    ).toBe('owner/repo')
    expect(
      report(await markdown.service.handle('env.check', { workspaceRoot: ROOT })).repository,
    ).toBeNull()
    expect(
      report(await failed.service.handle('env.check', { workspaceRoot: ROOT })).repository,
    ).toBeNull()
  })

  it('两处都没有的技能失败并给出安装该技能的解决', async () => {
    const { service } = harness({
      skills: { names: () => Promise.resolve([]) },
      files: fakeFiles({ home: HOME, files: ['/workspace/docs/agents/issue-tracker.md'] }),
    })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(item(result.items, 'skill', 'to-spec')).toMatchObject({
      status: 'fail',
      remedy: { code: 'install-skill', subject: 'to-spec' },
    })
  })

  it('主目录不可解析时技能检查跳过', async () => {
    const { service } = harness({
      skills: CATALOG,
      files: fakeFiles({ home: undefined, files: ['/workspace/docs/agents/issue-tracker.md'] }),
    })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(item(result.items, 'home', null)).toMatchObject({
      status: 'fail',
      remedy: { code: 'check-home', subject: null },
    })
    expect(item(result.items, 'skill', 'to-spec')).toMatchObject({
      status: 'skipped',
      blockedBy: { id: 'home', subject: null },
    })
  })

  it('探测超时按失败处理', async () => {
    const { service } = harness({
      skills: CATALOG,
      deadline: () => Promise.resolve({ ok: false }),
    })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(item(result.items, 'backend', null)).toMatchObject({
      status: 'fail',
      remedy: { code: 'retry', subject: null },
    })
    expect(item(result.items, 'cli', null)).toMatchObject({ status: 'skipped', remedy: null })
  })
})
