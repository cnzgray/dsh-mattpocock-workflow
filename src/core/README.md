# core

纯业务逻辑：工单模型、工作区快照合并、规则判定等。

- 不做任何 IO：不读写文件、不发网络请求、不启动子进程；
- 正式代码不依赖其他目录，也不依赖任何第三方包或 Node 内置模块（由 `.dependency-cruiser.json` 的 `core-is-pure` 规则检查）；
- 行、分支、函数覆盖率都不低于 80%（由 `vitest.config.ts` 检查）。
