import { describe, expect, it } from 'vitest'

import { createLocalIssuesProbe } from '../adapters/markdown/env.ts'
import type { WorkspaceFiles } from '../adapters/markdown/files.ts'
import { TrackerError } from '../core/tracker-error.ts'
import type { EnvRemedyCode } from '../protocol/env-check.ts'
import {
  FOUND_LOCAL_ISSUES,
  ROOT,
  CATALOG,
  harness,
  item,
  report,
} from './env-check-test-support.ts'

interface TreeSpec {
  readonly directories: Record<string, readonly string[]>
  readonly files: Record<string, string>
}

function memoryFiles(tree: TreeSpec): WorkspaceFiles {
  return {
    listDirectory: (path) => {
      const names = tree.directories[path]
      if (names === undefined) return Promise.resolve(undefined)
      return Promise.resolve(
        names.map((name) => ({
          name: name.replace(/\/$/, ''),
          kind: name.endsWith('/') ? ('directory' as const) : ('file' as const),
        })),
      )
    },
    readTextFile: (path) => {
      const content = tree.files[path]
      return content === undefined
        ? Promise.reject(new Error(`ENOENT: ${path}`))
        : Promise.resolve(content)
    },
    statFile: () => Promise.resolve({ createdAt: 0, updatedAt: 0 }),
  }
}

const SCRATCH = `${ROOT}/.scratch`
const LOGIN = `${SCRATCH}/login`
const ISSUES = `${LOGIN}/issues`

/** 本地 Markdown 后端的装配；只有该后端与后端未判定时才会探测本地工单目录。 */
const MARKDOWN = { kind: 'markdown', source: 'no-remote' } as const

describe('环境检查的本地工单目录', () => {
  it('真实文件扫描的四类结果在 RPC 接缝处映射成通过或放置解决', async () => {
    const cases: readonly [TreeSpec, string, EnvRemedyCode | null][] = [
      [{ directories: {}, files: {} }, 'fail', 'place-local-issues'],
      [{ directories: { [SCRATCH]: [] }, files: {} }, 'fail', 'place-local-issues'],
      [
        {
          directories: { [SCRATCH]: ['login/'], [LOGIN]: ['issues/'], [ISSUES]: [] },
          files: {},
        },
        'fail',
        'place-local-issues',
      ],
      [
        {
          directories: { [SCRATCH]: ['login/'], [LOGIN]: ['issues/'], [ISSUES]: ['01.md'] },
          files: { [`${ISSUES}/01.md`]: '# 工单\n\n状态: open\n' },
        },
        'fail',
        'place-local-issues',
      ],
      [
        {
          directories: { [SCRATCH]: ['login/'], [LOGIN]: ['issues/'], [ISSUES]: ['01.md'] },
          files: { [`${ISSUES}/01.md`]: '# 工单\n\nStatus: ready-for-agent\n' },
        },
        'pass',
        null,
      ],
    ]

    for (const [tree, status, code] of cases) {
      const { service } = harness({
        ...MARKDOWN,
        localIssues: createLocalIssuesProbe({ files: memoryFiles(tree) }),
      })

      const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))
      const entry = item(result.items, 'local-issues', null)
      expect(entry.status).toBe(status)
      expect(entry.remedy?.code ?? null).toBe(code)
    }
  })

  it.each([
    [
      '找到工单文件',
      { status: 'found', files: ['.scratch/login/issues/01-token.md'] } as const,
      'pass',
      null,
      '1 张本地工单',
    ],
    ['没有 .scratch', { status: 'no-scratch' } as const, 'fail', 'place-local-issues', '.scratch'],
    ['没有工单文件', { status: 'no-files' } as const, 'fail', 'place-local-issues', '.scratch'],
    [
      '工单缺状态行',
      { status: 'unparsable', files: ['.scratch/login/issues/02-broken.md'] } as const,
      'fail',
      'place-local-issues',
      'Status:',
    ],
  ])('本地工单目录：%s', async (_label, fact, status, code, detail) => {
    const { service } = harness({
      ...MARKDOWN,
      localIssues: () => Promise.resolve(fact),
    })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))
    const found = item(result.items, 'local-issues', null)

    expect(found.status).toBe(status)
    expect(found.remedy?.code ?? null).toBe(code)
    expect(found.detail).toContain(detail)
  })

  it('后端判定超时后仍检查本地工单目录，本地探测超时按失败处理', async () => {
    let localStarted = false
    const { service } = harness({
      deadline: () => Promise.resolve({ ok: false }),
      localIssues: () => {
        localStarted = true
        return Promise.resolve(FOUND_LOCAL_ISSUES)
      },
    })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(localStarted).toBe(true)
    expect(item(result.items, 'local-issues', null)).toMatchObject({ status: 'fail' })
    expect(item(result.items, 'local-issues', null).remedy).toEqual({
      code: 'retry',
      subject: null,
    })
  })

  it('读取失败时给出重试，而不是伪装成通过', async () => {
    const { service } = harness({
      ...MARKDOWN,
      localIssues: () => Promise.reject(new Error('permission denied')),
    })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(item(result.items, 'local-issues', null)).toMatchObject({ status: 'fail' })
    expect(item(result.items, 'local-issues', null).remedy).toEqual({
      code: 'retry',
      subject: null,
    })
  })

  it('托管后端下不探测本地工单目录，也不产出该项', async () => {
    for (const [kind, source] of [
      ['github', 'remote'],
      ['gitlab', 'glab-auth'],
      ['gitea', 'tea-auth'],
    ] as const) {
      let probed = false
      const { service } = harness({
        kind,
        source,
        skills: CATALOG,
        localIssues: () => {
          probed = true
          return Promise.resolve(FOUND_LOCAL_ISSUES)
        },
      })

      const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

      expect(probed).toBe(false)
      expect(result.items.some((entry) => entry.id === 'local-issues')).toBe(false)
    }
  })

  it('后端判定失败时仍探测本地工单目录，因为可能回退本地 Markdown', async () => {
    let probed = false
    const { service } = harness({
      resolveError: new TrackerError('fetch-failed', '读取 git 远端失败'),
      skills: CATALOG,
      localIssues: () => {
        probed = true
        return Promise.resolve(FOUND_LOCAL_ISSUES)
      },
    })

    const result = report(await service.handle('env.check', { workspaceRoot: ROOT }))

    expect(probed).toBe(true)
    expect(item(result.items, 'local-issues', null).status).toBe('pass')
  })
})
