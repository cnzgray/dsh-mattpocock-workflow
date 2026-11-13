/**
 * 面板提示词测试的共享夹具：按 DSH 的手势语法提取技能名。
 * 只被测试文件导入，不参与插件构建。
 */

/** 与 DSH 的技能手势语法相同：空白或行边界包裹的 `/kebab-name`。 */
const GESTURE = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g

/**
 * 文本里的技能手势。
 * @param text - 待扫描的注入文本。
 * @returns 按出现顺序排列的技能名。
 */
export function gestures(text: string): readonly string[] {
  return [...text.matchAll(GESTURE)].map((match) => match[2] ?? '')
}
