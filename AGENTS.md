# AGENTS.md

DSH 插件，用 TypeScript 写，pnpm 管理，Node 24。规范全文见 `docs/adr/0001-engineering-standards.md`。

## 命令

- 合并前唯一要跑通的检查：`pnpm check`。它通过即可合并，没有其他门禁。
- 构建：`pnpm build`（产物在 `lib/`，不进仓库）。
- 单个测试：`pnpm vitest run <路径>`。

## 目录分层

`core`（纯逻辑）← `adapters`（外部系统）← `host`（服务端组装）；`client`（界面）只依赖 `protocol`（消息类型）。依赖方向由 dependency-cruiser 检查，违反时 `pnpm check` 失败。各层的约定写在各自目录的 README.md 里。

## 硬性规定

- 只写 TypeScript，不新增手写 `.js`；导入写 `.ts` 后缀；
- 测试和源码放在一起，测试名描述行为，不写工单编号；
- 不提交构建产物、临时文件或超过 1 MB 的文件；
- 提交标题：`<类型>(<范围>): <中文描述>`；
- 不改写 git 历史，不 force push。

能用工具检查的规则不写在这里：改 lint、依赖规则或测试配置，而不是往本文件加条目。

## Issue tracker, triage labels and domain docs

### Issue tracker

issue 和 spec 放在 GitHub Issues（`cnzgray/dsh-mattpocock-workflow`），用 `gh` 操作。见 `docs/agents/issue-tracker.md`。

### Triage labels

使用默认标签：状态标签 `needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`，分类标签 `bug` / `enhancement`。见 `docs/agents/triage-labels.md`。

### Domain docs

single-context：根目录 `GLOSSARY.md`（按需创建）加 `docs/adr/`。见 `docs/agents/domain.md`。
