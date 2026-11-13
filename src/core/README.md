# core

纯业务逻辑：工单模型、远端解析、后端选择、本地 Markdown 解析、工单详情与变更规划、环境检查的顺序与依赖判定等。

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
