/**
 * 环境检查的文件系统接缝：解析用户主目录、判断文件是否存在。
 * 只读；正式代码包一层 `node:os` 与 `node:fs`，测试用内存实现。
 */
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'

/** 环境检查需要的文件读取能力。 */
export interface EnvFiles {
  /** 用户主目录；解析不到时为 undefined。 */
  homeDirectory(): string | undefined
  /** 路径存在且是普通文件时为 true；不存在或不可读时为 false。 */
  isFile(path: string): Promise<boolean>
}

/**
 * 创建基于 Node 的实现。
 * @returns 文件读取能力。
 */
export function createNodeEnvFiles(): EnvFiles {
  return {
    homeDirectory() {
      try {
        const home = homedir()
        return home.length > 0 ? home : undefined
      } catch {
        return undefined
      }
    },
    async isFile(path) {
      try {
        return (await stat(path)).isFile()
      } catch {
        return false
      }
    },
  }
}
