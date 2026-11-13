# 本地工单约定

没有可用托管后端时，插件读取工作区里的本地 Markdown 工单。环境检查的“本地工单目录可用”一项也按本约定判断，
只读扫描，不创建、不改写任何文件。

## 位置

```
<workspaceRoot>/.scratch/<feature>/issues/NN-<slug>.md
```

- 只扫描一层 feature 目录；`spec.md`、`map.md` 等放在 feature 目录下即可，不要放进 `issues/`；
- `issues/` 下只认 `.md` 文件，其他扩展名会被忽略。

## 文件格式

```md
# 工单标题

Status: ready-for-agent
Blocked by: 01, 03

## Comments

后续评论。
```

- `# 标题` 取第一处一级标题；缺失时用去掉编号前缀的文件名；
- `Status:` 必须在 `## Comments` 之前，只取第一个词并转成小写；`resolved` 视为已关闭，其余视为开放；
- `Blocked by:` 指向同一 feature 下另一张工单的编号；被阻塞票未关闭时，当前票算阻塞；
- `## Comments` 之后的 `Status:` / `Blocked by:` 不参与判定。

## 环境检查

“本地工单目录可用”只在本地 Markdown 后端下检查；后端尚未判定（探测失败）时也会检查，
因为回退的可能就是本地 Markdown。GitHub、GitLab、Gitea 的工单在远端，不出现这一项。

- 找到可解析的工单文件：通过，依据列出文件数量与相对路径；
- 工作区没有 `.scratch`：失败，提示先建目录；
- `.scratch` 下没有 `.md` 工单文件：失败，提示文件应放在 `<feature>/issues/`；
- 工单文件缺少可解析的 `Status:` 行：失败，并点名具体文件。

修复建议统一指向本文件。
