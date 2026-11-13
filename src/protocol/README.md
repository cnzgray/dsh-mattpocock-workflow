# protocol

服务端（`host`）与界面（`client`）之间的消息类型和常量。

- 只放类型和常量，不放逻辑；
- 不依赖任何其他目录（由 `protocol-is-leaf` 规则检查）；
- 界面只能通过这里定义的类型和服务端通信，不能直接导入 `core`、`adapters`、`host`。

RPC 方法：

- `snapshot.get` / `snapshot.refresh` / `snapshot.resolveBlockers`：列表快照与阻塞补齐；
- `env.check`：环境检查；
- `ticket.get`：读取单张工单详情，参数是 `{ workspaceRoot, ref, number }`；
- `ticket.update`：提交一次变更补丁，参数在详情参数上再加 `patch`，成功返回 `{ applied: true }`；
- `ticket.options`：读取仓库的标签与可分配用户，参数是 `{ workspaceRoot }`，返回 `TicketOptions`；
- `ticket.delete`：永久删除一张工单，参数在详情参数上再加 `confirm: 'delete'`，成功返回 `{ deleted: true }`。

错误码里与详情相关的是 `ticket-not-found`（编号不存在或已被删除）与
`capability-unsupported`（当前后端不提供所请求的详情、补全候选或写 / 删除能力）。
删除时没有权限用 `fetch-failed`，消息里写明需要哪种角色。界面按错误码给出统一文案。
