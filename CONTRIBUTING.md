# 参与开发

## 准备环境

- Node 24（版本写在 `.nvmrc`，用 fnm 或 nvm 切换：`fnm use`）；
- pnpm 11（`corepack enable` 后会按 `package.json` 的 `packageManager` 自动使用）。

```bash
pnpm install   # 装依赖，跑一次构建，并装好 git 钩子
```

## 常用命令

| 命令              | 作用                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------ |
| `pnpm check`      | **合并前必须跑通的唯一检查**：格式、lint、类型、依赖方向、文件大小、单元测试与覆盖率 |
| `pnpm build`      | 构建到 `lib/`（产物不进仓库）                                                        |
| `pnpm dev`        | 开发模式：监听宿主与客户端构建，原地覆盖 `lib/`，保存即刷新（见下文）                |
| `pnpm test:watch` | 开发时监听运行测试                                                                   |
| `pnpm format`     | 格式化全部文件                                                                       |

## 开发模式（保存即刷新）

`pnpm dev` 用一个进程同时监听宿主与客户端构建，原地覆盖 `lib/` 里的产物。它不删除产物目录：
宿主 HMR 只订阅 `change` 事件，客户端 HMR 按 bundle 的 mtime/ctime/size 轮询，删掉重建两边都看不到。

### 前提

1. **把本 checkout 装进 desktop profile。** 在 Desktop 的插件页把本仓库作为本地插件安装；等价于在
   profile 目录执行 `pnpm add link:<本仓库绝对路径>`。`pnpm dev` 启动时会检查
   `~/.dsh/profiles/desktop/node_modules/@cnzgray/dsh-mattpocock-workflow` 并提示；profile 不在默认位置时用
   `DSH_PROFILE_DIR=<profile 目录> pnpm dev`。
2. **把 HMR 配置贴进 desktop profile 的 `cordis.patch.yml`。** `pnpm dev` 会打印现成片段：
   `hmr.root` 指向本 checkout 的 `lib/`（构建产物目录，不是源码目录），`client-hmr.pollIntervalMs`
   设为 100。片段带“仅开发期使用”的注释，不要提交；patch 替换整行的 `config`，不做深合并。

### 会发生什么

| 改动位置                                        | 结果                                               |
| ----------------------------------------------- | -------------------------------------------------- |
| `src/client/**`                                 | 客户端 bundle 重建，面板整块重载（React 状态重置） |
| `src/host/**`、`src/core/**`、`src/adapters/**` | 宿主产物重建，插件自动重启并加载新代码             |
| `src/protocol/**`                               | 两侧都重建；面板整块重载后才拿到新的常量与类型     |
| `package.json`（`dsh.client`、`exports` 等）    | 不会热生效，需要重启 Desktop 或重新加载插件条目    |

能力边界：

- 这是整块 bundle 重载，不是模块级 HMR；面板里的筛选、排序、滚动等 React 状态会丢，需要保留就由插件
  自己外置；
- 构建失败时终端给出文件、行号和原因，`lib/` 保留上一次成功产物，正在运行的面板不受影响；
- 没有 Vite 式错误覆盖层，也没有独立 dev server；
- 客户端产物带同目录的 `lib/client.js.map`，DevTools 能定位到 TS/TSX；宿主不生成 source map
  （宿主进程没有以 source map 模式启动）；
- 只改 source map 不会触发重载，要等一次 bundle 变更或刷新页面。

### Desktop 手动验收

改过构建管线后，按这份清单在 Desktop 里过一遍：

1. 保存一个客户端文件，面板在一个轮询周期内整块更新，不刷新页面、不重启 Desktop；
2. 保存一个宿主文件，插件自动重启，新代码生效；
3. 故意写一个语法错误：终端给出文件、行号和原因，面板保持旧版本；改回后自动恢复；
4. `Ctrl-C` 退出 `pnpm dev`，确认没有残留 node 进程，`lib/` 里是最后一次成功的产物。

### 开发结束

