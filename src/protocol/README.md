# protocol

服务端（`host`）与界面（`client`）之间的消息类型和常量。

- 只放类型和常量，不放逻辑；
- 不依赖任何其他目录（由 `protocol-is-leaf` 规则检查）；
- 界面只能通过这里定义的类型和服务端通信，不能直接导入 `core`、`adapters`、`host`。
