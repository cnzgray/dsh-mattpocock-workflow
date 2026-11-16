/**
 * 环境检查视图测试的报告夹具：一份 GitHub 全绿基线，加上几份只改动相关项的衍生报告。
 * 与视图测试分开，免得夹具把用例挤到 max-lines 之外。
 */
import type { CapabilityDiagnostic, EnvCheckItem, EnvCheckReport } from '../protocol/env-check.ts'

/** 按需覆盖字段造一行检查项；默认是通过。 */
export function row(overrides: Partial<EnvCheckItem> & Pick<EnvCheckItem, 'id'>): EnvCheckItem {
  return {
    subject: null,
    status: 'pass',
    detail: '依据',
    remedy: null,
    blockedBy: null,
    ...overrides,
  }
}

export const CLIENT_CAPABILITIES: readonly CapabilityDiagnostic[] = [
  { id: 'slots', category: 'ui-extension', status: 'present' },
  { id: 'sessions', category: 'ui-extension', status: 'missing' },
]

export const REPORT: EnvCheckReport = {
  checkedAt: 1,
  backend: 'github',
  repository: 'owner/repo',
  items: [
    row({ id: 'home', detail: '/home/dev' }),
    row({ id: 'backend', detail: 'remote:github' }),
    row({
      id: 'cli',
      subject: 'github',
      status: 'fail',
      detail: '未找到 gh 可执行文件',
      remedy: { code: 'install-cli', subject: 'github' },
    }),
    row({
      id: 'auth',
      subject: 'github',
      status: 'skipped',
      detail: '未执行检查',
      blockedBy: { id: 'cli', subject: 'github' },
    }),
    row({
      id: 'repository',
      subject: 'github',
      status: 'skipped',
      detail: '未执行检查',
      blockedBy: { id: 'cli', subject: 'github' },
    }),
    row({ id: 'workspace', detail: 'docs/agents/issue-tracker.md 存在' }),
    row({ id: 'skill', subject: 'to-spec', detail: 'DSH 技能清单已收录' }),
  ],
  capabilities: [
    { id: 'subprocess', category: 'host-service', status: 'present' },
    { id: 'timer', category: 'host-service', status: 'missing' },
  ],
}

export const WORKSPACE_FAIL: EnvCheckReport = {
  ...REPORT,
  items: REPORT.items.map((item) =>
    item.id === 'workspace'
      ? {
          ...item,
          status: 'fail',
          detail: '未找到 docs/agents/issue-tracker.md',
          remedy: { code: 'init-workspace', subject: null },
        }
      : item,
  ),
}

export const FIXED_REPORT: EnvCheckReport = {
  ...REPORT,
  items: REPORT.items.map((item) => ({
    ...item,
    status: 'pass',
    remedy: null,
    blockedBy: null,
  })),
}

export const RETRY_REPORT: EnvCheckReport = {
  ...REPORT,
  items: REPORT.items.map((item) =>
    item.id === 'repository'
      ? {
          ...item,
          status: 'fail',
          detail: '网络不可达或请求超时',
          remedy: { code: 'check-network', subject: null },
          blockedBy: null,
        }
      : item.id === 'auth'
        ? { ...item, status: 'pass', detail: '已登录', blockedBy: null }
        : item,
  ),
}

/** 本地 Markdown 后端：没有命令行三项，本地工单目录按约定判定。 */
export const MARKDOWN_REPORT: EnvCheckReport = {
  checkedAt: 4,
  backend: 'markdown',
  repository: null,
  items: [
    row({ id: 'home', detail: '/home/dev' }),
    row({ id: 'backend', detail: 'no-remote:markdown' }),
    row({ id: 'workspace', detail: 'docs/agents/issue-tracker.md 存在' }),
    row({
      id: 'local-issues',
      status: 'fail',
      detail: '工作区里没有 .scratch 目录',
      remedy: { code: 'place-local-issues', subject: null },
    }),
  ],
  capabilities: [],
}

/** Gitea 后端：CLI 缺失，登录与仓库可达跳过；托管后端不检查本地工单目录。 */
export const GITEA_REPORT: EnvCheckReport = {
  checkedAt: 2,
  backend: 'gitea',
  repository: 'owner/repo',
  items: [
    row({ id: 'backend', detail: 'tea-auth:gitea（gitea.example.com）' }),
    row({
      id: 'cli',
      subject: 'gitea',
      status: 'fail',
      detail: '未找到 tea 可执行文件',
      remedy: { code: 'install-cli', subject: 'gitea' },
    }),
    row({
      id: 'auth',
      subject: 'gitea',
      status: 'skipped',
      detail: '未执行检查',
      blockedBy: { id: 'cli', subject: 'gitea' },
    }),
    row({
      id: 'repository',
      subject: 'gitea',
      status: 'skipped',
      detail: '未执行检查',
      blockedBy: { id: 'cli', subject: 'gitea' },
    }),
  ],
  capabilities: [],
}

/** 后端判定失败但已锁定候选 Gitea。 */
export const CANDIDATE_REPORT: EnvCheckReport = {
  checkedAt: 3,
  backend: null,
  repository: null,
  items: [
    row({
      id: 'backend',
      subject: 'gitea',
      status: 'fail',
      detail: 'tea 未登录 gitea.example.com',
      remedy: { code: 'login-cli', subject: 'gitea' },
    }),
    row({
      id: 'cli',
      subject: 'gitea',
      status: 'skipped',
      detail: '未执行检查',
      blockedBy: { id: 'backend', subject: 'gitea' },
    }),
  ],
  capabilities: [],
}

function missingSkill(subject: string): EnvCheckItem {
  return row({
    id: 'skill',
    subject,
    status: 'fail',
    detail: 'DSH 技能清单与磁盘目录都没有找到',
    remedy: { code: 'install-skill', subject },
  })
}

function installedSkill(subject: string): EnvCheckItem {
  return row({ id: 'skill', subject, detail: 'DSH 技能清单已收录' })
}

/** 缺两项技能：每项自己的解决还在，另应出现总装卡片。 */
export const TWO_SKILLS_MISSING_REPORT: EnvCheckReport = {
  ...REPORT,
  items: [
    ...REPORT.items.filter((item) => item.id !== 'skill'),
    missingSkill('to-spec'),
    missingSkill('to-tickets'),
    installedSkill('triage'),
  ],
}

/** 只缺一项技能：逐项解决已经等价，不出现总装卡片。 */
export const ONE_SKILL_MISSING_REPORT: EnvCheckReport = {
  ...REPORT,
  items: [
    ...REPORT.items.filter((item) => item.id !== 'skill'),
    missingSkill('to-spec'),
    installedSkill('to-tickets'),
  ],
}

/** 主目录不可解析：技能项被跳过，不算缺失，不出现总装卡片。 */
export const SKIPPED_SKILLS_REPORT: EnvCheckReport = {
  ...REPORT,
  items: [
    ...REPORT.items.filter((item) => item.id !== 'skill'),
    row({
      id: 'skill',
      subject: 'to-spec',
      status: 'skipped',
      detail: '未执行检查',
      blockedBy: { id: 'home', subject: null },
    }),
    row({
      id: 'skill',
      subject: 'to-tickets',
      status: 'skipped',
      detail: '未执行检查',
      blockedBy: { id: 'home', subject: null },
    }),
  ],
}
