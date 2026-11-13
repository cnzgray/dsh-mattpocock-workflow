# 术语表

只收本插件用到的业务术语。代码里的类型和常量名以本表为准。

| 术语              | 英文 / 代码名                                   | 含义                                                                                                                                                      |
| ----------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 工单              | ticket / `Ticket`                               | 工单后端返回的一张 issue 在插件里的模型。MVP 只读。                                                                                                       |
| 后端              | backend / `BackendKind`                         | 工单数据的来源：`github`、`gitlab`、`gitea` 或 `markdown`。宿主按工作区 `origin` 远端自动选择。                                                           |
| 工单引用          | ref / `Ticket.ref`                              | 唯一、可直接展示并写进提示词的引用。远端后端是 `#15`，本地 Markdown 是相对工作区的文件路径。                                                              |
| 后端判定来源      | `BackendSource`                                 | 选择该后端的依据：`remote`（主机名命中）、`glab-auth` / `tea-auth`（自建实例已登录）、`no-remote`、`unsupported-remote`；环境检查显示成 `remote:github`。 |
| 快照              | snapshot / `WorkspaceSnapshot`                  | 某一时刻某个工作区的工单列表、仓库标识、后端与拉取时间。界面显示“多久之前”。                                                                              |
| 可接              | ready / `TicketStatus.ready`                    | 开放、没有未关闭的阻塞票、带 `ready-for-agent` 标签的工单。                                                                                               |
| 阻塞              | blocked / `TicketStatus.blocked`                | 开放且至少有一张未关闭的阻塞票；不论带什么状态标签都算阻塞。                                                                                              |
| 已关闭            | closed / `TicketStatus.closed`                  | 后端的关闭状态：GitHub / GitLab / Gitea 的 issue state 为 closed，本地 Markdown 为 `Status: resolved`。                                                   |
| 其他开放          | open / `TicketStatus.open`                      | 开放、未阻塞、但没有 `ready-for-agent` 标签的工单。                                                                                                       |
| 状态标签          | `ready-for-agent`                               | triage 标签之一；只有带它的开放票才可能变成“可接”。见 `docs/agents/triage-labels.md`。                                                                    |
| 分类标签          | `bug` / `enhancement`                           | 每张已 triage 的远端工单恰好带一个；同时带上时以 `bug` 优先。本地 Markdown 约定没有分类，显示为空。                                                       |
| 仓库标识          | repository / `WorkspaceSnapshot.repository`     | 后端相关的仓库显示名：GitHub 与 Gitea 是 `owner/name`，GitLab 是含嵌套 group 的完整项目路径，本地 Markdown 是工作区目录名。                               |
| 实例主机          | host / `WorkspaceSnapshot.repositoryHost`       | 远端仓库所在实例的主机名；Gitea 面板用它区分多个自建实例，本地 Markdown 为 null。                                                                         |
| 阻塞票            | blocker                                         | 通过后端的原生依赖（GitHub / Gitea issue dependencies、GitLab blocking link）或 `Blocked by:` 行指向当前票的另一张票。                                    |
| Gitea CLI         | `tea`                                           | Gitea 官方命令行工具。Gitea 后端只通过它访问实例，最低版本 0.16。                                                                                         |
| 工作区            | workspace / `workspaceRoot`                     | 当前会话的工作目录。插件用它选择后端、读取 git 远端与 `.scratch/`，并按它缓存快照。                                                                       |
| MattWorkflow 面板 | MattWorkflow / task panel                       | DSH 右侧栏里的“MattWorkflow”页签，展示快照、统计、过滤与排序，并往输入框填提示词。                                                                        |
| 提示词注入        | draft injection                                 | 把预设文本写进当前会话输入框（`setDraft`），不自动发送。                                                                                                  |
| 环境检查          | env check / `EnvCheckReport`                    | 面板里与工单列表并列的只读视图：逐项检查本机与工作区是否满足面板和技能的前提，不安装、不登录、不改文件。                                                  |
| 检查项            | check item / `EnvCheckItem`                     | 环境检查里的一条结论，状态为通过、失败或跳过；稳定 id 由 protocol 定义，标题由界面渲染。                                                                  |
| 前置项            | prerequisite / `blockedBy`                      | 某个检查项依赖的另一项。前置项没通过时，后续项判为“跳过”，并记录最先失败的那一项。                                                                        |
| 跳过              | `EnvCheckStatus.skipped`                        | 前置项未通过而没执行，或该后端暂不支持这项检查；不当作失败，前置失败时会在报告里指出根因。                                                                |
| 建议码            | suggestion code / `SuggestionCode`              | 失败项对应的修复动作标识（如 `install-cli`）；具体中文文案只在界面维护。                                                                                  |
| 探测              | probe / `EnvCommandProbe`                       | 环境检查里对一项前提的实际观测：跑只读命令、查文件或读 DSH 技能清单；原始输出不进入报告。                                                                 |
| 能力诊断          | capability diagnostics / `CapabilityDiagnostic` | 插件用到的 DSH 宿主服务与界面扩展点是否可用，默认折叠在环境检查底部。                                                                                     |
