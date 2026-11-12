# core

纯业务逻辑：工单模型、远端解析、后端选择、本地 Markdown 解析、规则判定等。

- 不做任何 IO：不读写文件、不发网络请求、不启动子进程；
- 正式代码只依赖自己；允许用 `import type` 引用 `protocol` 里的纯类型（例如 `BackendKind`），
  不产生运行时依赖（由 `.dependency-cruiser.json` 的 `core-is-pure` 规则检查）；
- 行、分支、函数覆盖率都不低于 80%（由 `vitest.config.ts` 检查）。
