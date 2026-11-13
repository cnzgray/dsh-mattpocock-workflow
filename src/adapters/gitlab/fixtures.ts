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
  readonly closedAt?: string
  readonly author?: Record<string, unknown> | null
}): Record<string, unknown> {
  return {
    iid: overrides.iid,
    title: overrides.title,
    state: overrides.state ?? 'opened',
    labels: overrides.labels ?? [],
    description: overrides.description ?? '',
    author:
      overrides.author === undefined
        ? {
            username: 'cnzgray',
            name: 'Cnzgray',
            avatar_url: 'https://gitlab.com/uploads/-/system/user/avatar/1/avatar.png',
          }
        : overrides.author,
    created_at: overrides.createdAt ?? '2026-11-12T14:11:22Z',
    updated_at: overrides.updatedAt ?? '2026-11-12T14:11:38Z',
    closed_at: overrides.closedAt ?? null,
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
    closedAt: '2026-11-11T10:00:00Z',
  }),
]

export const GITLAB_ISSUES_OUTPUT = issuesJson(GITLAB_ISSUES)

/**
 * 增量查询的录制输出：只回窗口内变更过的票。
 * 这张票的正文里写了 `Blocked by:`，用来验证增量不做阻塞加工。
 */
export const GITLAB_CHANGES_OUTPUT = issuesJson([
  gitlabIssue({
    iid: 16,
    title: 'GitLab 工单后端',
    labels: ['enhancement', 'ready-for-agent'],
    description: 'Blocked by: #15\n',
    createdAt: '2026-11-12T14:14:07Z',
    updatedAt: '2026-11-21T09:15:00Z',
  }),
])

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
/** 构造 `/projects/:id/issues/:iid` 的详情对象。 */
export function gitlabIssueDetail(overrides: {
  readonly iid: number
  readonly title: string
  readonly state?: 'opened' | 'closed'
  readonly labels?: readonly string[]
  readonly assignees?: readonly string[]
  readonly author?: string
  readonly description?: string
  readonly webUrl?: string
  readonly createdAt?: string
  readonly updatedAt?: string
}): Record<string, unknown> {
  return {
    iid: overrides.iid,
    title: overrides.title,
    state: overrides.state ?? 'opened',
    labels: overrides.labels ?? [],
    assignees: (overrides.assignees ?? []).map((username) => ({ username, name: username })),
    author: { username: overrides.author ?? 'dave', name: overrides.author ?? 'dave' },
    description: overrides.description ?? '',
    web_url:
      overrides.webUrl ??
      `https://gitlab.com/cnzgray/platform/dsh-workflow/-/issues/${String(overrides.iid)}`,
    created_at: overrides.createdAt ?? '2026-11-12T14:11:22Z',
    updated_at: overrides.updatedAt ?? '2026-11-13T10:00:00Z',
  }
}

/** 构造一条 GitLab note；`system` 为 true 的是事件而不是评论。 */
export function gitlabNote(overrides: {
  readonly username: string
  readonly body: string
  readonly createdAt: string
  readonly system?: boolean
}): Record<string, unknown> {
  return {
    id: 1,
    system: overrides.system ?? false,
    body: overrides.body,
    author: { username: overrides.username, name: overrides.username },
    created_at: overrides.createdAt,
  }
}

export const GITLAB_NOTES = [
  gitlabNote({ username: 'bob', body: '补充验收标准', createdAt: '2026-11-13T09:00:00Z' }),
  gitlabNote({
    username: 'alice',
    body: 'changed the description',
    createdAt: '2026-11-13T09:30:00Z',
    system: true,
  }),
  gitlabNote({ username: 'carol', body: '上一次失败的原因', createdAt: '2026-11-13T10:00:00Z' }),
]

export const GITLAB_NOTES_OUTPUT = issuesJson(GITLAB_NOTES)

/** `/projects/:id/labels` 的录制输出：颜色带 `#`，description 可能是空串。 */
export const GITLAB_LABELS_OUTPUT = JSON.stringify([
  { name: 'bug', color: '#d73a4a', description: "Something isn't working" },
  { name: 'enhancement', color: '#A2EEEF', description: '' },
  { name: 'needs-triage', color: null, description: '需要分诊' },
])

/** `/projects/:id/members/all` 的录制输出：只保留 active 或没有 state 的成员。 */
export const GITLAB_MEMBERS_OUTPUT = JSON.stringify([
  { username: 'alice', name: 'Alice', state: 'active' },
  { username: 'bob', name: 'Bob' },
  { username: 'carol', name: 'Carol', state: 'blocked' },
  { username: 'alice', name: 'Alice Again', state: 'active' },
])

/** `/projects/:id` 的录制输出：项目 Owner（access_level 50）。 */
export const GITLAB_PROJECT_OUTPUT = JSON.stringify({
  permissions: {
    project_access: { access_level: 50 },
    group_access: null,
  },
})
