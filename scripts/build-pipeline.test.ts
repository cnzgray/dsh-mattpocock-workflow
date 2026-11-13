import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { build } from 'esbuild'
import { afterEach, describe, expect, it } from 'vitest'

import {
  buildPaths,
  composeClientArtifacts,
  wrapClientModule,
  createClientBuildOptions,
  createHostBuildOptions,
  desktopLinkHint,
  inspectDesktopLink,
  parseSourceMap,
  readPluginMeta,
  renderHmrConfig,
  shiftSourceMap,
} from './build-pipeline.ts'

const ROOT = resolve(import.meta.dirname, '..')
const META = readPluginMeta(ROOT)

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('客户端外壳', () => {
  it('把 CJS 代码包进 ModuleLoader 外壳，客户端代码从第 6 行开始', () => {
    const composed = wrapClientModule({ pluginId: 'pkg-name', code: 'const answer = 42\n' })
    const lines = composed.code.split('\n')

    expect(lines[0]).toBe('window.__ModuleLoader__.load({')
    expect(lines[1]).toBe('  id: "pkg-name",')
    expect(lines[2]).toBe('  factory: (require) => {')
    expect(lines[5]).toBe('const answer = 42')
    expect(composed.lineOffset).toBe(5)
    expect(composed.code).toContain("Symbol.toStringTag, { value: 'Module' }")
    expect(composed.code.endsWith('})\n')).toBe(true)
  })

  it('剥掉 esbuild 的 source map 声明，只在外壳末尾保留一次', () => {
    const composed = wrapClientModule({
      pluginId: 'pkg-name',
      code: 'const answer = 42\n//# sourceMappingURL=client.js.map\n',
      sourceMapFileName: 'client.js.map',
    })

    expect(composed.code.match(/sourceMappingURL/g)).toHaveLength(1)
    expect(composed.code.endsWith('//# sourceMappingURL=client.js.map\n')).toBe(true)
  })
})

describe('source map 平移', () => {
  it('按外壳行数整体下移 mappings，其余字段原样保留', () => {
    const map = parseSourceMap(
      '{"version":3,"sources":["../src/client/index.tsx"],"names":[],"mappings":"AAAA;AACA"}',
    )
    const shifted = shiftSourceMap(map, 5)

    expect(shifted.mappings).toBe(';;;;;AAAA;AACA')
    expect(shifted.sources).toEqual(['../src/client/index.tsx'])
  })

  it('畸形 source map 直接报错，而不是写出错位的映射', () => {
    expect(() => parseSourceMap('{"version":2,"mappings":""}')).toThrow()
    expect(() => parseSourceMap('{"version":3}')).toThrow()
    expect(() => parseSourceMap('null')).toThrow()
  })
})

describe('客户端产物组装', () => {
  it('有 map 时产出 bundle 与平移后的 sibling map', () => {
    const artifacts = composeClientArtifacts({
      pluginId: 'pkg-name',
      outputFiles: [
        {
          path: '/repo/lib/client.js',
          text: 'const answer = 42\n//# sourceMappingURL=client.js.map\n',
        },
        {
          path: '/repo/lib/client.js.map',
          text: '{"version":3,"sources":["../src/client/index.tsx"],"names":[],"mappings":"AAAA"}',
        },
      ],
    })

    expect(artifacts.code).toContain('window.__ModuleLoader__.load')
    expect(artifacts.code.match(/sourceMappingURL/g)).toHaveLength(1)
    expect(parseSourceMap(artifacts.sourceMap ?? '').mappings).toBe(';;;;;AAAA')
  })

  it('没有 map 时不追加 sourceMappingURL', () => {
    const artifacts = composeClientArtifacts({
      pluginId: 'pkg-name',
      outputFiles: [{ path: '/repo/lib/client.js', text: 'const answer = 42\n' }],
    })

    expect(artifacts.sourceMap).toBeUndefined()
    expect(artifacts.code).not.toContain('sourceMappingURL')
  })
})

