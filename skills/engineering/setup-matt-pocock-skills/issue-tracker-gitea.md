# Issue tracker: Gitea

Issues and specs for this repo live as Gitea issues. Use the [`tea`](https://gitea.com/gitea/tea) CLI for all operations. Requires `tea` 0.16 or newer: this document relies on `tea api`, `tea comments`, and `tea issues edit --description-file`.

Run every command inside the clone. `tea` infers the instance from its login and the repo from `git remote`. To verify the current directory resolves to a repository your login can read, run `tea api /repos/{owner}/{repo}`; it returns the repo on success and fails outside a clone or without a matching login. `tea repo` merely lists the repos your logins can see, so it is not a per-directory check.

## Conventions

- **Create an issue**: `tea issues create --title "..." --description-file <path> --labels "bug,ready-for-agent"`. Write multi-line bodies to a file first so shell quoting can't corrupt them; `--description -` reads stdin.
- **Read an issue**: `tea issues <n> --comments` prints the body and its comments. For machine-readable output use the API: `tea api /repos/{owner}/{repo}/issues/<n>` and `tea api /repos/{owner}/{repo}/issues/<n>/comments`.
- **List issues**: `tea issues list --state all --kind issues --labels "ready-for-agent" --output json` for a filtered view. For an exhaustive list, page the API (see **Paging**).
- **Paging**: `tea api --include` writes the status line and headers to stderr, including `X-Total-Count`. Request `limit=50` (Gitea's default cap), then keep requesting `page=2`, `page=3`, … until you have `X-Total-Count` issues.
- **Comment on an issue**: `tea comments <n> "<body>"` (alias `tea comment`).
- **Apply / remove labels**: `tea issues edit <n> --add-labels "..."` / `--remove-labels "..."`. Create a missing label first with `tea labels create --name "..." --color "#ededed"`.
- **Close**: post the explanation with `tea comments <n> "<reason>"`, then `tea issues close <n>`. Reopen with `tea issues reopen <n>`.
- **Update a spec in place**: `tea issues edit <n> --description-file <path>`. Never create a second issue for the same spec.

Only read issue endpoints. `tea issues list --kind issues` and `type=issues` keep pull requests out; never count them as tickets.

## Parent and child tickets

Gitea has no sub-issues. Put `Part of #<parent>` at the top of the child body, and register the child in the parent body's task list as `- [ ] #<child>`.

## Blocking

Gitea's **native issue dependencies** are canonical and visible in the web UI. `tea` has no dedicated subcommand, so use the API:

- **Read blockers**: `tea api /repos/{owner}/{repo}/issues/<n>/dependencies` lists the issues that block `<n>`. A ticket is unblocked when every blocker is closed.
- **Add a blocker**: `tea api --method POST /repos/{owner}/{repo}/issues/<child>/dependencies -F index=<blocker>`.
- **Remove a blocker**: `tea api --method DELETE /repos/{owner}/{repo}/issues/<child>/dependencies -F index=<blocker>`.

The instance or the repo can disable issue dependencies; the API then answers 404. In that case put `Blocked by: #<n>, #<n>` at the top of the child body and use that line to judge blocking.

## Triage labels

List the labels the repo already has with `tea labels list --output json`, then create only the missing ones, so labelling can't fail and creating an existing label doesn't error:

```bash
tea labels create --name "needs-triage" --color "#ededed"
tea labels create --name "needs-info" --color "#d4c5f9"
tea labels create --name "ready-for-agent" --color "#0e8a16"
tea labels create --name "ready-for-human" --color "#1d76db"
tea labels create --name "wontfix" --color "#ffffff"
tea labels create --name "bug" --color "#d73a4a"
tea labels create --name "enhancement" --color "#a2eeef"
```

## Publishing to the issue tracker

When publishing a spec, resolve the target issue first: if the user passed an issue number or URL, or the conversation already identifies one, update it in place with `tea issues edit <number> --description-file <path>` instead of creating another. When publishing tickets, each ticket is a new issue unless it already exists.

If no target is identified, search open issues for a match and ask the user before creating one. Never create a second issue for the same spec.

## Fetching the relevant ticket

Read it as in **Read an issue** above, with `--comments` so the discussion comes along.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue labelled `wayfinder:map`; **child** issues are the tickets.

- **Map**: `tea issues create --title "..." --description-file <path> --labels "wayfinder:map"`, holding the Notes / Decisions-so-far / Fog body.
- **Child ticket**: put `Part of #<map>` at the top of the child body, register it in the map's task list, and label it `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: see **Blocking** under Conventions.
- **Frontier query**: list the open issues carrying a `wayfinder:<type>` label, keep those whose body contains `Part of #<map>`, drop any with an open blocker (native dependencies, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `tea issues edit <n> --add-assignees <your-username>`, the session's first write.
- **Resolve**: `tea comments <n> "<answer>"`, then `tea issues close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far with `tea issues edit <map> --description-file <path>`.

## Safety

File issues only into the user's own repo. When several Gitea instances are logged in, confirm the target before the first write of a session with `tea api /repos/{owner}/{repo}` (it prints the repository the current clone resolves to); add `--login <name>` to pin the instance explicitly. Never file into the repo these skills come from unless the user owns it.
