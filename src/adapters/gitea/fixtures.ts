/**
 * 录制自 `tea api --include` 的固定输出，测试不连网络。
 * 仓库在自建实例 `gitea.example.com` 上，覆盖开放、阻塞、已关闭三类工单。
 */

export const GITEA_REMOTES_OUTPUT = [
  'origin\tgit@gitea.example.com:cnzgray/dsh-workflow.git (fetch)',
  'origin\tgit@gitea.example.com:cnzgray/dsh-workflow.git (push)',
].join('\n')

/** `tea api --include` 写到标准错误的响应头。 */
export function includeHeaders(options: {
  readonly status?: number
  readonly total?: number
}): string {
  const status = options.status ?? 200
  const reason = STATUS_TEXT[status] ?? 'OK'
  const lines = [`HTTP/2.0 ${String(status)} ${reason}`]
  lines.push('Content-Type: application/json;charset=utf-8')
  if (options.total !== undefined) lines.push(`X-Total-Count: ${String(options.total)}`)
  return `${lines.join('\n')}\n`
}

const STATUS_TEXT: Readonly<Record<number, string>> = {
  200: 'OK',
  204: 'No Content',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  500: 'Internal Server Error',
}

/** 一次 `tea api` 调用的标准输出与标准错误。 */
export interface RecordedApiCall {
  readonly stdout: string
  readonly stderr: string
}

/**
 * 构造一次成功的 `tea api --include` 调用输出。
 * @param body - 响应体，会被序列化成 JSON。
 * @param total - 响应头里的总条数。
 * @returns 录制结果。
 */
export function apiCall(body: unknown, total?: number): RecordedApiCall {
  return {
    stdout: JSON.stringify(body),
    stderr: includeHeaders(total === undefined ? {} : { total }),
  }
}

/**
 * 构造一次失败的 `tea api --include` 调用输出。`tea` 在非 2xx 时仍以 0 退出，
 * 状态码只能从标准错误的响应头里读。
 * @param status - HTTP 状态码。
 * @param message - 响应体里的错误消息。
 * @returns 录制结果。
 */
export function failedApiCall(status: number, message: string): RecordedApiCall {
  return {
    stdout: JSON.stringify({ message }),
    stderr: includeHeaders({ status }),
  }
}

/** 构造一张 Gitea issue 的 JSON 对象。 */
export function giteaIssue(overrides: {
  readonly number: number
  readonly title: string
  readonly state?: 'open' | 'closed'
  readonly labels?: readonly string[]
  readonly body?: string
  readonly createdAt?: string
  readonly updatedAt?: string
  readonly pullRequest?: boolean
}): Record<string, unknown> {
  const issue: Record<string, unknown> = {
    id: overrides.number,
    number: overrides.number,
    title: overrides.title,
    state: overrides.state ?? 'open',
    labels: (overrides.labels ?? []).map((name, index) => ({
      id: index + 1,
      name,
      color: 'ededed',
    })),
    body: overrides.body ?? '',
    created_at: overrides.createdAt ?? '2026-11-12T14:11:22Z',
    updated_at: overrides.updatedAt ?? '2026-11-12T14:11:38Z',
  }
  if (overrides.pullRequest === true) {
    issue.pull_request = { merged: false, merged_at: null }
  }
  return issue
}

export const GITEA_ISSUES = [
  giteaIssue({
    number: 15,
    title: '右侧栏任务面板 MVP',
    labels: ['enhancement', 'ready-for-agent'],
    createdAt: '2026-11-12T14:11:22Z',
    updatedAt: '2026-11-21T14:11:38Z',
  }),
  giteaIssue({
    number: 16,
    title: 'Gitea 工单后端',
    labels: ['enhancement', 'ready-for-agent'],
    body: '## 目标\n\n在 Gitea 仓库里读取工单。',
    createdAt: '2026-11-12T14:14:07Z',
    updatedAt: '2026-11-20T09:15:00Z',
  }),
  giteaIssue({
    number: 9,
    title: '整理术语表',
    state: 'closed',
    labels: ['needs-triage'],
    createdAt: '2026-11-10T09:00:00Z',
    updatedAt: '2026-11-11T09:30:00Z',
  }),
]

