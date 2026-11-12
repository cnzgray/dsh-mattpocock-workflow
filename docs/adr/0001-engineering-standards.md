# 0001 工程规范

- 状态：已采纳（2026-11-12）
- 背景：本仓库从零搭建。规则只写在文档里、没有工具强制，文档迟早和代码脱节；测试按工单编号组织、根目录堆积临时文件、大文件进仓库，也都会拖累维护。因此先把下列规范落成工具，再在其上开发功能。

## 0. 总原则

1. **规则由工具强制，文档只做解释。** 能用 lint、类型检查、依赖规则、提交前钩子拦住的，一律不靠写进 AGENTS.md 让人或 AI 记住。规则只写在文档里，迟早会和代码脱节。
2. **一条命令判对错。** 本地 `pnpm check` 全绿就能合并。不分档位，也不维护基线名单和棘轮名单。
3. **按模块组织，不按工单组织。** 文件名、测试名、目录名都不出现票号。
4. **简单优先。** 新增脚本、门禁或配置文件之前，先问一句：现成工具能不能做到？

## 1. 技术基线

| 项              | 选择                                                                                                                                          | 理由                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Node            | 只支持 24 LTS（`engines: ">=24.15"`），附 `.nvmrc`                                                                                            | 同时支持多条版本线，就要为它们维护文档和装载钩子。只支持一条线最省事                                      |
| 包管理          | pnpm，提交 lockfile；`pnpm-workspace.yaml` 里打开 `engineStrict`                                                                              | 沿用                                                                                                      |
| 模块格式        | 纯 ESM，`package.json` 里写 `"type": "module"`                                                                                                | 省掉 `.mts`/`.cts` 混用，也没有 `MODULE_TYPELESS_PACKAGE_JSON` 警告                                       |
| 语言            | 只写 TypeScript，仓库里不允许出现手写 `.js`                                                                                                   | 从第一天就是 TS，用不着迁移规则                                                                           |
| TypeScript 版本 | 6.0                                                                                                                                           | `typescript-eslint` 目前只支持到 6.0，类型相关的 lint 规则离不开它；等它支持 7.0 再升级                   |
| 类型检查        | `strict` 之外再打开 `noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`noImplicitOverride`、`verbatimModuleSyntax`、`isolatedModules` | 业界常见的严格配置。`isolatedModules` 保证 esbuild 和 Node 类型剥离都能正确处理                           |
| tsconfig        | 一份 `tsconfig.base.json` 放共用选项；根目录 `tsconfig.json` 管 Node 侧，`src/client/tsconfig.json` 管界面侧                                  | 界面的配置放在 `src/client` 下，ESLint 和编辑器按「离文件最近的 tsconfig.json」就能自动找到，不用手工登记 |
| 构建            | esbuild，一个构建脚本，产物进 `dist/` 并加进 `.gitignore`                                                                                     | 构建产物永远不进仓库                                                                                      |

## 2. 目录结构与依赖方向

```
src/
  core/          纯业务逻辑，不做任何 IO：工单模型、工作区快照合并、规则判定
  adapters/      对接外部系统，每个后端一个子目录
    github/  gitlab/  markdown/  git/  fs/
  host/          DSH 宿主进程入口：把 core 和 adapters 组装起来，对外注册工具
  client/        界面（React）：面板、状态栏、浮层
  protocol/      host 与 client 之间的消息类型，只放类型和常量
skills/          随插件发布的技能（中英两份）
scripts/         构建和发布脚本，越少越好
tests/
  e2e/           Playwright 端到端测试，只放少量关键流程
docs/
  adr/           架构决策记录
