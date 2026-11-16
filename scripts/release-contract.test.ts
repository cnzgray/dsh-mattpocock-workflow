/**
 * 发行契约测试：证明真正发布出去的东西装得上。
 *
 * 这里不 mock 构建器，也不 mock pnpm：唯一能证明「可安装」的是把构建产物打进 tarball、
 * 装进一个空目录、再按包名导入它。测试覆盖发布载荷的两条外部契约：
 *
 * - 载荷完整：`files` 覆盖全部运行期文件，安装后的包仍导出宿主入口与 ModuleLoader 外壳客户端；
 * - npm 接受同一份 tarball，发布清单与安装结果一致。
 *
 * tarball 安装不触发 `prepare`（本仓库的 `prepare` 需要源码与开发依赖，载荷里没有 scripts/），
 * 所以下面的安装同时证明了「从 Release 资产与 npm 安装无需构建」。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

import { readPluginMeta } from './build-pipeline.ts'

const ROOT = resolve(import.meta.dirname, '..')
const META = readPluginMeta(ROOT)

interface InstalledManifest {
  readonly name: string
  readonly version: string
  readonly main?: string
  readonly exports?: Readonly<Record<string, string>>
  readonly dsh?: {
    readonly bundle?: { readonly patch?: string }
    readonly client?: { readonly platform?: string }
  }
}

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function run(command: string, args: readonly string[], cwd: string): string {
  try {
    return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe' })
  } catch (error) {
    throw new Error(`${command} ${args.join(' ')} 失败：${stderrOf(error) || String(error)}`, {
      cause: error,
    })
  }
}

/** `execFileSync` 失败时把子进程 stderr 带进断言消息，否则只能看到退出码。 */
function stderrOf(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('stderr' in error)) return ''
  return typeof error.stderr === 'string' ? error.stderr : ''
}

