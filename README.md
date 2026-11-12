# dsh-mattpocock-workflow

在 DSH 里运行 [mattpocock/skills](https://github.com/mattpocock/skills) 工作流的 MattWorkflow 任务面板插件。

右侧栏新增一个“MattWorkflow”页签：读取当前工作区对应的 GitHub 仓库，显示工单列表与
“可接 / 阻塞 / 已关闭”统计，支持按状态过滤、按更新时间/创建时间/编号/标题排序，
并把“新建需求”“+ bug”“处理 #N”的预设提示词填进当前会话输入框。面板只读工单，
不修改工单，也不会自动发送提示词。

## 环境要求

- DSH `>= 0.2.0-rc.2`；
- 已安装并登录 GitHub CLI：`gh auth login`；
- 当前工作区是 git 仓库，且有 GitHub 远端（优先使用 `origin`）。

缺 `gh`、未登录、不是 git 仓库或没有 GitHub 远端时，面板会显示对应的操作提示，而不是空白列表。

## 开发

见 [CONTRIBUTING.md](CONTRIBUTING.md)。工程规范见 `docs/adr/0001-engineering-standards.md`，
业务术语见 [GLOSSARY.md](GLOSSARY.md)。

## 许可证

MIT
