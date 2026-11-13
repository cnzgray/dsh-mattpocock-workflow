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

/** Gitea 后端：CLI 缺失，登录与仓库可达跳过，本地工单目录单独失败。 */
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
    row({
      id: 'local-issues',
      status: 'fail',
      detail: '工作区里没有 .scratch 目录',
      remedy: { code: 'place-local-issues', subject: null },
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
