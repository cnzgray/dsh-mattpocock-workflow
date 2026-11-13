/**
 * 生产构建：把源码打成 DSH 能加载的两个文件，产物在 lib/，不进仓库。
 *
 *   lib/index.js   服务端入口，ESM，第三方依赖不打进来，由 npm 安装。
 *   lib/client.js  界面入口，包在 DSH 的 ModuleLoader 外壳里。外壳的 factory 会拿到宿主的 require，
 *                  React 通过它向宿主要，所以 react 必须标为外部依赖，不能打包一份自己的。
 *
 * 选项、外壳与产物命名和开发 watch（dev.ts）共用 scripts/build-pipeline.ts，避免两套逻辑漂移。
 */
import { rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { build } from 'esbuild'

import {
  buildPaths,
  composeClientArtifacts,
  createClientBuildOptions,
  createHostBuildOptions,
  readPluginMeta,
} from './build-pipeline.ts'

const rootDir = resolve(import.meta.dirname, '..')
const meta = readPluginMeta(rootDir)
const paths = buildPaths(rootDir)

// 生产构建是一次性重建：先清空产物目录，避免上一轮的文件残留。
await rm(paths.libDir, { recursive: true, force: true })

await build(createHostBuildOptions(meta, paths))

const client = await build({
  ...createClientBuildOptions(meta, paths, { sourceMap: false }),
  write: false,
})
const artifacts = composeClientArtifacts({ pluginId: meta.name, outputFiles: client.outputFiles })
if (artifacts.sourceMap !== undefined) throw new Error('生产构建不应产出 source map')
await writeFile(paths.clientOut, artifacts.code)

console.log(`构建完成：${meta.version}`)
console.log('  lib/index.js')
console.log('  lib/client.js')
