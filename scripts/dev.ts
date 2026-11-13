/**
 * 开发模式：一条命令同时监听宿主与客户端构建，原地覆盖 lib/ 产物。
 *
 * DSH 的宿主 HMR 只订阅 change 事件，客户端 HMR 按 bundle 的 mtime/ctime/size 轮询，
 * 所以这里不删除产物目录，只逐文件重写；构建失败时保留上一次成功产物。
 *
 *   pnpm dev
 *
 * 不写 desktop profile：HMR 配置只打印，由开发者自己贴进 profile。
 */
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

import { context, type BuildContext, type BuildResult, type Plugin } from 'esbuild'

import {
  buildPaths,
  composeClientArtifacts,
  createClientBuildOptions,
  createHostBuildOptions,
  desktopLinkHint,
  inspectDesktopLink,
  readPluginMeta,
  renderHmrConfig,
  type BuildPaths,
  type PluginMeta,
} from './build-pipeline.ts'

const rootDir = resolve(import.meta.dirname, '..')

interface OutputWriter {
  readonly label: string
  /** 写盘成功时返回一行给终端看的摘要；失败直接抛错，由 esbuild 报告。 */
  readonly write: (result: BuildResult) => Promise<string>
}

/** 每次构建结束后写盘。esbuild 在失败时不给 outputFiles，因此旧产物天然保留。 */
function createWriterPlugin(writer: OutputWriter): Plugin {
  return {
    name: `dsh-dev-${writer.label}`,
    setup(build) {
      build.onEnd(async (result) => {
        if (result.errors.length > 0) {
          console.error(`[${writer.label}] 构建失败，保留上一次成功产物。`)
          return
        }
        console.log(`[${writer.label}] ${await writer.write(result)}`)
      })
    },
  }
}

async function writeHost(paths: BuildPaths, result: BuildResult): Promise<string> {
  const script = result.outputFiles?.find((file) => file.path === paths.hostOut)
  if (script === undefined) throw new Error('宿主构建没有产出 lib/index.js')
  // 原地覆写：chokidar 把内容重写报成 change；原子替换能否合并成 change 取决于平台时序。
  await writeFile(paths.hostOut, script.text)
  return 'lib/index.js 已更新；DSH 会重载宿主插件。'
}

async function writeClient(
  meta: PluginMeta,
  paths: BuildPaths,
  result: BuildResult,
): Promise<string> {
  const artifacts = composeClientArtifacts({
    pluginId: meta.name,
    outputFiles: result.outputFiles ?? [],
  })
  await replaceAtomically(paths.clientOut, artifacts.code)
  if (artifacts.sourceMap !== undefined) {
    await replaceAtomically(`${paths.clientOut}.map`, artifacts.sourceMap)
  }
  return 'lib/client.js 已更新；面板会整块重载（React 状态重置）。'
}

/** 客户端产物用临时文件 + rename 替换：stat 轮询方不会读到半写内容。 */
async function replaceAtomically(path: string, contents: string): Promise<void> {
  const temp = join(dirname(path), `${basename(path)}.${String(process.pid)}.tmp`)
  try {
    await writeFile(temp, contents)
    await rename(temp, path)
  } finally {
    await rm(temp, { force: true })
  }
}

interface BannerOptions {
  readonly meta: PluginMeta
  readonly paths: BuildPaths
  readonly profileDir: string
}

function printBanner(options: BannerOptions): void {
  const { meta, paths, profileDir } = options
  console.log(`开发模式：${meta.name}@${meta.version}`)
  console.log('监听宿主与客户端构建，原地覆盖 lib/（不删除产物目录）。')
  console.log('')
  console.log(`产物：${paths.hostOut}`)
  console.log(`      ${paths.clientOut}（含 client.js.map）`)
  console.log('')
  console.log('HMR 配置（仅开发期使用，贴进 desktop profile 的 cordis.patch.yml）：')
  console.log(renderHmrConfig({ libDir: paths.libDir }))
  console.log(`profile：${join(profileDir, 'cordis.patch.yml')}`)
  const link = inspectDesktopLink({ profileDir, packageName: meta.name, rootDir })
  console.log(desktopLinkHint(link, profileDir))
  console.log('')
  console.log('客户端保存后整块重载，面板内 React 状态会重置；宿主保存后插件自动重启。')
  console.log('Ctrl-C 退出。')
}

function registerShutdown(contexts: readonly BuildContext[]): void {
  let stopping = false
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return
    stopping = true
    console.log(`\n收到 ${signal}，停止 watch…`)
    await Promise.allSettled(contexts.map((current) => current.dispose()))
    console.log('已停止；lib/ 保留最后一次成功产物。')
  }
  process.once('SIGINT', () => {
    void shutdown('SIGINT')
  })
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM')
  })
}

async function main(): Promise<void> {
  const meta = readPluginMeta(rootDir)
  const paths = buildPaths(rootDir)
  const profileDir = process.env.DSH_PROFILE_DIR ?? join(homedir(), '.dsh', 'profiles', 'desktop')

  await mkdir(paths.libDir, { recursive: true })
  printBanner({ meta, paths, profileDir })

  const hostContext = await context({
    ...createHostBuildOptions(meta, paths),
    write: false,
    plugins: [createWriterPlugin({ label: 'host', write: (result) => writeHost(paths, result) })],
  })
  const clientContext = await context({
    ...createClientBuildOptions(meta, paths, { sourceMap: true }),
    write: false,
    plugins: [
      createWriterPlugin({ label: 'client', write: (result) => writeClient(meta, paths, result) }),
    ],
  })

  registerShutdown([hostContext, clientContext])
  await Promise.all([hostContext.watch(), clientContext.watch()])
}

await main()
