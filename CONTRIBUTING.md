# 参与开发

## 准备环境

- Node 24（版本写在 `.nvmrc`，用 fnm 或 nvm 切换：`fnm use`）；
- pnpm 11（`corepack enable` 后会按 `package.json` 的 `packageManager` 自动使用）。

```bash
pnpm install   # 装依赖，同时装好 git 钩子
```

## 常用命令

| 命令              | 作用                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------ |
| `pnpm check`      | **合并前必须跑通的唯一检查**：格式、lint、类型、依赖方向、文件大小、单元测试与覆盖率 |
| `pnpm build`      | 构建到 `lib/`（产物不进仓库）                                                        |
| `pnpm test:watch` | 开发时监听运行测试                                                                   |
| `pnpm format`     | 格式化全部文件                                                                       |

## 目录分层

| 目录           | 放什么                           | 能依赖谁                                                  |
| -------------- | -------------------------------- | --------------------------------------------------------- |
| `src/core`     | 纯业务逻辑，不做 IO              | 只能依赖自己；可用 `import type` 引用 `protocol` 的纯类型 |
| `src/adapters` | 对接外部系统，每个后端一个子目录 | `core`                                                    |
| `src/host`     | DSH 服务端入口，负责组装         | `core`、`adapters`、`protocol`                            |
| `src/client`   | 界面（React，由宿主提供）        | `protocol`                                                |
| `src/protocol` | 服务端与界面之间的消息类型和常量 | 不依赖其他目录                                            |

依赖方向由 `pnpm check` 里的 dependency-cruiser 检查，规则见 `.dependency-cruiser.json`。

## 写测试

- 测试和源码放在一起：`foo.ts` 旁边放 `foo.test.ts`；界面测试自动跑在 jsdom 里；
- 测试名描述行为，例如「标签冲突时以远端为准」，不写工单编号；
- 修 bug 先写一个能复现的失败测试，再修。

## 提交

提交标题格式：`<类型>(<范围>): <中文描述>`，例如：

```
feat(tracker): GitLab 后端支持同步标签颜色
fix(client): 面板刷新时不再丢失滚动位置
```

类型用 `feat`、`fix`、`refactor`、`test`、`docs`、`chore`、`build` 等。提交时钩子会自动格式化、lint 暂存的文件。

## 发布

1. 在 main 上用 `pnpm version <patch|minor|major>` 更新版本号，它会提交并打上 `v<版本号>` 标签；
2. `git push --follow-tags` 推送标签后，GitHub Actions 通过 npm Trusted Publishing 发布。

完整的规范见各层 `README.md` 与 `.dependency-cruiser.json`。
