/**
 * 构建管线：生产构建（build.ts）与开发 watch（dev.ts）共用同一套选项、客户端外壳与产物命名，
 * 避免两套构建逻辑漂移。这里只放可测试的构建逻辑（读 package.json、拼外壳、平移 source map、
 * 渲染 HMR 配置、检查 profile 链接）；写盘、watch 和进程退出由两个入口负责。
 */
import { readFileSync, realpathSync } from 'node:fs'
import { basename, join } from 'node:path'

import type { BuildOptions } from 'esbuild'

/** 客户端 bundle 的 stat 轮询间隔。DSH 默认 500ms，开发时降到 100ms 更接近“保存即刷新”。 */
const HMR_POLL_INTERVAL_MS = 100

/** esbuild 追加在 CJS 末尾的 source map 声明；拼进外壳前要剥掉，改在外壳最后追加一次。 */
const SOURCE_MAP_COMMENT = /\n?\/\/# sourceMappingURL=\S*[ \t]*\n?$/u

export interface PluginMeta {
  readonly name: string
  readonly version: string
}

/** 构建产物的固定路径。客户端路径必须和 package.json 的 `exports["./client"]` 一致，HMR 按它轮询。 */
export interface BuildPaths {
  readonly rootDir: string
  readonly libDir: string
  readonly hostEntry: string
  readonly hostOut: string
  readonly clientEntry: string
  readonly clientOut: string
}

export function readPluginMeta(rootDir: string): PluginMeta {
  const parsed = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')) as {
    name?: unknown
    version?: unknown
  }
  if (typeof parsed.name !== 'string' || typeof parsed.version !== 'string') {
    throw new Error('package.json 缺少 name 或 version')
  }
  return { name: parsed.name, version: parsed.version }
}

export function buildPaths(rootDir: string, libDir: string = join(rootDir, 'lib')): BuildPaths {
  return {
    rootDir,
    libDir,
    hostEntry: join(rootDir, 'src/host/index.ts'),
    hostOut: join(libDir, 'index.js'),
    clientEntry: join(rootDir, 'src/client/index.tsx'),
    clientOut: join(libDir, 'client.js'),
  }
}

export interface ClientBuildMode {
  /** 仅开发构建生成外部 source map；生产产物保持原样。 */
  readonly sourceMap: boolean
}

export function createHostBuildOptions(meta: PluginMeta, paths: BuildPaths): BuildOptions {
  return {
    absWorkingDir: paths.rootDir,
    entryPoints: [paths.hostEntry],
    outfile: paths.hostOut,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    // 第三方依赖不打进来，由 npm 安装；宿主进程直接从 node_modules 解析。
    packages: 'external',
    define: pluginVersionDefine(meta),
    logLevel: 'warning',
  }
}

export function createClientBuildOptions(
  meta: PluginMeta,
  paths: BuildPaths,
  mode: ClientBuildMode,
): BuildOptions {
  return {
    absWorkingDir: paths.rootDir,
    entryPoints: [paths.clientEntry],
    outfile: paths.clientOut,
    bundle: true,
    platform: 'browser',
    format: 'cjs',
    target: 'es2022',
    // React 必须由宿主的 require 提供；打一份自己的会在页面里出现两份 React。
    external: ['react'],
    jsx: 'transform',
    define: pluginVersionDefine(meta),
    logLevel: 'warning',
    sourcemap: mode.sourceMap ? 'external' : false,
  }
}

function pluginVersionDefine(meta: PluginMeta): Record<string, string> {
  return { __PLUGIN_VERSION__: JSON.stringify(meta.version) }
}

export interface ComposedClientModule {
  readonly code: string
  /** esbuild 的 map 需要整体下移的生成行数，等于外壳前置行数。 */
  readonly lineOffset: number
}

/**
 * 把 esbuild 的 CJS 产物包进 DSH 的 ModuleLoader 外壳。
 *
 * 外壳前 5 行是固定的注册形式，客户端代码从第 6 行第 0 列开始；source map 的 mappings
 * 按生成行分号分隔，所以整体下移就是在 mappings 前补同样数量的 `;`，不需要重算 VLQ。
 */
export function wrapClientModule(options: {
  readonly pluginId: string
  readonly code: string
  readonly sourceMapFileName?: string | undefined
}): ComposedClientModule {
  const prefix = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(options.pluginId)},
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
`
  // 打标 Symbol.toStringTag = 'Module'，宿主据此把它当成 ES 模块命名空间对待。
  const footer = `
    Object.defineProperty(module.exports, Symbol.toStringTag, { value: 'Module' })
    return module.exports
  }
})
`
  const directive =
    options.sourceMapFileName === undefined
      ? ''
      : `//# sourceMappingURL=${options.sourceMapFileName}\n`
  const body = options.code.replace(SOURCE_MAP_COMMENT, '')
  return {
    code: `${prefix}${body}${footer}${directive}`,
    lineOffset: prefix.split('\n').length - 1,
  }
}

