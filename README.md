# dsh-mattpocock-workflow

在 DSH 里运行 [mattpocock/skills](https://github.com/mattpocock/skills) 工作流的 MattWorkflow 任务面板插件。

右侧栏新增一个“MattWorkflow”页签：读取当前工作区的工单列表与“可接 / 阻塞 / 已关闭”统计，
支持按状态过滤、按更新时间/创建时间/编号/标题排序，并把“新建需求”“+ bug”“处理工单”的预设提示词
填进当前会话输入框。面板只读工单，不修改工单，也不会自动发送提示词。

工单后端按 `origin` 远端自动选择：

- `github.com` → GitHub，通过 `gh` 读取；
- `gitlab.com` 或 `glab` 已登录的自建实例 → GitLab，通过 `glab` 读取，支持嵌套 group；
- 其余情况（没有 git、没有远端、主机不匹配）→ 本地 Markdown，读取
  `.scratch/<feature>/issues/*.md`。

面板顶部会标出当前后端（GitHub / GitLab / 本地）。三种后端共用同一套判定、统计、过滤排序与提示词注入。

## 环境要求

- DSH `>= 0.2.0-rc.2`；
- GitHub：已安装并登录 GitHub CLI（`gh auth login`）；
- GitLab：已安装 GitLab CLI 并登录（`glab auth login`）；自建实例需要登录该实例。
  最低支持 `glab` 1.126（本插件验证的版本）；更早版本未验证，登录状态识别失败时会回退本地 Markdown；
- 当前工作区是 git 仓库且有远端；或直接把工单放在 `.scratch/<feature>/issues/NN-<slug>.md`。
- 同一个工作区同时有 GitHub 与 GitLab 远端时，以 `origin` 为准。

缺 `gh` / `glab`、未登录或读取 `.scratch` 失败时，面板会显示对应的操作提示，而不是空白列表。
自建 GitLab 未在 `glab` 登录时，面板回退本地 Markdown，并在顶部标明“本地”。

## 开发

见 [CONTRIBUTING.md](CONTRIBUTING.md)。各层的约定写在 `src/<层>/README.md`，依赖方向由
`.dependency-cruiser.json` 检查；业务术语见 [GLOSSARY.md](GLOSSARY.md)。

## 许可证

MIT
