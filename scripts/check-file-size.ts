/**
 * 拦住被 git 跟踪的大文件。演示视频、截图原图这类东西放 GitHub Release 附件或外部存储，
 * 仓库里只放链接，免得每次克隆都要下载大文件。
 */
import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'

const LIMIT_BYTES = 1024 * 1024

const files = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  {
    encoding: 'utf8',
  },
)
  .split('\0')
  .filter((file) => file.length > 0)

const oversized = files
  .map((file) => {
    try {
      return { file, size: statSync(file).size }
    } catch {
      // 已删除但尚未提交删除的文件，跳过。
      return { file, size: 0 }
    }
  })
  .filter(({ size }) => size > LIMIT_BYTES)

if (oversized.length > 0) {
  console.error(`以下文件超过 ${String(LIMIT_BYTES / 1024)} KB，请移出仓库：`)
  for (const { file, size } of oversized) {
    console.error(`  ${file}（${(size / 1024 / 1024).toFixed(1)} MB）`)
  }
  process.exit(1)
}

console.log(`文件大小检查通过：${String(files.length)} 个文件都不超过 1 MB`)