describe('HMR 配置片段', () => {
  it('带本 checkout 的产物绝对路径、100ms 轮询与开发期说明', () => {
    const snippet = renderHmrConfig({ libDir: "/tmp/it's a checkout/lib" })

    expect(snippet).toContain("root: ['/tmp/it''s a checkout/lib']")
    expect(snippet).toContain('pollIntervalMs: 100')
    expect(snippet).toContain("name: '@deepseek-ai/dsh-hmr'")
    expect(snippet).toContain("name: '@deepseek-ai/dsh-client-hmr'")
    expect(snippet).toContain('仅开发期使用')
  })
})

describe('desktop profile 链接检测', () => {
  it('插件还没装进 profile 时报告 missing，并提示用 link: 安装', () => {
    const profileDir = makeTempDir('dsh-link-')
    const link = inspectDesktopLink({ profileDir, packageName: 'pkg-name', rootDir: ROOT })

    expect(link.kind).toBe('missing')
    expect(desktopLinkHint(link, profileDir)).toContain('link:')
  })

  it('链接指向本 checkout 时报告 linked', () => {
    const profileDir = makeTempDir('dsh-link-')
    mkdirSync(join(profileDir, 'node_modules'))
    symlinkSync(ROOT, join(profileDir, 'node_modules', 'pkg-name'))

    const link = inspectDesktopLink({ profileDir, packageName: 'pkg-name', rootDir: ROOT })
    expect(link.kind).toBe('linked')
  })

  it('链接指向别的 checkout 时带出实际路径', () => {
    const profileDir = makeTempDir('dsh-link-')
    const other = join(profileDir, 'other-checkout')
    mkdirSync(other)
    mkdirSync(join(profileDir, 'node_modules'))
    symlinkSync(other, join(profileDir, 'node_modules', 'pkg-name'))

    const link = inspectDesktopLink({ profileDir, packageName: 'pkg-name', rootDir: ROOT })
    expect(link).toEqual({ kind: 'linked-elsewhere', target: realpathSync(other) })
  })
})

describe('构建管线', () => {
  it('宿主产物是带默认导出的 ESM', async () => {
    const paths = buildPaths(ROOT, makeTempDir('dsh-lib-'))
    const host = await build({
      ...createHostBuildOptions(META, paths),
      write: false,
      metafile: true,
    })

    const outputs = Object.values(host.metafile.outputs)
    expect(outputs).toHaveLength(1)
    expect(outputs[0]?.exports).toContain('default')
  })

  it('开发模式的客户端产物带外壳和能定位到 TSX 的 source map', async () => {
    const paths = buildPaths(ROOT, makeTempDir('dsh-lib-'))
    const client = await build({
      ...createClientBuildOptions(META, paths, { sourceMap: true }),
      write: false,
    })
    const artifacts = composeClientArtifacts({
      pluginId: META.name,
      outputFiles: client.outputFiles,
    })

    expect(artifacts.code).toContain('window.__ModuleLoader__.load')
    expect(artifacts.code).toContain(`id: ${JSON.stringify(META.name)}`)
    const map = parseSourceMap(artifacts.sourceMap ?? '')
    expect(map.mappings.startsWith(';;;;;')).toBe(true)
    expect(map.sources).toEqual(
      expect.arrayContaining([expect.stringContaining('src/client/index.tsx')]),
    )
  })

  it('生产模式的客户端产物不带 source map', async () => {
    const paths = buildPaths(ROOT, makeTempDir('dsh-lib-'))
    const client = await build({
      ...createClientBuildOptions(META, paths, { sourceMap: false }),
      write: false,
    })
    const artifacts = composeClientArtifacts({
      pluginId: META.name,
      outputFiles: client.outputFiles,
    })

    expect(artifacts.sourceMap).toBeUndefined()
    expect(artifacts.code).not.toContain('sourceMappingURL')
  })
})