```

**依赖规则**（用 `dependency-cruiser` 强制）：

- `core` 不依赖任何其他目录，也不能导入 `node:fs`、`node:child_process` 这类 IO 模块；
- `adapters` 只能依赖 `core`；
- `host` 可以依赖 `core`、`adapters`、`protocol`；
- `client` 只能依赖 `protocol`，不能直接导入 `core` 或 `adapters`；
- 禁止循环依赖；同一层的子模块之间只能通过对方的 `index.ts` 导入。

这样能保证业务逻辑可以脱离 DSH 单独测试，各个工单后端也能互相替换。

## 3. 代码风格

- **格式化**：Prettier，默认配置，只改一项 `printWidth: 100`。格式问题不进代码评审，交给工具。
- **Lint**：ESLint flat config，配 `typescript-eslint` 的 `strictTypeChecked` 和 `stylisticTypeChecked` 两套规则，另外加几条：
  - 禁止 `any`、禁止非空断言 `!`；
  - 禁止默认导出（方便搜索和重命名）；
  - 单个文件超过 500 行报错，单个函数超过 80 行报错，空行和注释不计入。lint 以 `--max-warnings=0` 运行，警告和错误没有区别，所以只设一档上限；
  - 浮动的 Promise 必须处理（`no-floating-promises`）。
- **命名**：文件名统一用 kebab-case；类型和类用 PascalCase；常量用 UPPER_SNAKE_CASE。
- **注释**：写清楚为什么这样做，以及哪些约定不能改，不复述代码在做什么。公开函数要有 TSDoc。注释统一用中文。
- **错误处理**：边界层（adapters、host）抛带错误码的自定义错误类型，core 用返回值表示失败。不允许吞掉异常。

## 4. 测试

| 层                | 工具                                     | 放在哪里                                        | 要求                                                                                                              |
| ----------------- | ---------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| core 单元测试     | Vitest                                   | 和源文件放在一起：`foo.ts` 旁边放 `foo.test.ts` | 行、分支、函数覆盖率都不低于 80%，由 `pnpm check` 强制                                                            |
| adapters 契约测试 | Vitest                                   | `src/adapters/contract.test-suite.ts`           | 写**一套**共享用例，github、gitlab、markdown 三个后端都必须跑通。网络请求用录制好的响应或内存假实现，不连真实服务 |
| client 组件测试   | Vitest，环境用 jsdom，配 Testing Library | 和组件放在一起                                  | 只测交互和渲染结果，不测内部状态                                                                                  |
| 端到端            | Playwright                               | `tests/e2e/`                                    | 控制在 10 条以内，只覆盖安装、打开面板、建票、刷新这类主流程                                                      |

规则：

- 测试名描述行为，例如「标签冲突时以远端为准」，不写票号；
- 修 bug 要先写一个能复现的失败测试，再修（TDD 的红绿流程）；
- 不写读源码文本、用字符串匹配判断对错的测试（这类测试在代码换一种写法时就会误报）。

**为什么选 Vitest**：原生支持 TypeScript 和 ESM，不需要自己写装载钩子；自带 jsdom 环境、覆盖率统计和监听模式，一个工具就够了，不需要自己维护装载钩子或测试调度脚本。

## 5. 质量门禁

只有一个入口：

```
pnpm check   =  prettier --check  +  eslint  +  tsc --noEmit  +  depcruise  +  vitest run --coverage
pnpm e2e     =  先构建，再跑 Playwright（耗时较长，单独执行）
```

- **裁决口径**：只信本地。合并之前，在本地 Node 24 上跑通 `pnpm check`，改动涉及界面或主流程时再加跑 `pnpm e2e`。不设 CI 验证，也不额外加推送前的强制检查。
- **提交前**：用 lefthook，只对暂存的文件跑格式化和 lint，几秒钟内完成。这一步只是顺手修格式，不算裁决。

> 本地裁决能成立，靠的是两点：只支持一条 Node 版本线（见第 1 节），以及测试统一由 Vitest 加载，不需要自己写装载钩子。

## 6. Git 流程与发布

- **分支**：主干开发。功能分支要短，通过 PR 合并，合并方式用 squash，main 保持线性历史。
- **提交信息**：Conventional Commits 的类型前缀，后面接中文描述，例如 `feat(tracker): GitLab 后端支持同步标签颜色`、`fix(client): 面板刷新时不再丢失滚动位置`。有类型前缀才能自动生成更新日志；由 commit-msg 钩子里的 commitlint 检查。
- **版本与更新日志**：用 Changesets。每个 PR 附一个说明文件，发版时自动合并成 CHANGELOG 并更新版本号。
- **npm 发布**：包名 `dsh-mattpocock-workflow`。
- **发布凭证**：只给发布这一件事开一条 GitHub Actions 工作流，用 npm 的 Trusted Publishing（OIDC），不存放任何长期 token。这条工作流只负责发布，不跑验证，和上面「只信本地」的决定不冲突。
- **依赖更新**：Renovate，每周自动开一个合并好的 PR；开发依赖锁定精确版本。

## 7. 仓库卫生

- `.gitignore` 从第一天起就覆盖 `dist/`、`coverage/`、`.tmp/`、`*.log`，以及根目录的 `tmp-*`；
- 大于 1 MB 的文件不进仓库：演示视频放到 GitHub Release 附件或其他外部存储，README 里只放链接或 GIF 缩略图；`pnpm check` 里的 `scripts/check-file-size.ts` 负责拦截；
- 根目录只放配置文件和 README、LICENSE、CONTRIBUTING、AGENTS.md，其他东西都放进对应的子目录。

## 8. 日志

- 沿用 `dsh-log`。所有事件名集中定义在 `src/protocol/log-events.ts` 一个文件里，事件名用联合类型约束，写错名字编译就会报错；
- 只在三类地方记日志：跨进程边界、读写持久化数据、外部网络调用。每条都带耗时和结果；
- 令牌、授权头、口令永远不写进日志。用 lint 规则禁止把这类字段直接传给日志函数，并配一条单元测试检查日志脱敏函数。

## 9. 文档

| 文件              | 内容                                         | 上限                                       |
| ----------------- | -------------------------------------------- | ------------------------------------------ |
| `README.md`       | 是什么、怎么安装、怎么用                     | 只写给用户看的内容                         |
| `CONTRIBUTING.md` | 本地怎么跑起来、提交和发布流程               | 一页                                       |
| `AGENTS.md`       | 给 AI 看的：常用命令、目录分层、几条硬性禁令 | 100 行以内。凡是工具能强制的规则都不写进来 |
| `GLOSSARY.md`     | 业务术语表                                   | 只收本插件用到的术语                       |
| `docs/adr/`       | 架构决策，每篇一页：背景、决定、代价         | 只记不容易推翻的决定                       |

调研笔记不进仓库，确实需要的，整理成 ADR。`GLOSSARY.md` 在开发第一个业务模块时建立。

## 10. 开发步骤

每一步完成后，`pnpm check` 都必须是绿的。

1. **搭骨架**：仓库初始化；把第 1、3、5、6 节的配置全部配好；写一个能被 DSH 加载、显示空白面板的最小插件，走通构建、安装和端到端测试。
2. **`protocol` 和 `core`**：实现纯逻辑（工单模型、工作区快照合并、规则判定），同时补齐单元测试。
3. **`adapters`**：先写共享契约测试，再依次接入 markdown、github、gitlab 三个后端。
4. **`host`**：工具注册、刷新调度、版本控制相关逻辑。
5. **`client`**：面板、状态栏、浮层。
6. **`skills`** 和发布配置，发第一个 beta 版本，到真机上验证。

**每个模块怎样才算完成**：

- 符合依赖规则；
- 测试覆盖率达标；
- 没有文件超过 800 行。

## 11. 已确认的决定（2026-11-12）

| 问题             | 决定                                                                 |
| ---------------- | -------------------------------------------------------------------- |
| Node 版本        | 只支持 24 LTS                                                        |
| 谁决定能不能合并 | 只信本地 `pnpm check`，不设 CI 验证，也不加推送前强制检查            |
| lint 与格式化    | ESLint + Prettier                                                    |
| 提交信息         | Conventional Commits 类型前缀 + 中文描述                             |
| 发布凭证         | GitHub Actions 上的 Trusted Publishing，只负责发布，不跑验证         |
| 仓库名与包名     | 都叫 `dsh-mattpocock-workflow`（2026-11-12 在 npm 上查过，未被占用） |
