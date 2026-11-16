/**
 * 安装期准备：`prepare` 同时服务两种人。
 *
 * - 从 Git 安装插件的用户：pnpm 克隆仓库、装好开发依赖后运行本脚本，于是 `lib/` 与源码一致。
 *   构建产物不进仓库，这一步是 Git 安装唯一的构建来源。
 * - 本仓库的贡献者：`pnpm install` 后同样走到这里，先构建一次，再装 git 钩子。
 *
 * 因此这里只用产物需要的开发依赖（esbuild），不跑类型检查，也不假设 monorepo。
 * git 钩子安装是尽力而为：它属于本地开发体验，失败不能挡住安装。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const rootDir = resolve(import.meta.dirname, '..')

execFileSync(process.execPath, [resolve(rootDir, 'scripts/build.ts')], {
  cwd: rootDir,
  stdio: 'inherit',
})

const hooks = spawnSync('lefthook', ['install'], {
  cwd: rootDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (hooks.status !== 0) {
  console.warn('lefthook install 未成功，跳过 git 钩子安装。')
}
