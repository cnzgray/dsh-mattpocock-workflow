# 术语表

只收本插件用到的业务术语。代码里的类型和常量名以本表为准。

| 术语              | 英文 / 代码名                               | 含义                                                                                                               |
| ----------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 工单              | ticket / `Ticket`                           | 工单后端返回的一张 issue 在插件里的模型。MVP 只读。                                                                |
| 后端              | backend / `BackendKind`                     | 工单数据的来源：`github`、`gitlab` 或 `markdown`。宿主按工作区 `origin` 远端自动选择。                             |
| 工单引用          | ref / `Ticket.ref`                          | 唯一、可直接展示并写进提示词的引用。远端后端是 `#15`，本地 Markdown 是相对工作区的文件路径。                       |
| 快照              | snapshot / `WorkspaceSnapshot`              | 某一时刻某个工作区的工单列表、仓库标识、后端与拉取时间。界面显示“多久之前”。                                       |
| 可接              | ready / `TicketStatus.ready`                | 开放、没有未关闭的阻塞票、带 `ready-for-agent` 标签的工单。                                                        |
| 阻塞              | blocked / `TicketStatus.blocked`            | 开放且至少有一张未关闭的阻塞票；不论带什么状态标签都算阻塞。                                                       |
| 已关闭            | closed / `TicketStatus.closed`              | 后端的关闭状态：GitHub / GitLab 的 issue state 为 closed，本地 Markdown 为 `Status: resolved`。                    |
| 其他开放          | open / `TicketStatus.open`                  | 开放、未阻塞、但没有 `ready-for-agent` 标签的工单。                                                                |
| 状态标签          | `ready-for-agent`                           | triage 标签之一；只有带它的开放票才可能变成“可接”。见 `docs/agents/triage-labels.md`。                             |
| 分类标签          | `bug` / `enhancement`                       | 每张已 triage 的远端工单恰好带一个；同时带上时以 `bug` 优先。本地 Markdown 约定没有分类，显示为空。                |
| 仓库标识          | repository / `WorkspaceSnapshot.repository` | 后端相关的仓库显示名：GitHub 是 `owner/name`，GitLab 是含嵌套 group 的完整项目路径，本地 Markdown 是工作区目录名。 |
| 阻塞票            | blocker                                     | 通过后端的原生依赖（GitHub issue dependencies、GitLab blocking link）或 `Blocked by:` 行指向当前票的另一张票。     |
| 工作区            | workspace / `workspaceRoot`                 | 当前会话的工作目录。插件用它选择后端、读取 git 远端与 `.scratch/`，并按它缓存快照。                                |
| MattWorkflow 面板 | MattWorkflow / task panel                   | DSH 右侧栏里的“MattWorkflow”页签，展示快照、统计、过滤与排序，并往输入框填提示词。                                 |
| 提示词注入        | draft injection                             | 把预设文本写进当前会话输入框（`setDraft`），不自动发送。                                                           |
