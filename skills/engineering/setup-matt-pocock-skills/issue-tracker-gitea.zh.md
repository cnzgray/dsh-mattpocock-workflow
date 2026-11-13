# 工单后端：Gitea

本仓库的 issue 和 spec 都放在 Gitea 上，所有操作统一用 [`tea`](https://gitea.com/gitea/tea) 命令行完成。要求 `tea` 0.16 或更高版本：本文依赖 `tea api`、`tea comments` 与 `tea issues edit --description-file`。

所有命令都在仓库目录里执行。`tea` 从登录配置推断实例、从 `git remote` 推断仓库。要确认当前目录能解析到登录可见的仓库，运行 `tea api /repos/{owner}/{repo}`：成功时返回仓库信息，不在克隆目录或没有匹配的登录时会失败。`tea repo` 只是列出登录可见的仓库，不能用来判断当前目录。

## 约定

- **建票**：`tea issues create --title "..." --description-file <文件> --labels "bug,ready-for-agent"`。多行正文先写进文件，避免 shell 转义弄坏内容；`--description -` 从标准输入读。
- **读票**：`tea issues <n> --comments` 打印正文与评论。要机器可读时用 API：`tea api /repos/{owner}/{repo}/issues/<n>` 与 `tea api /repos/{owner}/{repo}/issues/<n>/comments`。
- **列表**：`tea issues list --state all --kind issues --labels "ready-for-agent" --output json` 做带过滤的查看。要拿全量就按页读 API（见 **分页**）。
- **分页**：`tea api --include` 把状态行和响应头写到标准错误，其中包含 `X-Total-Count`。请求 `limit=50`（Gitea 的默认返回上限），然后一直请求 `page=2`、`page=3`…… 直到拿到的条数等于 `X-Total-Count`。
- **评论**：`tea comments <n> "<正文>"`（别名 `tea comment`）。
- **加减标签**：`tea issues edit <n> --add-labels "..."` / `--remove-labels "..."`。缺标签时先用 `tea labels create --name "..." --color "#ededed"` 建出来。
- **关闭**：先用 `tea comments <n> "<原因>"` 写明原因，再 `tea issues close <n>`。重新打开用 `tea issues reopen <n>`。
- **原地更新 spec**：`tea issues edit <n> --description-file <文件>`。同一份 spec 绝不另建一张票。

只读 issue 接口。`tea issues list --kind issues` 与 `type=issues` 会把 pull request 挡在外面；不要把 PR 当成票来统计。

## 父子关系

Gitea 没有子 issue。子票正文顶部写 `Part of #<父票>`，并在父票正文的任务列表里登记子票：`- [ ] #<子票>`。

## 阻塞

Gitea 原生的 issue 依赖是规范的、网页上也可见的表示。`tea` 没有专门的子命令，所以走 API：

- **读阻塞票**：`tea api /repos/{owner}/{repo}/issues/<n>/dependencies` 列出阻塞 `<n>` 的票。所有阻塞票都关闭后，这张票才算解除阻塞。
- **加阻塞关系**：`tea api --method POST /repos/{owner}/{repo}/issues/<子票>/dependencies -F index=<阻塞票>`。
- **删阻塞关系**：`tea api --method DELETE /repos/{owner}/{repo}/issues/<子票>/dependencies -F index=<阻塞票>`。

实例或仓库可以关闭 issue 依赖功能，此时接口返回 404。这种情况下把 `Blocked by: #<n>, #<n>` 写在子票正文顶部，改用这一行判断阻塞。

## 分诊标签

先用 `tea labels list --output json` 列出仓库已有的标签，只建缺的那些，这样打标签不会失败，也不会因为重复创建报错：

```bash
tea labels create --name "needs-triage" --color "#ededed"
tea labels create --name "needs-info" --color "#d4c5f9"
tea labels create --name "ready-for-agent" --color "#0e8a16"
tea labels create --name "ready-for-human" --color "#1d76db"
tea labels create --name "wontfix" --color "#ffffff"
tea labels create --name "bug" --color "#d73a4a"
tea labels create --name "enhancement" --color "#a2eeef"
```

## 发布到工单后端

发布 spec 时先确定目标票：用户给了票号或链接，或者对话里已经指明是哪张票，就用 `tea issues edit <票号> --description-file <文件>` 原地更新，不再另建一张。发布 tickets 时，每张票都是一个新 issue，除非它已经存在。

没有指定目标时，先搜索开放的票看有没有匹配的，并在建票前问用户。同一份 spec 绝不建第二张票。

## 读取相关工单

按 **读票** 一节执行，带上 `--comments`，把讨论一起读进来。

## wayfinder 操作

供 `/wayfinder` 使用。**地图**是一张带 `wayfinder:map` 标签的 issue；**子票**就是它的子 issue。

- **地图**：`tea issues create --title "..." --description-file <文件> --labels "wayfinder:map"`，正文放 Notes / Decisions-so-far / Fog。
- **子票**：正文顶部写 `Part of #<地图>`，在 地图的任务列表里登记，并打 `wayfinder:<type>` 标签（`research`/`prototype`/`grilling`/`task`）。认领后把它指派给负责推进的开发者。
- **阻塞**：见 **约定** 里的 **阻塞**。
- **前沿查询**：列出带 `wayfinder:<type>` 标签的开放票，只保留正文里含 `Part of #<地图>` 的，去掉有未关闭阻塞票的（原生依赖，或 `Blocked by` 行里指向未关闭票）和有指派人的；按地图顺序取第一张。
- **认领**：`tea issues edit <n> --add-assignees <你的用户名>`，这是本次会话的第一次写操作。
- **结案**：`tea comments <n> "<答案>"`，然后 `tea issues close <n>`，再把上下文指针（gist + 链接）追加到地图的 Decisions-so-far：`tea issues edit <地图> --description-file <文件>`。

## 安全

只往用户自己的仓库建票。同时登录了多个 Gitea 实例时，第一次写操作前先用 `tea api /repos/{owner}/{repo}` 确认当前目录解析到的实例与仓库；需要固定实例时加 `--login <名称>`。除用户自己拥有外，绝不往这些 skills 的来源仓库建票。
