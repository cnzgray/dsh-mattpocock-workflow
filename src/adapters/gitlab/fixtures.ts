/**
 * 录制自 GitLab REST API 的固定输出，测试不连网络。
 * 项目路径带嵌套 group，覆盖开放、阻塞、已关闭三类工单。
 */

export const GITLAB_REMOTES_OUTPUT = [
  'origin\tgit@gitlab.com:cnzgray/platform/dsh-workflow.git (fetch)',
  'origin\tgit@gitlab.com:cnzgray/platform/dsh-workflow.git (push)',
].join('\n')

/** 构造一张 GitLab issue 的 JSON 对象。 */
export function gitlabIssue(overrides: {
  readonly iid: number
  readonly title: string
  readonly state?: 'opened' | 'closed'
  readonly labels?: readonly string[]
  readonly description?: string
  readonly createdAt?: string
  readonly updatedAt?: string
}): Record<string, unknown> {
  return {
    iid: overrides.iid,
    title: overrides.title,
    state: overrides.state ?? 'opened',
    labels: overrides.labels ?? [],
    description: overrides.description ?? '',
    created_at: overrides.createdAt ?? '2026-11-12T14:11:22Z',
    updated_at: overrides.updatedAt ?? '2026-11-12T14:11:38Z',
  }
}

/** 把 issue 列表序列化成 `glab api` 的一页输出。 */
export function issuesJson(issues: readonly Record<string, unknown>[]): string {
  return JSON.stringify(issues)
}

export const GITLAB_ISSUES = [
  gitlabIssue({
    iid: 15,
    title: '右侧栏任务面板 MVP',
    labels: ['enhancement', 'ready-for-agent'],
    createdAt: '2026-11-12T14:11:22Z',
    updatedAt: '2026-11-21T14:11:38Z',
  }),
  gitlabIssue({
    iid: 16,
    title: 'GitLab 工单后端',
    labels: ['enhancement', 'ready-for-agent'],
    description: '## 目标\n\n在 GitLab 仓库里读取工单。',
    createdAt: '2026-11-12T14:14:07Z',
    updatedAt: '2026-11-20T09:15:00Z',
  }),
  gitlabIssue({
    iid: 9,
    title: '整理术语表',
    state: 'closed',
    labels: ['needs-triage'],
    createdAt: '2026-11-10T09:00:00Z',
    updatedAt: '2026-11-11T09:30:00Z',
  }),
]

export const GITLAB_ISSUES_OUTPUT = issuesJson(GITLAB_ISSUES)

/** iid → `/issues/:iid/links` 的录制响应。 */
export const GITLAB_LINKS = new Map<number, string>([
  [15, JSON.stringify([{ iid: 7, state: 'closed', link_type: 'is_blocked_by' }])],
  [
    16,
    JSON.stringify([
      { iid: 15, state: 'opened', link_type: 'is_blocked_by' },
      { iid: 7, state: 'closed', link_type: 'is_blocked_by' },
      { iid: 8, state: 'opened', link_type: 'relates_to' },
    ]),
  ],
])

/** 批量 GraphQL 查询的录制响应：`blockedByCount` 只统计未关闭的阻塞票。 */
export const GITLAB_BLOCKED_BY_OUTPUT = JSON.stringify({
  data: {
    project: {
      issues: {
        nodes: [
          { iid: '15', blockedByCount: 0 },
          { iid: '16', blockedByCount: 1 },
        ],
      },
    },
  },
})
