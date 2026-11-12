// 提交标题格式：<类型>(<范围>): <中文描述>，例如 feat(tracker): GitLab 后端支持同步标签颜色。
// 中文没有大小写，所以关掉描述大小写的规则。
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'subject-case': [0],
    'header-max-length': [2, 'always', 100],
    'subject-min-length': [2, 'always', 6],
  },
}
