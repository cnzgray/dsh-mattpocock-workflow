# client

运行在 DSH 浏览器页面里的 MattWorkflow 面板，只依赖 `protocol` 的消息类型与宿主提供的能力。

- 只通过 `protocol` 与宿主通信，不能导入 `core`、`adapters`、`host`（由 `client-only-protocol` 规则检查）；
- 三个视图：列表（`tickets-view.tsx`）、概览（`overview-view.tsx`）与环境检查（`env-check-view.tsx`），
  默认仍是列表；视图切换条在窄侧栏里可横向滚动；
- 列表与概览共用 `snapshot-request.ts` 的两阶段加载（首屏只等列表、后台补齐阻塞）与 `error-banner.tsx` 的错误提示，
  不各自维护一份；快照状态由面板（`task-panel.tsx`）取一次再传下去，切视图、进详情都不重新读；
- 面板常驻右栏，agent 建票、triage、改状态走的是跟踪器自己的命令行，宿主不会通知面板；
  同步点只有会话列表：`agent-activity.ts` 读这一轮是否在跑与最近活动时间，
  一轮停下并安静 `ACTIVITY_SETTLE_MS` 之后把刷新信号加一，面板据此做一次**后台增量刷新**。
  后台刷新不切「刷新中」、不动按钮；拉回来的数据与当前显示的一致时整份丢弃（`snapshotVisibleChange`），
  数据变了才落地。面板拿不到 agent 跑了哪条命令，所以只读的一轮也会多一次增量请求，多出来的那份不落地；
  无论落不落地，用户选的筛选、排序、正在看的详情与输入框里的提示词草稿都不受影响；
  刷新失败沿用「保留旧数据 + 数据旁边说明原因」；
- 概览只渲染宿主附上的指标：档位、触发事实、缺口原因与关注清单都来自 `snapshot.metrics`；文案与格式在
  `overview-text.ts`，样式在 `overview-styles.ts`；图表组件在 `overview-charts.tsx`，
  压力区（每个维度一张卡片，档位、触发原因与支撑数字放在一起）在 `overview-pressure.tsx`，
  按周/按天分桶的展示计数在 `overview-chart-data.ts`，没有真实工单时间时不画流量图与时效分布。颜色全部走宿主主题变量，档位同时用文字与颜色表示；
- 关注清单点击只切到列表并选中该票，不写提示词（概览保持只读）；列表行点击打开详情，不写提示词；
- 提示词注入按目标分派（`injection.ts`）：顶部两个入池按钮与工单行的技能徽标共用 `split-action.tsx`，
  主键写当前会话，小箭头走宿主的 `uiWorkspace.startSession` 开新会话；`uiWorkspace` 是可选能力，
  缺失时只禁用小箭头；
- 测试跑在 jsdom 里：视图测试用假 `PanelClient` 与固定时钟；入口测试装配真实客户端，用假 `fetch` 提供快照；都不连真实远端。
