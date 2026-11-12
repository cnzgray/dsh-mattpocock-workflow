/**
 * 录制自 gh 2.102 的固定输出，测试不连网络。
 * 覆盖可接、阻塞、其他开放、已关闭四类，以及 bug/enhancement 两种分类。
 */

export const GIT_REMOTES_OUTPUT = [
  'origin\tgit@github.com:cnzgray/dsh-mattpocock-workflow.git (fetch)',
  'origin\tgit@github.com:cnzgray/dsh-mattpocock-workflow.git (push)',
].join('\n')

const RECORDED_ISSUES = {
  data: {
    repository: {
      issues: {
        totalCount: 30,
        nodes: [
          {
            number: 15,
            title: '右侧栏任务面板 MVP',
            state: 'OPEN',
            createdAt: '2026-11-12T14:11:22Z',
            updatedAt: '2026-11-12T14:11:38Z',
            labels: { nodes: [{ name: 'enhancement' }, { name: 'ready-for-agent' }] },
            issueDependenciesSummary: { blockedBy: 0 },
          },
          {
            number: 16,
            title: '工单后端新增 Gitea 支持',
            state: 'OPEN',
            createdAt: '2026-11-12T14:14:07Z',
            updatedAt: '2026-11-12T14:14:19Z',
            labels: { nodes: [{ name: 'enhancement' }, { name: 'ready-for-agent' }] },
            issueDependenciesSummary: { blockedBy: 1 },
          },
          {
            number: 12,
            title: '刷新后列表没有回到顶部',
            state: 'OPEN',
            createdAt: '2026-11-11T09:00:00Z',
            updatedAt: '2026-11-12T08:00:00Z',
            labels: { nodes: [{ name: 'bug' }] },
            issueDependenciesSummary: { blockedBy: 0 },
          },
          {
            number: 9,
            title: '整理术语表',
            state: 'OPEN',
            createdAt: '2026-11-10T09:00:00Z',
            updatedAt: '2026-11-10T09:30:00Z',
            labels: { nodes: [{ name: 'needs-triage' }] },
            issueDependenciesSummary: { blockedBy: 0 },
          },
          {
            number: 7,
            title: '初始化工程',
            state: 'CLOSED',
            createdAt: '2026-11-01T09:00:00Z',
            updatedAt: '2026-11-02T09:00:00Z',
            labels: { nodes: [{ name: 'bug' }, { name: 'ready-for-agent' }] },
            issueDependenciesSummary: { blockedBy: 2 },
          },
        ],
      },
    },
  },
}

export const GH_ISSUES_OUTPUT = JSON.stringify(RECORDED_ISSUES, null, 2)