afterAll(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('发布载荷', () => {
  let installedDir = ''
  let tarball = ''

  beforeAll(() => {
    const dir = makeTempDir('dsh-release-')
    // Git 安装走的就是这一步：仓库里没有 lib/，pnpm 装完开发依赖后运行 prepare。
    rmSync(join(ROOT, 'lib'), { recursive: true, force: true })
    run('pnpm', ['run', 'prepare'], ROOT)
    for (const entry of ['index.js', 'client.js']) {
      expect(existsSync(join(ROOT, 'lib', entry)), `prepare 没有构建 lib/${entry}`).toBe(true)
    }
    run('pnpm', ['pack', '--pack-destination', dir], ROOT)

    // pnpm/npm 把带 scope 的包名压成 `<scope>-<name>-<version>.tgz`。
    tarball = join(dir, `${META.name.replace(/^@/u, '').replaceAll('/', '-')}-${META.version}.tgz`)
    expect(existsSync(tarball), `pnpm pack 没有产出 ${tarball}`).toBe(true)

    const installDir = join(dir, 'install')
    mkdirSync(installDir)
    writeFileSync(
      join(installDir, 'package.json'),
      `${JSON.stringify({ name: 'release-probe', private: true }, undefined, 2)}\n`,
    )
    run('pnpm', ['add', tarball], installDir)
    installedDir = join(installDir, 'node_modules', META.name)
  }, 180_000)

  it('安装后的包导出具名 name/inject/apply，且没有默认导出', () => {
    // 必须换一个进程、并按包名解析：测试进程的 node_modules 里没有这个安装结果。
    // 探针里的 import() 是这条加载边界本身，静态导入表达不了。
    const probe = join(installedDir, '..', 'probe.mjs')
    writeFileSync(
      probe,
      `const plugin = await import(${JSON.stringify(META.name)})\n` +
        `console.log(JSON.stringify({\n` +
        `  name: plugin.name,\n` +
        `  inject: plugin.inject,\n` +
        `  apply: typeof plugin.apply,\n` +
        `  hasDefault: Object.hasOwn(plugin, 'default'),\n` +
        `}))\n`,
    )

    const shape = JSON.parse(run(process.execPath, [probe], join(installedDir, '..'))) as {
      name: unknown
      inject: unknown
      apply: unknown
      hasDefault: unknown
    }

    expect(shape.name).toBe(META.name)
    expect(shape.inject).toEqual(['subprocess', 'timer'])
    expect(shape.apply).toBe('function')
    expect(shape.hasDefault).toBe(false)
  })

  it('客户端入口是宿主认识的 ModuleLoader 外壳', () => {
    const code = readFileSync(join(installedDir, 'lib', 'client.js'), 'utf8')

    expect(code.startsWith('window.__ModuleLoader__.load({')).toBe(true)
    expect(code).toContain(`id: ${JSON.stringify(META.name)}`)
    expect(code).toContain("Symbol.toStringTag, { value: 'Module' }")
  })

  it('组合包 patch 可解析，并插入本插件的行', () => {
    const patch = parseYaml(readFileSync(join(installedDir, 'cordis.patch.yml'), 'utf8')) as {
      insert?: readonly { id?: unknown; name?: unknown }[]
    }[]

    expect(patch).toHaveLength(1)
    expect(patch[0]?.insert).toContainEqual(
      expect.objectContaining({ id: META.name, name: META.name }),
    )
  })

  it('技能目录随包发布', () => {
    const skillsDir = join(installedDir, 'skills')

    expect(statSync(skillsDir).isDirectory()).toBe(true)
    expect(readdirSync(skillsDir).length).toBeGreaterThan(0)
  })

  it('files 覆盖 exports、main 与组合包 patch 指向的运行期文件', () => {
    const manifest = JSON.parse(
      readFileSync(join(installedDir, 'package.json'), 'utf8'),
    ) as InstalledManifest

    for (const target of exportTargets(manifest)) {
      expect(matchesOf(installedDir, target).length, `发布载荷缺少 ${target}`).toBeGreaterThan(0)
    }
    expect(matchesOf(installedDir, manifest.main ?? '').length).toBeGreaterThan(0)
    expect(matchesOf(installedDir, manifest.dsh?.bundle?.patch ?? '').length).toBeGreaterThan(0)
  })

  it('npm 接受的就是这一份 tarball', () => {
    // dry-run + offline：不联网、不发布，只让 npm 算出它会发布的清单；manifest 不合格会在这里失败。
    const report = JSON.parse(
      run('npm', ['publish', tarball, '--dry-run', '--offline', '--json'], ROOT),
    ) as Record<string, { name?: string; version?: string; files?: readonly { path?: string }[] }>
    const packed = report[META.name]
    const paths = (packed?.files ?? []).map((file) => file.path)

    expect(packed?.name).toBe(META.name)
    expect(packed?.version).toBe(META.version)
    expect(paths).toEqual(
      expect.arrayContaining(['lib/index.js', 'lib/client.js', 'cordis.patch.yml']),
    )
  })
})

/** exports 的字符串目标；条件对象形式本包不用。 */
function exportTargets(manifest: InstalledManifest): string[] {
  return Object.values(manifest.exports ?? {}).filter((target) => typeof target === 'string')
}

/**
 * 把包内相对路径（含一个 `*`）展开成实际存在的相对文件名。
 * 只支持本包 exports 用到的「固定目录 + 一个星号」形式，够用即可。
 */
function matchesOf(installedDir: string, pattern: string): string[] {
  if (pattern === '') return []
  const star = pattern.indexOf('*')
  if (star === -1) return existsSync(join(installedDir, pattern)) ? [pattern] : []

  const slash = pattern.lastIndexOf('/', star)
  const parent = pattern.slice(0, slash)
  const prefix = pattern.slice(slash + 1, star)
  const suffix = pattern.slice(star + 1)
  const dir = join(installedDir, parent)
  if (!existsSync(dir)) return []

  return readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(suffix))
    .map((name) => `${parent}/${name}`)
}
