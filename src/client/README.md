# client

运行在 DSH 浏览器页面里的 MattWorkflow 面板，只依赖 `protocol` 的消息类型与宿主提供的能力。

- 只通过 `protocol` 与宿主通信，不能导入 `core`、`adapters`、`host`（由 `client-only-protocol` 规则检查）；
- 三个视图：列表（`tickets-view.tsx`）、概览（`overview-view.tsx`）与环境检查（`env-check-view.tsx`），
  默认仍是列表；视图切换条在窄侧栏里可横向滚动；
- 列表与概览共用 `snapshot-request.ts` 的两阶段加载（首屏只等列表、后台补齐阻塞）与 `error-banner.tsx` 的错误提示，
  不各自维护一份；
- 概览只渲染宿主附上的指标：档位、触发事实、缺口原因与关注清单都来自 `snapshot.metrics`；文案与格式在
  `overview-text.ts`，样式在 `overview-styles.ts`；图表组件在 `overview-charts.tsx`，
  压力区（每个维度一张卡片，档位、触发原因与支撑数字放在一起）在 `overview-pressure.tsx`，
  按周/按天分桶的展示计数在 `overview-chart-data.ts`，没有真实工单时间时不画流量图与时效分布。颜色全部走宿主主题变量，档位同时用文字与颜色表示；
- 关注清单点击只切到列表并选中该票，不写提示词（概览保持只读）；列表行点击打开详情，不写提示词；
- 提示词注入按目标分派（`injection.ts`）：顶部两个入池按钮与工单行的技能徽标共用 `split-action.tsx`，
  主键写当前会话，小箭头走宿主的 `uiWorkspace.startSession` 开新会话；`uiWorkspace` 是可选能力，
  缺失时只禁用小箭头；
- 测试跑在 jsdom 里：视图测试用假 `PanelClient` 与固定时钟；入口测试装配真实客户端，用假 `fetch` 提供快照；都不连真实远端。
