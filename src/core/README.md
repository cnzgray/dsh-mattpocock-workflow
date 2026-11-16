# core

纯业务逻辑：工单模型、远端解析、后端选择、本地 Markdown 解析、工单详情与变更规划、指标与压力判档、环境检查的顺序与依赖判定等。

- 不做任何 IO：不读写文件、不发网络请求、不启动子进程；
- 正式代码只依赖自己；允许用 `import type` 引用 `protocol` 里的纯类型（例如 `BackendKind`），
  不产生运行时依赖（由 `.dependency-cruiser.json` 的 `core-is-pure` 规则检查）；
- 行、分支、函数覆盖率都不低于 80%（由 `vitest.config.ts` 检查）。

工单详情相关：

- `ticket.ts` 里的 `TicketDetail` / `TicketComment` / `TicketPatch` 是适配器与宿主共用的模型；
- `ticket-detail.ts` 只做纯计算与字段校验：目标集合与当前集合的差异（`diffSets` / `resolveTargetSet` /
  `planSetChange` / `isEmptyDiff`），以及三个远端后端共用的详情字段读取（`readRequiredString`、
  `readNameList`、`readUserNames`、`sortCommentsByTime`、`requireTicketNumber`、`invalidDetail`）；
  「分配给我」由适配器解析用户名后作为 `self` 并入目标集合；
- 补全候选的归一化也在这里：`normalizeLabelColor` 把颜色统一成小写 `#rrggbb`，
  `dedupeBy` 按名字去重并保留首次出现的顺序；
- `markdown.ts` 里的 `parseMarkdownDetail` 把本地工单文件切成标题、正文与评论段落。
- 父子关系也是纯数据：`ticket.ts` 的 `HierarchyKind` 声明后端能力（`native` / `convention` / `none`），
  `Ticket.parent` 只存父级引用字符串；`markdown.ts` 从 `## Comments` 之前的 `Parent: NN` 解析同一 feature 下的父票路径，
  缺失、自引用与跨 feature 引用都按无父级处理。父子关系不参与 `classify.ts` 的判定。
- `snapshot-store.ts` 的格式版本 3 把 `hierarchy` 与工单的 `parent` 一起缓存；版本不符或缺字段的旧条目整份作废，
  由宿主重拉，避免把没有父子边的旧数据当成完整的树。

## 指标与压力判档（`metrics.ts`）

`computeMetrics` 接收已判定的工单、快照时间、总数、时间数据可用性与阈值，输出指标、三个压力维度与关注清单。
判定与文案分离：core 只给档位、触发指标与缺口原因（`light` / `normal` / `tight`、`MetricGap`），中文文案在界面的
`overview-text.ts` 里，改文案不会改判定。

阈值集中在 `PRESSURE_THRESHOLDS`，三条规则：

| 维度 | 看什么                   | 轻松                    | 吃紧                     |
| ---- | ------------------------ | ----------------------- | ------------------------ |
| 规模 | 开放积压、近 30 天净流入 | 积压 < 10 且净流入 ≤ 0  | 积压 ≥ 30 或净流入 ≥ 6   |
| 阻塞 | 阻塞票 ÷ 开放票          | < 15%                   | > 35%                    |
| 时效 | 陈旧率、停滞票           | 陈旧率 < 20% 且停滞 ≤ 3 | 陈旧率 > 40% 或停滞 ≥ 11 |

总档位取三者中最重的一维。**初稿校准**：用本插件仓库（20 张票、开放 10、近 30 天新开 20、关闭 10、净流入 +10）核对，
积压 10 张判“正常”、净流入 +10 判“吃紧”；结论是初稿对刚建立、票全在窗口内的仓库偏严。阈值是初稿，后续校准只改
`PRESSURE_THRESHOLDS`，判定逻辑与界面文案不动。

数据诚实性：本地 Markdown 的文件时间不算工单时间（`timestamps: false`），时效维度整体标“不可用”（`tier: null`），
流量指标也标不可用；后端不给关闭时间时关闭类指标标 `no-closed-time`；GitHub 列表查询给不出依赖边时链深度标
`no-dependency-edges`。不可得指标一律用 `null` + `gap` 表达，不用 0 冒充。样本被截断时，关闭类指标可能低估，
由关闭数派生的净流入可能高估，界面分别标注。

阻塞依赖边用 `Ticket.ref` 而不是裸编号：远端是 `#15`，本地 Markdown 是相对路径。本地编号只在同一个 feature 内唯一，
裸编号无法跨 feature 找回票，链深度也就无从计算。
