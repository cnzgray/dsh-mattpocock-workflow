# adapters

对接外部系统，每个后端一个子目录：

- `github/`：通过 `git` 与 `gh` 读取 `github.com` 仓库的 issue；
- `gitlab/`：通过 `git` 与 `glab` 读取 GitLab issue 与原生 blocking link；要求 `glab` >= 1.126，更早版本未验证；
- `gitea/`：通过 `git` 与 `tea` 读取 Gitea issue 与原生 issue 依赖（只读 `tea api --include`）；
  依赖功能关闭时退回 `Blocked by:` 行。宿主选择后端时探测 `tea logins list --output json`；
- `markdown/`：读取工作区里 `.scratch/<feature>/issues/*.md` 的本地工单；
- `fs/`：环境检查用的文件系统能力（解析用户主目录、判断文件是否存在）；
- `github/`、`gitlab/` 里的 `env.ts`：环境检查的命令行探测（CLI 是否安装、是否登录、仓库是否可达）；
  Gitea 后端暂未接入环境检查，三项 CLI 检查显示为“跳过”。

- 只能依赖 `core`；各个后端之间互不依赖（由 `adapters-only-core` 规则检查）；
- 工单后端共用一套契约测试：同一组用例，每个后端都必须跑通；测试里不连真实服务，用录制好的响应或内存假实现。