export const GITEA_ISSUES_OUTPUT = apiCall(GITEA_ISSUES, GITEA_ISSUES.length)

/** 工单编号 → `/issues/:index/dependencies` 的录制响应。 */
export const GITEA_DEPENDENCIES = new Map<number, RecordedApiCall>([
  [15, apiCall([giteaIssue({ number: 7, title: '初始化工程', state: 'closed' })], 1)],
  [
    16,
    apiCall(
      [
        giteaIssue({ number: 15, title: '右侧栏任务面板 MVP' }),
        giteaIssue({ number: 7, title: '初始化工程', state: 'closed' }),
      ],
      2,
    ),
  ],
])

/** `tea logins list --output json` 的录制输出：仓库所在实例已登录。 */
export const GITEA_LOGINS_OUTPUT = JSON.stringify([
  {
    name: 'gitea',
    url: 'https://gitea.example.com',
    ssh_host: 'gitea.example.com',
    user: 'someone',
    default: true,
  },
  {
    name: 'work',
    url: 'https://git.example.com:3000/',
    ssh_host: 'git.example.com',
    user: 'dev',
    default: false,
  },
])

/** 构造 `/repos/:owner/:repo/issues/:index` 的详情对象。 */
export function giteaIssueDetail(overrides: {
  readonly number: number
  readonly title: string
  readonly state?: 'open' | 'closed'
  readonly labels?: readonly string[]
  readonly assignees?: readonly string[]
  readonly author?: string
  readonly body?: string
  readonly htmlUrl?: string
  readonly createdAt?: string
  readonly updatedAt?: string
}): Record<string, unknown> {
  return {
    number: overrides.number,
    title: overrides.title,
    state: overrides.state ?? 'open',
    labels: (overrides.labels ?? []).map((name, index) => ({ id: index + 1, name })),
    assignees: (overrides.assignees ?? []).map((login, index) => ({ id: index + 1, login })),
    user: { id: 1, login: overrides.author ?? 'dave' },
    body: overrides.body ?? '',
    html_url:
      overrides.htmlUrl ??
      `https://gitea.example.com/cnzgray/dsh-workflow/issues/${String(overrides.number)}`,
    created_at: overrides.createdAt ?? '2026-11-12T14:11:22Z',
    updated_at: overrides.updatedAt ?? '2026-11-13T10:00:00Z',
  }
}

/** 构造一条 Gitea 评论。 */
export function giteaComment(overrides: {
  readonly login: string
  readonly body: string
  readonly createdAt: string
}): Record<string, unknown> {
  return {
    id: 1,
    user: { login: overrides.login },
    body: overrides.body,
    created_at: overrides.createdAt,
  }
}

export const GITEA_COMMENTS = [
  giteaComment({ login: 'bob', body: '补充验收标准', createdAt: '2026-11-13T09:00:00Z' }),
  giteaComment({ login: 'carol', body: '上一次失败的原因', createdAt: '2026-11-13T10:00:00Z' }),
]

/** 标签分两页返回，总条数由 `X-Total-Count` 给出。 */
export const GITEA_LABEL_PAGES = new Map<number, RecordedApiCall>([
  [
    1,
    apiCall(
      [
        { id: 1, name: 'bug', color: 'd73a4a', description: "Something isn't working" },
        { id: 2, name: 'enhancement', color: 'A2EEEF', description: '' },
      ],
      4,
    ),
  ],
  [
    2,
    apiCall(
      [
        { id: 3, name: 'needs-triage', color: '', description: '需要分诊' },
        { id: 4, name: 'bug', color: '000000', description: '重复标签' },
      ],
      4,
    ),
  ],
])

/** `/repos/:owner/:repo/assignees` 的录制输出：full_name 为空串时显示名为 null。 */
export const GITEA_ASSIGNEES_OUTPUT = apiCall([
  { id: 1, login: 'alice', full_name: 'Alice' },
  { id: 2, login: 'bob', full_name: '' },
  { id: 3, login: 'alice', full_name: 'Alice Again' },
])

/** `/repos/:owner/:repo` 的录制输出：当前用户是仓库管理员。 */
export const GITEA_REPO_PERMISSION_OUTPUT = apiCall({ permissions: { admin: true } })