/** 只建模平移用得到的字段，其余字段（sources、sourcesContent 等）原样保留。 */
export type SourceMap = Readonly<Record<string, unknown>> & {
  readonly version: number
  readonly mappings: string
}

export function parseSourceMap(text: string): SourceMap {
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('客户端 source map 不是对象')
  }
  const { version, mappings } = parsed as Record<string, unknown>
  if (version !== 3 || typeof mappings !== 'string') {
    // 畸形 map 会让 DSH 的 combo-map 端点抛错，宁可在构建时直接失败。
    throw new Error('客户端 source map 不是合法的 Source Map v3')
  }
  return { ...(parsed as Record<string, unknown>), version, mappings }
}

export function shiftSourceMap(map: SourceMap, lineOffset: number): SourceMap {
  return { ...map, mappings: `${';'.repeat(lineOffset)}${map.mappings}` }
}

export interface BuildOutputFile {
  readonly path: string
  readonly text: string
}

export interface ClientArtifacts {
  readonly code: string
  readonly sourceMap: string | undefined
}

/** 把一次 esbuild 的客户端输出转换成最终落盘的 `lib/client.js` 与 `lib/client.js.map`。 */
export function composeClientArtifacts(options: {
  readonly pluginId: string
  readonly outputFiles: readonly BuildOutputFile[]
}): ClientArtifacts {
  const script = options.outputFiles.find((file) => file.path.endsWith('.js'))
  if (script === undefined) throw new Error('客户端构建没有产出脚本')

  const mapFile = options.outputFiles.find((file) => file.path.endsWith('.map'))
  if (mapFile === undefined) {
    return {
      code: wrapClientModule({ pluginId: options.pluginId, code: script.text }).code,
      sourceMap: undefined,
    }
  }

  const composed = wrapClientModule({
    pluginId: options.pluginId,
    code: script.text,
    sourceMapFileName: basename(mapFile.path),
  })
  const map = shiftSourceMap(parseSourceMap(mapFile.text), composed.lineOffset)
  return { code: composed.code, sourceMap: `${JSON.stringify(map)}\n` }
}

export interface HmrConfigOptions {
  readonly libDir: string
}

/**
 * 打印给开发者贴进 desktop profile 的 HMR 配置。只打印，不写 profile：
 * 安装与 profile 内容归 DSH 的插件管理，开发脚本不该碰。
 */
export function renderHmrConfig(options: HmrConfigOptions): string {
  return `# 仅开发期使用：贴进 desktop profile 的 cordis.patch.yml，开发结束后删除，不要提交。
# patch 会替换整行的 config，不做深合并。
- id: hmr
  name: '@deepseek-ai/dsh-hmr'
  disabled: false
  config:
    # 监听构建产物而不是源码：宿主加载的是 lib/index.js，且只把原地重写作 change 事件。
    root: [${quoteYaml(options.libDir)}]
- id: client-hmr
  name: '@deepseek-ai/dsh-client-hmr'
  config:
    pollIntervalMs: ${String(HMR_POLL_INTERVAL_MS)}
`
}

function quoteYaml(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

export type DesktopLink =
  | { readonly kind: 'linked' }
  | { readonly kind: 'linked-elsewhere'; readonly target: string }
  | { readonly kind: 'missing' }

export interface DesktopLinkOptions {
  readonly profileDir: string
  readonly packageName: string
  readonly rootDir: string
}

/** 检查 desktop profile 是否链接的就是当前 checkout；只读，不修 profile。 */
export function inspectDesktopLink(options: DesktopLinkOptions): DesktopLink {
  const installed = join(options.profileDir, 'node_modules', options.packageName)
  let target: string
  try {
    target = realpathSync(installed)
  } catch {
    return { kind: 'missing' }
  }
  return target === realpathSync(options.rootDir)
    ? { kind: 'linked' }
    : { kind: 'linked-elsewhere', target }
}

export function desktopLinkHint(link: DesktopLink, profileDir: string): string {
  switch (link.kind) {
    case 'linked':
      return `desktop profile 已链接本 checkout：${profileDir}`
    case 'missing':
      return `desktop profile 里还没有本插件（${profileDir}）；请先把本 checkout 以 link: 方式装进去，否则 Desktop 加载的仍是旧副本。`
    case 'linked-elsewhere':
      return `desktop profile 链接的是另一个 checkout：${link.target}；当前 checkout 的构建不会被 Desktop 加载。`
  }
}
