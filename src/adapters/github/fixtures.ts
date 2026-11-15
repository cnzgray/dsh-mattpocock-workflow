/**
 * 录制自 gh 2.102 的固定输出，测试不连网络。
 * 覆盖可接、阻塞、其他开放、已关闭四类，以及 bug/enhancement 两种分类。
 */

export const GIT_REMOTES_OUTPUT = [
  'origin\tgit@github.com:cnzgray/dsh-mattpocock-workflow.git (fetch)',
  'origin\tgit@github.com:cnzgray/dsh-mattpocock-workflow.git (push)',
].join('\n')

const AUTHOR = {
  login: 'cnzgray',
  name: 'Cnzgray',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1234?v=4',
}

const RECORDED_ISSUES = {
  data: {
    repository: {
      issues: {
        totalCount: 30,
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [
          {
            number: 15,
            title: '右侧栏任务面板 MVP',
            state: 'OPEN',
            createdAt: '2026-11-12T14:11:22Z',
            updatedAt: '2026-11-12T14:11:38Z',
            labels: { nodes: [{ name: 'enhancement' }, { name: 'ready-for-agent' }] },
            author: AUTHOR,
            issueDependenciesSummary: { blockedBy: 0 },
          },
          {
            number: 16,
            title: '工单后端新增 Gitea 支持',
            state: 'OPEN',
            createdAt: '2026-11-12T14:14:07Z',
            updatedAt: '2026-11-12T14:14:19Z',
            labels: { nodes: [{ name: 'enhancement' }, { name: 'ready-for-agent' }] },
            author: AUTHOR,
            issueDependenciesSummary: { blockedBy: 1 },
          },
          {
            number: 12,
            title: '刷新后列表没有回到顶部',
            state: 'OPEN',
            createdAt: '2026-11-11T09:00:00Z',
            updatedAt: '2026-11-12T08:00:00Z',
            labels: { nodes: [{ name: 'bug' }] },
            author: AUTHOR,
            issueDependenciesSummary: { blockedBy: 0 },
          },
          {
            number: 9,
            title: '整理术语表',
            state: 'OPEN',
            createdAt: '2026-11-10T09:00:00Z',
            updatedAt: '2026-11-10T09:30:00Z',
            labels: { nodes: [{ name: 'needs-triage' }] },
            author: AUTHOR,
            issueDependenciesSummary: { blockedBy: 0 },
          },
          {
            number: 7,
            title: '初始化工程',
            state: 'CLOSED',
            createdAt: '2026-11-01T09:00:00Z',
            updatedAt: '2026-11-02T09:00:00Z',
            closedAt: '2026-11-02T09:30:00Z',
            labels: { nodes: [{ name: 'bug' }, { name: 'ready-for-agent' }] },
            author: AUTHOR,
            issueDependenciesSummary: { blockedBy: 2 },
          },
        ],
      },
    },
  },
}

export const GH_ISSUES_OUTPUT = JSON.stringify(RECORDED_ISSUES, null, 2)

/** 构造 `gh issue view --json` 的详情对象。 */
export function ghIssueDetail(overrides: {
  readonly number: number
  readonly title: string
  readonly body?: string
  readonly state?: 'OPEN' | 'CLOSED'
  readonly author?: string
  readonly labels?: readonly string[]
  readonly assignees?: readonly string[]
  readonly comments?: readonly {
    readonly author: string
    readonly body: string
    readonly createdAt: string
  }[]
  readonly url?: string
  readonly createdAt?: string
  readonly updatedAt?: string
}): Record<string, unknown> {
  return {
    number: overrides.number,
    title: overrides.title,
    body: overrides.body ?? '',
    state: overrides.state ?? 'OPEN',
    author: { login: overrides.author ?? 'dave' },
    labels: (overrides.labels ?? []).map((name) => ({ name, color: 'ededed' })),
    assignees: (overrides.assignees ?? []).map((login) => ({ login, name: login })),
    comments: (overrides.comments ?? []).map((comment) => ({
      author: { login: comment.author },
      body: comment.body,
      createdAt: comment.createdAt,
    })),
    url: overrides.url ?? '',
    createdAt: overrides.createdAt ?? '2026-11-12T14:11:22Z',
    updatedAt: overrides.updatedAt ?? '2026-11-13T10:00:00Z',
  }
}

export const GH_ISSUE_DETAIL = ghIssueDetail({
  number: 15,
  title: '右侧栏任务面板 MVP',
  body: '## 目标\n\n在面板里看工单。',
  labels: ['enhancement', 'ready-for-agent'],
  assignees: ['alice'],
  comments: [
    { author: 'bob', body: '补充验收标准', createdAt: '2026-11-13T09:00:00Z' },
    { author: 'carol', body: '上一次失败的原因', createdAt: '2026-11-13T10:00:00Z' },
  ],
  url: 'https://github.com/cnzgray/dsh-mattpocock-workflow/issues/15',
})

/** `gh label list --json name,color,description` 的录制输出。 */
export const GH_LABELS_OUTPUT = JSON.stringify([
  { name: 'bug', color: 'd73a4a', description: "Something isn't working" },
  { name: 'enhancement', color: 'A2EEEF', description: '' },
  { name: 'needs-triage', color: '', description: '需要分诊' },
])

/** `gh api repos/<owner>/<name>/assignees --paginate --slurp` 的录制输出：页的数组。 */
export const GH_ASSIGNEES_OUTPUT = JSON.stringify([
  [
    { login: 'alice', id: 1 },
    { login: 'bob', id: 2 },
  ],
  [
    { login: 'carol', id: 3 },
    { login: 'alice', id: 1 },
  ],
])

/** `gh repo view --json viewerPermission` 的录制输出：仓库管理员。 */
export const GH_VIEWER_PERMISSION_OUTPUT = JSON.stringify({ viewerPermission: 'ADMIN' })
