# client

运行在 DSH 浏览器页面里的 MattWorkflow 面板，只依赖 `protocol` 的消息类型与宿主提供的能力。

- 只通过 `protocol` 与宿主通信，不能导入 `core`、`adapters`、`host`（由 `client-only-protocol` 规则检查）；
- 三个视图：列表（`tickets-view.tsx`）、概览（`overview-view.tsx`）与环境检查（`env-check-view.tsx`），
  默认仍是列表；视图切换条在窄侧栏里可横向滚动；
- 列表与概览共用 `snapshot-request.ts` 的两阶段加载（首屏只等列表、后台补齐阻塞）与 `error-banner.tsx` 的错误提示，
  不各自维护一份；
- 概览只渲染宿主附上的指标：档位、触发事实、缺口原因与关注清单都来自 `snapshot.metrics`；文案与格式在
  `overview-text.ts`，样式在 `overview-styles.ts`。颜色全部走宿主主题变量，档位同时用文字与颜色表示；
- 关注清单点击复用列表行的定位行为（选中该票并填入处理提示词），不另立一套；
- 测试跑在 jsdom 里，用假 `PanelClient` 与固定时钟；不连真实远端。
