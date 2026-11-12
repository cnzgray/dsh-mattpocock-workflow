/**
 * 界面插件入口。构建脚本把它包进 DSH 的 ModuleLoader 外壳（见 scripts/build.ts），
 * DSH 读取这里的具名导出 inject 和 apply。
 *
 * 目前是空插件，只用来走通构建和加载。
 */
export const inject: string[] = []

export function apply(): void {
  // 空插件：还没有任何功能。
}
