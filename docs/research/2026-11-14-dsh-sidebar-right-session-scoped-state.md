# DSH 右侧栏的会话级状态：新建会话时右栏为什么收起

> 面向对象：为工单 [#43](https://github.com/cnzgray/dsh-mattpocock-workflow/issues/43)（新建会话时右侧栏自动关闭，之前会话里已打开的 MattWorkflow 页签也不保留）查清 DSH 侧的事实、可用的客户端 API 与可行落点。
> 调研日期：2026-11-14。
> 版本基线：上游 `master` commit [`39163dd`](https://github.com/deepseek-ai/deepseek-harness/commit/39163dd30f703a79079e2d2446545cff3c453738)（`dsh-v0.2.2-rc.3` 之后，2026-11-13）；本机 npm profile 装的是 `@deepseek-ai/dsh@0.2.2-rc.1`，真正渲染界面的是桌面应用 `/Applications/DeepSeek Harness.app`（`app.asar`，`0.2.2-rc.3`）。【推断】上游 `dsh-v0.2.2-rc.1` 与 `master` 的 `packages/client/ui-sidebar-right/src/client/index.ts`、`contract/slots.ts` blob SHA 相同，右栏核心实现自 rc.1 起未变，两版行为差异不来自这里。
> 引用约定：`【官方要求】`＝文档或源码明确规定；`【默认行为】`＝未配置时实际发生；`【本仓库】`＝当前仓库现状；`【推断】`＝由一手事实推导、无直接条文。
>
> 版本差异核对：`git diff dsh-v0.2.2-rc.1 HEAD -- packages/client/ui-sidebar-right` 只有 CSS、README、package.json、快捷键的模态判断与全屏宽度 1px 修正，**与展开状态无关**；结论对 rc.1 与 master 同时成立。

---

## 结论摘要

1. **右侧栏是每个会话一份的停靠面。** 状态住在 `SidebarRightState.bySession[sessionId].layout`，落盘 key 是 `dsh.sidebar-right.v1.<sessionId>`（localStorage），不同会话互不影响。来源：[`packages/client/ui-sidebar-right/src/client/stores.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/src/client/stores.ts#L42-L58)、[`persistence.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/src/client/persistence.ts#L7)、[包 README「状态」](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/README.zh.md#L66-L78)。
2. **没有任何一行代码在会话切换时把展开状态写成 false。** 收起来自默认初值 `expanded: false`（dockkit 的 `createInitialState`），而新会话没有历史 surface，就走这条初值。上游把「会话以折叠且为空的停靠面开始」写成了设计。来源：[`ui-dockkit/src/engine/initial.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-dockkit/src/engine/initial.ts#L70)、[`ui-sidebar-right/src/client/stores.ts` 的 `seat()`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/src/client/stores.ts#L268-L276)、[包 README「状态」第 72 行](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/README.zh.md#L72)。
3. **所以 #43 的现象是宿主既定设计，而不是缺陷回归。** 新会话 = 新的 `sessionId` = 新的右栏席位 = 折叠的空面；旧会话的展开状态与 MattWorkflow 页签仍留在旧会话自己的 key 里，切回旧会话会按保存的布局恢复。来源同上；【官方要求】见 [`docs/subsystems/sidebar-right.zh.md`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/docs/subsystems/sidebar-right.zh.md#L11)（每个会话恰有一个停靠面，刷新会恢复已保存的布局）与[「不做」段](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/docs/subsystems/sidebar-right.zh.md)（跨设备布局同步：各 Session 独立保存状态）。
4. **插件有可用的客户端 API。** `ctx.sidebarRight` 暴露 `openTab(kind, options?)` / `openResource(address, options?)`（docked 打开会顺带展开该列）、`isExpanded()`、`toggleExpanded()`（切换语义，非幂等）、`focus/split/float/dock/close/hide`。没有幂等的 `expand()`，也没有「全局默认展开」或「按工作区记忆展开」的配置位。来源：[`ISidebarRight` 接口](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/src/client/service.ts#L241-L295)、[`toggleExpanded()` 实现](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/src/client/service.ts#L607-L615)、[包 README「`ctx.sidebarRight`」](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/README.zh.md#L93-L105)。
5. **可选落点有三条，代价递增。** (a) 插件在新会话就绪时 `openTab` 自己的 kind：既展开右栏又直接落在 MattWorkflow 页签；(b) 只按需 `toggleExpanded()` 展开，不动页签；(c) 向上游提 issue/PR，让新会话继承上一会话的右栏展开状态（上游当前明确不做跨会话继承）。来源见第 4 节。
6. **宿主已有现成的人工恢复入口**：右栏展开快捷键 `sidebar.right.toggle`（macOS/Windows/Linux 默认 `⌘⌥B`）与右栏 chrome 上的展开按钮。来源：本机 `app.asar` 内 `ui-sidebar-right` 的快捷键注册与 `ExpandButton`（读 `state.bySession[sessionId]?.layout.expanded ?? false`）。
7. **宿主的「新建会话」会优先复用空白会话**：New Session 复用工作区内第一个未开始、未归档的空白会话，没有才新建。复用到的会话会保留自己的 layout；用户观察到「必关」，说明实际走的是**新建**分支（新的 `sessionId`、新的存储 key）。来源：本机 `app.asar` 内 `new-session-generations` 迁移说明。

---

## 1. 右侧栏的归属与状态模型

### 1.1 归属

【官方要求】右侧 Sidebar 是 Web Client 里**每个会话一份**的停靠面，保存在会话作用域的 slot store 里，由 `rightbar.session` 绘制；root 作用域的 `rightbar` 控制器为选中会话和拥有已初始化 `keepMounted` 正文的后台会话保留独立席位。来源：[`docs/subsystems/sidebar-right.zh.md`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/docs/subsystems/sidebar-right.zh.md#L11)。

包职责划分：`client/ui-sidebar-right` 拥有面板与栏席位、布局 store、`ctx.sidebarRightTabs`、`ctx.sidebarRight`、Tab 域、引导类型；`client/ui-dockkit` 是它内部的布局引擎。来源：[同上表格](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/docs/subsystems/sidebar-right.zh.md#L15-L21)。

### 1.2 状态放在哪里

【官方要求】状态结构：

- `packages/client/ui-sidebar-right/src/client/stores.ts`：每个 `sessionId` 一个 `SurfaceState`（`layout` + `history` + `minted`），聚在 `SidebarRightState.bySession` 下。来源：[`stores.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/src/client/stores.ts#L42-L58)。
- 真正的展开开关是 dockkit 的 `LayoutState.expanded: boolean`，初值写死 `expanded: false`。来源：[`ui-dockkit/src/engine/initial.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-dockkit/src/engine/initial.ts#L70)。

【默认行为】落盘：store 把每个会话的布局（含 `expanded`）以 JSON 写进 localStorage 的 `dsh.sidebar-right.v1.<sessionId>`；刷新时恢复布局，不同会话的布局独立；撤销历史只在内存里。来源：[包 README「状态」第 76 行](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/README.zh.md#L76)、[`persistence.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/src/client/persistence.ts#L7)。

【官方要求】读取与校验：实例创建时读一次该会话的 key，字段类型或引用关系非法时只清掉这一个会话的 key；此后每次该会话的 store 提交都写回。来源：[`persistence.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/src/client/persistence.ts#L28-L99)。

【默认行为】命名空间只有 `sessionId` 一维，没有工作区或用户维度；同源多窗口共享同一份已保存布局。来源：[包 README「状态」](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/README.zh.md#L76-L78)。

### 1.3 另一层「是否显示」属于 ui-layout

【官方要求】`ui-layout` 的根 store 只**记录**右栏的呈现事实（`rightbarShown` / `rightbarTrack` / `rightbarFullscreen`），不是展开状态的所有者：源码注释写明「whether the right surface is expanded is a recorded fact owned by that surface, reported here so the frame can place the panel's resize handle. The occupant reports it; nothing else writes it.」来源：[`ui-layout/src/client/stores.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-layout/src/client/stores.ts#L36-L53)、[`openRightbar` / `closeRightbar`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-layout/src/client/stores.ts#L129-L144)。

本机 `0.2.2-rc.1` 的类型产物一致：`@deepseek-ai/dsh-client-ui-layout` 的 `ILayout` 暴露 `toggleSidebar()`、`openRightbar(track, fullscreen)`、`closeRightbar()`，且注释写明右栏展开状态「belongs to its occupant」。来源：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/types/client/service.d.ts`、`.../stores.d.ts`。

---

## 2. 为什么新建会话时右栏会收起

【官方要求】**没有「会话切换 → 复位为收起」的代码。** 收起是「新会话没有 surface，走默认初值」这条链的结果：

1. 新 `sessionId` 进入 `seat()`：取不到已有 surface 就 `createSurface()`。来源：[`stores.ts` 的 `seat()`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/src/client/stores.ts#L268-L276)。
2. `createSurface()` 的初值来自 dockkit 的 `createInitialState`，其中 `expanded: false`。来源：[`initial.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-dockkit/src/engine/initial.ts#L70)。
3. 座位挂载时物化 surface（不改 `expanded`），源码注释：「Materialize a session's surface without changing it, so the first read after a session switch sees the collapsed empty column rather than nothing.」来源：[`ui-sidebar-right/src/client/stores.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/src/client/stores.ts#L333)。
4. 是否显示由本会话的 `expanded` 决定，再向 `ui-layout` 报告 `shown`：`syncPresentation` 在 `shown` 为假时调 `closeRightbar()`。来源：[`shell/SidebarRight.tsx`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/src/client/shell/SidebarRight.tsx#L400-L449)。

【官方要求】上游把这写成了设计：包 README 明说「会话以折叠且为空的停靠面开始……首次会展示空布局的那次展开才播种默认页」。来源：[包 README「状态」第 72 行](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/README.zh.md#L72)。

【官方要求】显式写 `expanded = false` 的代码路径都属于别的场景，不是会话切换：

| 场景                                    | 位置                                                                                                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 关掉最后一个 docked tab（连带收起整列） | [`stores.ts` 的 `closeTab`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/src/client/stores.ts#L437-L441)             |
| 放不下时自动收起                        | [`shell/SidebarRight.tsx`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/src/client/shell/SidebarRight.tsx#L414-L416) |
| 收掉唯一的引导页                        | [`service.ts` 的 `closeTarget`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/src/client/service.ts#L707-L712)        |
| 窄屏自动全屏                            | [`service.ts` 的 `toggleFullscreen`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/src/client/service.ts#L744-L750)   |
| `hide(tabId)` 收起停靠列                | [`service.ts` 的 `hide`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/src/client/service.ts#L574-L581)               |

【推断】把 #43 的现象翻译成宿主语言：**新建会话产生新的 `sessionId`，新会话的右栏席位从折叠空面开始；旧会话的展开状态与 MattWorkflow 页签属于旧会话，仍留在 `dsh.sidebar-right.v1.<旧 sessionId>` 里。** 用户看到的就是「新建会话后右栏自动收起，之前打开的 MattWorkflow 也没了」。切回旧会话，右栏按保存的布局恢复。

【默认行为】注册页签类型本身不影响展开：类型注册是纯静态声明（"A registration is purely static… Nothing here is per-tab, per-session, or a runtime hook"）。来源：[`tab-registry.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/src/client/tab-registry.ts#L1-L27)。真正会展开右栏的是**打开动作**：docked 打开会顺带 `planSetExpanded(state, true)`。来源：[`stores.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/src/client/stores.ts#L405-L407)、[包 README「`ctx.sidebarRight`」](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/README.zh.md#L95)。

---

## 3. 客户端插件可用的 API 面

【官方要求】`ctx.sidebarRight` 是跨插件的右栏操作面（由 `ctx.reflect.provide('sidebarRight', controller)` 暴露），`ctx.sidebarRightTabs` 是页签类型注册表。来源：[`ui-sidebar-right/src/client/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/src/client/index.ts#L182-L234)。

【官方要求】与 #43 直接相关的方法：

| 方法                                | 语义                                    | 来源                                                                                                                                                                              |
| ----------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openTab(kind, options?)`           | 打开页面类型；docked 打开会顺带展开该列 | [`service.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/src/client/service.ts#L243-L252)    |
| `openResource(address, options?)`   | 打开资源地址；同样会展开                | 同上                                                                                                                                                                              |
| `isExpanded()`                      | 只读，是否展开                          | [`service.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/src/client/service.ts#L270-L272)    |
| `toggleExpanded()`                  | **唯一的开/收开关，切换语义**           | [`service.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/src/client/service.ts#L607-L615)    |
| `focus/split/float/dock/close/hide` | 页签与布局操作                          | [`ISidebarRight`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/src/client/service.ts#L241-L295) |

【官方要求】所有写操作只作用于**当前屏幕上**的那个会话；没有已挂载的会话面时写操作抛错，读操作返回 `undefined` / `false`。来源：[`service.ts` 的 `require()`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/src/client/service.ts#L846-L857)、[包 README「`ctx.sidebarRight`」](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/README.zh.md#L103)。

【官方要求】公开面上**没有**幂等的 `expand()` / `setExpanded()`：`setExpanded` 只存在于包内 store actions，store 本身不通过 `ctx` 暴露。来源：[`stores.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/src/client/stores.ts#L334-L336)、[`index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/src/client/index.ts#L182-L183)。

【官方要求】上游明确不做跨会话布局继承：「跨设备布局同步：布局保存在浏览器本地，各 Session 独立保存状态」。来源：[`docs/subsystems/sidebar-right.zh.md`「不做」段](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/docs/subsystems/sidebar-right.zh.md)。

---

## 4. 落点候选

【本仓库】本仓库的客户端半已经只依赖 `ctx.slots` 与 `ctx.sidebarRightTabs`：注册一个 `priority: 'extension'` 的页签类型（`kind` 为 `dsh-mattpocock-workflow`）、一个 `sidebar.right.pane.tab` 正文、一个标题槽，并给该类型贡献了一个引导页入口。来源：`src/client/index.tsx` 的 `apply()`。

【本仓库】新会话注入走宿主的 `uiWorkspace.startSession(undefined, { prompt, whenDraftExists: 'append' })`：宿主负责复用空白会话、选 agent 预设并切换主界面，面板只报「已请求」。来源：`src/client/injection.ts` 与 `src/client/index.tsx` 的 `createNewSessionStarter()`。

【本仓库】面板自身的状态已经有一层本地持久化约定：视图偏好存在浏览器 localStorage，key 是 `dsh-mattpocock-workflow:view:<encodeURIComponent(工作区根路径)>`，按工作区区分、最多 50 条、损坏时逐级回退默认。来源：`src/client/view-preference.ts`。若要记住「这个工作区曾开过 MattWorkflow」，可以沿用同一套 key 约定。

【本仓库】本仓库目前**没有**使用 `ctx.sidebarRight`，能力诊断项里也没有对应条目（`src/protocol/env-check.ts` 与 `src/client/env-check-text.ts` 只有 `sidebarRightTabs`、`sidebar.right.pane.tab`、`sidebar.right.pane.tab.title` 三项）。落点 A/B 都要补一条「宿主右栏控制能力」诊断项。

由此得到几条落点：

| 方案                                             | 做法                                                                                                               | 代价与风险                                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| A. 新会话自动打开 MattWorkflow                   | 客户端半监听会话变化，在新会话就绪后调 `ctx.sidebarRight.openTab('dsh-mattpocock-workflow')`（`openTab` 自带展开） | 上游官方路径（docked 打开自动展开）。代价：需要「新会话就绪」的可靠信号与 `ctx.sidebarRight`；会改变「用户没主动打开就不占屏幕」的默认 |
| A'. 只在用户开过 MattWorkflow 的工作区里自动打开 | 用本仓库已有的视图偏好式 localStorage 记住「本工作区曾开过 MattWorkflow」，新会话时据此决定是否 `openTab`          | 行为可预测性最好；同样依赖 A 的时机处理，多一份自建偏好                                                                                |
| B. 只展开，不切页签                              | 新会话就绪后按 `isExpanded()` 判断再 `toggleExpanded()`                                                            | 最小侵入，但 `toggleExpanded()` 是切换语义，需要自己兜幂等；用户仍要点一次才能看到 MattWorkflow                                        |
| C. 只做引导                                      | 新会话后在本插件的 UI 里提示「右栏已收起，点此打开」，调 `toggleExpanded()` / `openTab`                            | 最保守、零副作用；但用户仍需点一次，无法完全消除工单描述的困扰                                                                         |
| D. 改宿主                                        | 向上游提 issue/PR：新会话继承上一会话的右栏展开状态（甚至页签布局），或加宿主配置项                                | 上游当前把「各 Session 独立保存状态」写成既定行为；收益覆盖所有插件，但周期与结果不可控                                                |
| E. 零改动                                        | 告知用快捷键 `sidebar.right.toggle`（`⌘⌥B`）或右栏展开按钮                                                         | 只作应急手段，不解决工单诉求                                                                                                           |

【推断】方案 A/A'/B/C 都要求客户端半能观察到「新会话已就绪」：上游右栏包的注入列表是 `['contextMenus', 'slots', 'layout', 'locale', 'resources', 'sessions', 'uiSession', 'shortcuts']`，其中 `sessions` 与 `uiSession` 是客户端服务，本仓库已在用 `sessions`。来源：[`ui-sidebar-right/src/client/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-sidebar-right/src/client/index.ts#L89)、[`src/client/index.tsx`](https://github.com/cnzgray/dsh-mattpocock-workflow/blob/main/src/client/index.tsx)。

---

## 5. 未找到与限制

- **未找到**上游公开 issue/PR 讨论「新建会话后右栏关闭」：该仓库在 GitHub 上**关闭了 issue 功能**（`gh issue list` 返回 "the 'deepseek-ai/deepseek-harness' repository has disabled issues"），因此只能查 PR 与 `.agents/notes`；`ui-sidebar-right` 包内也没有相关 TODO。
- **未找到**任何「全局默认展开右栏」「按工作区记忆展开」的配置位或文档承诺；`ui-sidebar-right` 没有 Config 导出，右栏的 slot 全是内容贡献位（`sidebar.right.pane.tab`、`sidebar.right.pane.tab.title`、`sidebar.right.tab.guide` 等），**没有控制位**；`dsh-client-ui-layout` 的 `ILayout` 只提供 `toggleSidebar()`（左侧栏）、`openRightbar` / `closeRightbar`（右栏呈现事实）与 `selectPanel`。
- **本机限制**：本机 npm profile（`0.2.2-rc.1`）里 `dsh-client-ui-sidebar-right` / `-files` / `-terminal` / `-documentpreview` / `dsh-client-ui-dockkit` 的落地文件缺失（`dsh-web-app` 的 `package.json` 声明了这些依赖，但 `@deepseek-ai` 目录里没有对应目录，也没有 `.pnpm` 虚拟存储目录），因此本机可读的右栏完整产物在桌面应用 `app.asar`（`0.2.2-rc.3`）里；源码级证据以上游 `master` / `dsh-v0.2.2-rc.1` 为准。
- 上游 API 自述 pre-stable（见 [`docs/research/2026-11-13-dsh-plugin-development-best-practices.md`](./2026-11-13-dsh-plugin-development-best-practices.md) 第 10 条），依赖 `ctx.sidebarRight` 的落点要考虑版本漂移。
