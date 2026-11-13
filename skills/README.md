# skills

随插件发布的技能（中英两份）。目录结构对照上游 [mattpocock/skills](https://github.com/mattpocock/skills)：
`skills/<分类>/<技能名>/`，英文文件沿用上游文件名（如 `issue-tracker-gitea.md`），中文版加 `.zh.md` 后缀
（如 `issue-tracker-gitea.zh.md`）。上游技能升级时按同名文件对齐，不另起目录。

## 工单后端种子模板

`engineering/setup-matt-pocock-skills/` 下每种工单后端一份种子模板，初始化工作区时选用其中一份写进
`docs/agents/issue-tracker.md`。GitHub、GitLab 与本地 Markdown 的模板随上游技能提供；本插件新增的是
Gitea 版：`issue-tracker-gitea.md`（英）与 `issue-tracker-gitea.zh.md`（中）。

Gitea 后端的初始化约定：

1. 当前工作区 `origin` 远端的主机与 `tea logins list --output json` 里某个登录的主机一致时，默认推荐
   Gitea；用户也可以手动选择；
2. 选了 Gitea 但没有匹配的登录时停下来，让用户先运行 `tea login add`，不要写出一份用不了的配置；
3. 完成标志是在仓库目录里运行 `tea api /repos/{owner}/{repo}` 能返回仓库信息（`tea repo` 只列仓库，
   不能判断当前目录）；
4. 用 `tea labels create` 把缺失的分诊标签补齐，再写种子模板。
