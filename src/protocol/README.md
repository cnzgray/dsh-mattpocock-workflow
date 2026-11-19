# protocol

服务端（`host`）与界面（`client`）之间的消息类型和常量。

- 只放类型和常量，不放逻辑；
- 不依赖任何其他目录（由 `protocol-is-leaf` 规则检查）；
- 界面只能通过这里定义的类型和服务端通信，不能直接导入 `core`、`adapters`、`host`。

RPC 方法：

- `snapshot.get` / `snapshot.refresh` / `snapshot.resolveBlockers`：列表快照与阻塞补齐；
- `env.check`：环境检查；
- `ticket.get`：读取单张工单详情，参数是 `{ workspaceRoot, ref, number }`；跨仓库详情再加可选的
  `repository: 'owner/name'`（只有 Gitea 支持，返回的详情只读）；
- `ticket.update`：提交一次变更补丁，参数在详情参数上再加 `patch`，成功返回 `{ applied: true }`；
  带 `repository` 的跨仓库引用会被拒绝，避免改到本地同号票；
- `ticket.options`：读取仓库的标签与可分配用户，参数是 `{ workspaceRoot }`，返回 `TicketOptions`；
- `ticket.delete`：永久删除一张工单，参数在详情参数上再加 `confirm: 'delete'`，成功返回 `{ deleted: true }`。

错误码里与详情相关的是 `ticket-not-found`（编号不存在或已被删除）与
`capability-unsupported`（当前后端不提供所请求的详情、补全候选或写 / 删除能力）。
删除时没有权限用 `fetch-failed`，消息里写明需要哪种角色。界面按错误码给出统一文案。

## 快照载荷

`snapshot.get`、`snapshot.refresh` 与 `snapshot.resolveBlockers` 都返回同一个 `WorkspaceSnapshot`：

- 工单级：判定结果（`status`、`category`）、创建人、分配人登录名（`assignees`，没有分配人概念时为空数组）、
  关闭时间（`closedAt`，能给才给）、阻塞引用（`blockedBy`，能给才给；同仓库是 `#15`，Gitea 的跨仓库依赖
  是 `owner/repo#15`；GitHub 列表查询没有依赖边）与父级引用
  （`parent`，能给才给；可能指向列表外）；
- 快照级：仓库标识、后端、实例主机、当前登录用户（`viewer`，识别不出时为 null）、拉取时间、已加载数与总数、
  父子能力（`hierarchy`：`native` / `convention` / `none`）、阻塞是否定稿；`viewer` 与每张票的 `assignees`
  是人员筛选的必填字段，客户端缺字段或类型不对时按 `fetch-failed` 拒绝整份快照；`hierarchy` 为 `none` 时界面禁用父子布局；
- 指标级：`metrics`，含三个压力维度（`PressureDimension` / `PressureTier`）、关键数字、样本覆盖度
  （`coverage`）与关注清单（`attention`）。`MetricValue` 用 `value: null` + `gap` 表示后端给不出的指标；
  维度数据不足时 `PressureDimensionReport.tier` 为 `null`，总档位只合并可判档的维度。

指标由宿主在列表返回时算一次、阻塞补齐完成后重算，界面只渲染，不重复判定。阈值与判定规则在 core。

`snapshot-test-support.ts` 只是测试夹具（全零指标载荷），生产代码不导入；它和消息类型放在一起，是为了让 host 与 client 的测试共用同一份默认值。
