# my-pr-links

A Claude Code mod. It draws a band above the prompt with the pull requests that the session and its subagents created or updated: GitHub PRs through `gh`, GitLab merge requests through `glab`. Each row shows the state, CI, approvals, and each group shows the next action. Click a ref to open it in the browser.

```text
SHOP-214  Retry failed card payments  ▸ you merge #88 · just now
  ● #88   shop-api  api: back off on 503 responses  CI ✓  👍 1  ready to merge
  ◐ !41   web       show a retry banner             CI …        CI running
feature/dark-mode  ▸ review #91
  ○ #91   shop-api  add dark theme tokens           CI ✓  👍 0  in review
  ○ !43   web       add a dark mode toggle          CI ✓        in review
other  ✔ all 1 merged
  ✔ #90   shop-api  ci: cache node modules          CI ✓  👍 1  merged
```

## Requirements

- Claude Code with mod support.
- `gh` for GitHub, `glab` for GitLab, installed and logged in (`gh auth login`, `glab auth login`). Install only the one you use.

## Install

From GitHub:

```text
/plugin marketplace add joboyx/my-pr-links
/plugin install my-pr-links@my-pr-links
```

From a local clone, for one session:

```sh
claude --plugin-dir path/to/my-pr-links
```

## Usage

| Command                   | Effect                                                    |
| ------------------------- | --------------------------------------------------------- |
| `/my-pr-links`            | Hide the band, or show it again                           |
| `/my-pr-links list`       | Print every PR of the last fetch, with links              |
| `/my-pr-links refresh`    | Fetch now                                                 |
| `/my-pr-links open <ref>` | Open one PR: `42`, `!42`, `#88`                        |
| `/my-pr-links add <url>`  | Add a PR or MR that the session did not create or update  |

The band fetches again when a tool call creates or updates a PR, and every few minutes while it is open.

## Grouping

A ticket key matches `[A-Z][A-Z0-9]{1,9}-\d+`. The first rule that matches gives the group:

| # | Source               | Matches                                                       | Does not match            |
| - | -------------------- | ------------------------------------------------------------- | ------------------------- |
| 1 | Branch               | key at the start of a path segment: `feature/ABC-123-retry`, `ABC-123-ui` | `feature/fix-ABC-123` |
| 2 | Commit-style scope   | `feat(ABC-123): …`, `fix(api,ABC-123): …`                     |                           |
| 3 | Title prefix         | `ABC-123: …`, `[ABC-123] …`                                   | `ABC-123 fix retry`       |
| 4 | Description line     | `Refs: ABC-123`; also `Ref`, `Closes`, `Fixes`, `Resolves`, `Issue`, `Ticket`, `Task`, `Jira` | a key in running text |
| 5 | Shared source branch | no key, and 2 or more PRs share a branch that is not `main`, `master`, `develop`, `dev`, `trunk`, `staging` or `production` | |

Keys in running text never count (`UTF-8`, `SHA-256`, `ISO-8601`, `CVE-…`, `HTTP-2`). Lowercase keys such as `eng-123` are not supported.

Groups show first. PRs with no key go under `other` when a group exists. With no group, the band is a plain list with no header.

A row shows the PR title without the draft or WIP prefix, the commit type and the group's own key. An area scope stays as `scope: desc`. Rows are cut at 50 characters with `…`.

## Header titles

A group header shows the key. To also show a title, set `MY_PR_LINKS_TASK_TITLE_CMD` to the path of one executable.

- The mod runs `<cmd> <KEY>` with no shell, once per ticket key per fetch, with a 2 s timeout.
- The command gets Claude Code's environment.
- Exit 0 and a non-empty first stdout line: that line is the title. Any other result: no title.
- The mod does not call it for shared-branch groups.

Example for Jira Cloud:

```bash
#!/usr/bin/env bash
# jira-title: print the summary of one Jira issue.
set -euo pipefail
curl -fsS -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  "$JIRA_BASE_URL/rest/api/3/issue/$1?fields=summary" | jq -er .fields.summary
```

```sh
chmod +x ~/bin/jira-title
export MY_PR_LINKS_TASK_TITLE_CMD=~/bin/jira-title   # before you start claude
```

## Browser

Links open with `$BROWSER` when it is set. Else the mod uses `explorer.exe` on WSL, `open` on macOS and `xdg-open` on other systems.

## Development

See [AGENTS.md](AGENTS.md).

## License

MIT. See [LICENSE](LICENSE).
