/**
 * 预设提示词。只填进输入框，不自动发送；用户可以改完再按发送。
 * 入口技能按 mattpocock/skills 的分类编写：需求梳理、triage/诊断、implement。
 */

/** “新建需求”按钮填入的开场提示词。 */
export const NEW_FEATURE_PROMPT =
  '使用 to-spec 技能开始一项新需求：先向我提问，澄清目标、验收标准和边界，再整理成规格并创建工单。现在先问第一个问题。'

/** “+ bug”按钮填入的开场提示词。 */
export const NEW_BUG_PROMPT =
  '使用 triage 和 diagnosing-bugs 技能处理一个缺陷：先复现并确认现象，再定位根因。开始前先问我要复现步骤和预期行为。'

/**
 * 点击某张票时填入的提示词。
 * @param ref - 工单引用：远端后端是 `#15`，本地 Markdown 是相对工作区的文件路径。
 * @returns 以 implement 技能处理该票的开场提示词。
 */
export function processTicketPrompt(ref: string): string {
  return `使用 implement 技能处理 ${ref}：先读取这张工单的完整规格，再按规格实现并运行 pnpm check。`
}
