# dsh-mattpocock-workflow

在 DSH 里运行 [mattpocock/skills](https://github.com/mattpocock/skills) 工作流的 MattWorkflow 任务面板插件。

右侧栏新增一个“MattWorkflow”页签，含两个视图：

- **列表**：读取当前工作区的工单与“可接 / 阻塞 / 已关闭”统计，支持按状态过滤、按状态/更新时间/创建时间/编号/标题排序，
  并把“新建需求”“+ bug”的预设提示词，以及每张票技能徽标对应的提示词填进当前会话输入框；
  点击工单行只选中，点击行内技能徽标才填入提示词；不可开工的票显示原因徽标，不提供注入入口。
  默认只看未关闭工单，并按“可接 → 阻塞 → 其他开放 → 已关闭”排序；筛选、排序键与方向按工作区记住，
  重新打开面板或切回该工作区时恢复。偏好只存在浏览器本地存储里，不随工作区删除而清理，最多保留 50 个工作区条目；
  存储不可用时静默退回默认视图；
- **环境检查**：打开时自动逐项检查主目录、后端选择、后端 CLI 是否安装并登录、仓库是否可达、工作区是否初始化、
  本地工单目录、面板用到的技能是否安装。每个失败项给出与原因对应的解决：工作区、技能与本地工单类给会话动作（只填提示词、不发送），
  CLI、登录与远端类给可复制的命令和文档链接，超时与探测失败给“重新检查”。前置项没通过时后续项标为“跳过”，
  并提供跳到根因项的入口。底部折叠的“能力诊断”列出插件用到的 DSH 宿主服务和界面扩展点是否可用，缺失项写明影响与补法。

面板只读工单与环境，不修改工单、不安装、不登录、不改文件，也不会自动发送提示词；解决区只提供命令与提示词，不代为执行。

工单后端按 `origin` 远端自动选择：

- `github.com` → GitHub，通过 `gh` 读取；
- `gitlab.com` 或 `glab` 已登录的自建实例 → GitLab，通过 `glab` 读取，支持嵌套 group；
- `tea` 已登录的自建 Gitea 实例 → Gitea，通过 `tea` 读取；
- 其余情况（没有 git、没有远端、主机不匹配）→ 本地 Markdown，读取
  `.scratch/<feature>/issues/*.md`。

面板顶部会标出当前后端（GitHub / GitLab / Gitea / 本地）；Gitea 后端还显示实例主机，便于区分多个
自建实例。四种后端共用同一套判定、统计、过滤排序与提示词注入。

GitLab 的阻塞信息分两段读取：列表返回就渲染，阻塞数先按描述 `Blocked by:` 回退；随后自动补齐原生 blocking link 并更新统计。
补齐失败时保留首屏结果、不打断使用，下次刷新会重新尝试。

## 环境要求

- DSH `>= 0.2.0-rc.2`；
- GitHub：已安装并登录 GitHub CLI（`gh auth login`）；
- GitLab：已安装 GitLab CLI 并登录（`glab auth login`）；自建实例需要登录该实例。
  最低支持 `glab` 1.126（本插件验证的版本）；更早版本未验证，登录状态识别失败时会回退本地 Markdown；
- Gitea：已安装 `tea` 0.16 或更高版本并登录实例（`tea login add`）；自建实例需要登录该实例；
- 当前工作区是 git 仓库且有远端；或直接把工单放在 `.scratch/<feature>/issues/NN-<slug>.md`
  （见 [本地工单约定](docs/local-issues.md)）。
- 同一个工作区有多个远端时，以 `origin` 为准；同一个主机同时出现在 `glab` 与 `tea` 的登录列表里时按
  GitLab 处理。

缺 `gh` / `glab` / `tea` 或未登录时，列表会显示对应的操作提示，并提供“查看环境检查”入口；读取 `.scratch` 失败时只给出文件权限提示。
自建 GitLab 或 Gitea 未在对应 CLI 登录时，面板回退本地 Markdown，并在顶部标明“本地”；环境检查会点名缺的是安装还是登录，
给出 `gh auth login` / `glab auth login` / `tea login add` 这类可执行建议。
Gitea 后端选定之后，如果 `tea` 不见了、令牌失效或权限不够，列表会显示安装或重新登录的提示
（`tea-missing` / `tea-unauthenticated`），环境检查里的 Gitea 三项也会给出同样的结论。

## 开发

见 [CONTRIBUTING.md](CONTRIBUTING.md)。开发时用 `pnpm dev` 同时 watch 宿主与客户端构建，配合 DSH HMR
做到保存即刷新。各层的约定写在 `src/<层>/README.md`，依赖方向由
`.dependency-cruiser.json` 检查；业务术语见 [GLOSSARY.md](GLOSSARY.md)。

## 许可证

MIT