1. `Ctrl-C` 停止 `pnpm dev`；
2. 从 desktop profile 的 `cordis.patch.yml` 删除 `hmr` 与 `client-hmr` 两段开发期配置，避免 Desktop
   长期监听这个 checkout 并每 100ms 轮询；
3. 不再开发时，把插件从 desktop profile 移除。

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
2. `git push --follow-tags` 推送标签。GitHub Actions 依次构建、`pnpm pack` 出 tarball、创建 GitHub Release，
   再把 **同一份 tarball** 发布到 npm；
3. 用户可按包名安装（npm）、用 `github:` 从 Git 安装，或下载 Release 上的 tarball 离线留存。

npm 那一步在 Release 之后：它失败不会挡住 Release，重跑同一个 tag 即可补齐。工作流不跑测试套件：
合并前的唯一门禁仍是本地 `pnpm check`。构建、打包或 npm 发布失败时工作流直接失败，不会产出半成品。

想先在本地看产物：

```bash
pnpm build
pnpm pack --pack-destination dist
npm publish dist/*.tgz --dry-run --offline --json   # 看 npm 会发布哪些文件
```

`pnpm pack` 会跑一次 `prepare`（构建 + 尽力安装 git 钩子），所以 tarball 里一定有 `lib/`。发行契约测试
`scripts/release-contract.test.ts` 会把 tarball 真装进空目录、导入它，并让 npm 以 dry-run 确认它接受同一份
tarball。

### npm 首次发布（一次性人工前置）

仓库转公开后按顺序做一次：

1. npm 账号开启 2FA；
2. 确认 scope `@cnzgray` 属于你（与 npm 用户名同名即已存在；否则先建组织）；
3. 本地首次发布，把包名占住：`npm login` 后 `npm publish dist/*.tgz`（只用一次，不要把 token 写进仓库；
   带 scope 的包靠 `publishConfig.access = public` 才公开）；
4. 在 npmjs.com 该包的 Settings → Trusted Publisher 里加 GitHub Actions：组织/用户 `cnzgray`、仓库
   `dsh-mattpocock-workflow`、workflow `release.yml`，并允许 `npm publish`；
5. 之后每个 tag 由 CI 用 OIDC 发布，provenance 自动生成，仓库与 npm 都不存长期 token。

注意：新建的 Trusted Publisher 配置要在 2 天内完成首次成功发布，否则过期需删除重建；npm CLI 需
11.5.1 以上（随 Node 24 安装的版本已满足）。只想让 CI 发布、不允许本地 token 时，可在此后把包的
Publishing access 设为「要求 2FA 并禁止 token」。

### 命名与身份

安装身份（`package.json` 的 `name`，当前是 `@cnzgray/dsh-mattpocock-workflow`）跟着包名走：组合包 patch 的
`id` / `name`、三个 `PLUGIN_NAME`、`MESSAGES_NAMESPACE` 必须与它一致；发行契约测试会校验安装后的 `name`
导出、客户端 bundle id 与 patch 行。

用户状态键故意**不跟包名走**，改名时保持原值，避免丢数据或留下孤儿状态：

| 键                    | 位置                                | 保持原值的理由               |
| --------------------- | ----------------------------------- | ---------------------------- |
| `TAB_ID` / `TAB_KIND` | `src/client/index.tsx`              | 已保存的右栏页签按 kind 归属 |
| `KEY_PREFIX`          | `src/client/view-preference.ts`     | 浏览器里已保存的筛选与排序   |
| `DIRECTORY_NAME`      | `src/adapters/fs/snapshot-store.ts` | 本地快照缓存目录             |
| `RPC_PATH`            | `src/protocol/tracker.ts`           | 宿主与界面共用的内部路由     |

真要改这些状态键，等于一次数据迁移：旧缓存目录、旧视图偏好和旧页签都要手动清掉，并在 README 里写明。

### 首次发版前的人工前置

- 仓库转公开；
- 按上一节完成 npm 首次发布与 Trusted Publisher 配置。

完整的规范见各层 `README.md` 与 `.dependency-cruiser.json`。
