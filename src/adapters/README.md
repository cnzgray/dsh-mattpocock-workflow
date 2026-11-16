# adapters

对接外部系统，每个后端一个子目录：

- `github/`：通过 `git` 与 `gh` 读取 `github.com` 仓库的 issue；列表 GraphQL 一并取父票编号与所在仓库，同仓库存 `#编号`、跨仓库存 `仓库#编号`，父子能力为原生；
- `gitlab/`：通过 `git` 与 `glab` 读取 GitLab issue；列表带 `blocking_issues_count` 时直接判定支持原生阻塞，原生阻塞数在 `resolveBlockers` 补齐阶段读取：否则按实例主机只探测一次，支持时用一次批量 GraphQL 取回阻塞数，失败或空数组时退回 `Blocked by:` 行；列表与增量返回后按每批最多 100 个 iid 用一次 `workItems` GraphQL 补齐父级（Issue / Task 存 `#iid`，Epic 存 `&iid`），查询失败只把本次快照标为无父子能力；要求 `glab` >= 1.126，更早版本未验证；
- `gitea/`：通过 `git` 与 `tea` 读取 Gitea issue 与原生 issue 依赖（只读 `tea api --include`）；
  依赖功能关闭时退回 `Blocked by:` 行。宿主选择后端时探测 `tea logins list --output json`；Gitea 没有原生子工单，父子能力显式为无；
- `markdown/`：读取工作区里 `.scratch/<feature>/issues/*.md` 的本地工单；`Parent: NN` 解析成同一 feature 下的父票路径，父子能力为约定；`env.ts` 供环境检查确认工单目录与文件可解析；
- `fs/`：环境检查用的文件系统能力（解析用户主目录、判断文件是否存在）；
- `github/`、`gitlab/`、`gitea/` 里的 `env.ts`：环境检查的命令行探测（CLI 是否安装、是否登录、仓库是否可达）；
  Gitea 的登录列表与仓库访问复用工单后端的调用方式与解析函数。

每个后端的 `tracker.ts` 实现列表契约，`detail.ts` 实现可选的详情与变更能力，
`options.ts` / `delete.ts` 实现补全候选与删除，共用 `shared.ts` 里的仓库识别、命令执行与错误映射：

列表与扩窗共用同一份口径：`fetchSnapshot(root, windowLimit)` 返回「按更新时间倒序的前 N 张」，
GitHub 用 GraphQL 游标按 100 一页续取，GitLab 与 Gitea 按各自的页大小续取到窗口覆盖；
GitLab 首屏带 `--include` 从 `X-Total` 读仓库总数，Gitea 用 `X-Total-Count`，GitHub 用 `totalCount`。
本地 Markdown 没有翻页概念，忽略窗口。

列表快照同时带当前登录用户 `viewer` 与每张票的分配人登录名 `assignees`：GitHub 在同一次 GraphQL
查询里从根字段 `viewer.login` 与 issue 节点的 `assignees` 取回；GitLab / Gitea 在列表之外并行查询一次
`/user`，查询失败只丢身份、不让列表失败。分配人字段缺失或条目格式不对时按空数组处理。
本地 Markdown 没有身份与分配人概念，两项恒为 null / 空数组。

| 后端          | 详情正文       | 评论                           | 链接地址 | 标签写 | 分配人写                        | 状态写 | 补全候选                                                   | 删除                                                               |
| ------------- | -------------- | ------------------------------ | -------- | ------ | ------------------------------- | ------ | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| GitHub        | 是             | `gh issue view`                | 是       | 是     | 是                              | 是     | `gh label list`；`gh api .../assignees --paginate --slurp` | `gh issue delete --yes`；`viewerPermission` 为 `ADMIN`             |
| GitLab        | 是             | notes 接口（跳过 system note） | 是       | 是     | 是（整体替换，清空用 `!` 前缀） | 是     | labels 与 members/all 分页（只保留 active 成员）           | `glab api --method DELETE`；Owner（access_level ≥ 50）或实例管理员 |
| Gitea         | 是             | comments 接口                  | 是       | 是     | 是（`--set-assignees`）         | 是     | labels 分页（每页 50 条）与 assignees                      | `tea api --method DELETE`；`permissions.admin`                     |
| 本地 Markdown | 是（文件正文） | `## Comments` 段按空行分段     | 否       | 否     | 否                              | 否     | 否                                                         | 否（不改用户手写的文件）                                           |

- 详情只在打开详情时请求，不进入列表快照；作者来源：GitHub 的 `author.login`、GitLab 的
  `author.username`、Gitea 的 `user.login`，本地 Markdown 为 null；
- 补全候选把标签颜色统一成小写 `#rrggbb`，重复的标签名 / 用户名只保留第一次出现的项；
- 删除前宿主会再查一次权限；删除成功后不可撤销，编号不存在映射为 `ticket-not-found`；
- 权限查询失败在宿主按“没有权限”处理，详情仍然正常返回，只把删除能力置为 false；
- 变更补丁表达目标集合，适配器用 `core` 的 `planSetChange` 与当前值算成各自 CLI 的增删参数；
  「分配给我」由适配器解析当前登录用户（GitHub 用 `@me`，GitLab / Gitea 先查 `/user`）；
- 正文内联图片（只有 GitLab 实现 `fetchAttachment`）：只接受 `/uploads/<32 位十六进制 secret>/<单段文件名>`，
  按当前工作区的项目调用 `glab api projects/<项目>/uploads/...`；输出走执行器的 `base64` 模式
  （DSH 子进程服务只交付文本），再按文件头识别 PNG / JPEG / GIF / WebP，超过 5 MB 或不是图片都算失败；
- 本地 Markdown 的引用必须是 `.scratch/<feature>/issues/<name>.md`，越界路径直接拒绝读取。
- 可选字段：能给出关闭时间时填 `closedAt`；能给出阻塞依赖边时填 `blockedBy`（引用集合，不论开闭）；
  能给出父级时填 `parent`（父级引用，可指向列表外）。
  GitHub 列表查询只给未关闭阻塞数，整张票省略 `blockedBy`；本地 Markdown 没有关闭时间。
- 列表与增量结果都必须显式带 `hierarchy`（`native` / `convention` / `none`）；声明 `none` 的后端不得出现 `parent`。
  父级引用只存引用字符串，不存父票的标题、状态或对象：父票信息仍从当前列表里查。

- 只能依赖 `core`；各个后端之间互不依赖（由 `adapters-only-core` 规则检查）；
- 工单后端共用一套契约测试：同一组用例，每个后端都必须跑通；测试里不连真实服务，用录制好的响应或内存假实现。
  详情、补全候选与删除能力也在这套契约里：实现该能力的后端给出请求与期望输出，省略即表示不实现。
  父子能力同样必须显式声明：每个后端给出 `hierarchy` 与期望父级映射；声明为无的后端不得出现父级引用，
  新增后端漏填会直接类型检查失败。
