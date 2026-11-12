/**
 * 构建：把源码打成 DSH 能加载的两个文件，产物在 lib/，不进仓库。
 *
 *   lib/index.js   服务端入口，ESM，第三方依赖不打进来，由 npm 安装。
 *   lib/client.js  界面入口，包在 DSH 的 ModuleLoader 外壳里。外壳的 factory 会拿到宿主的 require，
 *                  React 通过它向宿主要，所以 react 必须标为外部依赖，不能打包一份自己的。
 */
import { readFile, rm, writeFile } from 'node:fs/promises'

import { build } from 'esbuild'

const PLUGIN_ID = 'dsh-mattpocock-workflow'

const pkg = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
const define = { __PLUGIN_VERSION__: JSON.stringify(pkg.version) }

await rm('lib', { recursive: true, force: true })

await build({
  entryPoints: ['src/host/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'external',
  define,
  logLevel: 'warning',
})

const client = await build({
  entryPoints: ['src/client/index.tsx'],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  external: ['react'],
  jsx: 'transform',
  define,
  logLevel: 'warning',
})

const clientCode = client.outputFiles[0]?.text
if (clientCode === undefined) throw new Error('界面入口没有产出任何代码')

// 外壳：DSH 调用 factory(require)，读取返回对象上的 inject 和 apply。
// 打标 Symbol.toStringTag = 'Module'，宿主据此把它当成 ES 模块命名空间对待。
const shell = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(PLUGIN_ID)},
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
${clientCode}
    Object.defineProperty(module.exports, Symbol.toStringTag, { value: 'Module' })
    return module.exports
  }
})
`
await writeFile('lib/client.js', shell)

console.log(`构建完成：${pkg.version}`)
console.log('  lib/index.js')
console.log('  lib/client.js')
