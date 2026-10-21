# AGENTS.md

`my-pr-links` is a Claude Code mod. It draws a band above the prompt that lists the pull requests (GitHub PRs via `gh`, GitLab merge requests via `glab`) that the session and its subagents created or updated.
The plugin lives at the repo root. User docs are in `README.md`.

## Layout

| Path                              | Content                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| `.claude-plugin/plugin.json`      | Plugin manifest: name, `version`, listing fields, `userConfig`                       |
| `.claude-plugin/marketplace.json` | Marketplace `my-pr-links` with one plugin, `source: "./"`                            |
| `.claude-plugin/types/`           | Mod API types that Claude Code generates; git-ignored (see below)                    |
| `hooks/hooks.json`                | Hook module list                                                                     |
| `hooks/register.tsx`              | Command, `tool.call` tracking, fetch, band render, link open                         |
| `hooks/prs.ts`                    | Pure logic: URL parse, `gh`/`glab` JSON to rows, group keys, titles, `$BROWSER` argv |
| `hooks/fixtures.ts`               | Test data in the shape of `gh` and `glab api` JSON output                            |
| `hooks/*.test.ts`                 | Unit tests                                                                           |
| `types/index.d.ts`                | Types of the plugin's own state (`PluginState`)                                      |
| `.agents/skills/`                 | Repo skills `verify` and `release` (`.claude/skills` links here)                     |

Claude Code writes `.claude-plugin/types/` beside the mod when it loads the mod from this folder, and writes it again after a Claude Code update. The folder's own `.gitignore` keeps it out of git. The first line of `claude-code/index.d.ts` names the Claude Code version that wrote it. A fresh clone gets the folder on the first load, such as `claude --plugin-dir .`. Do not edit it.

## Commands

Run from the repo root.

| Task                         | Command                                           |
| ---------------------------- | ------------------------------------------------- |
| Unit tests                   | `claude plugin test .`                            |
| Manifest and layout check    | `claude plugin validate . --strict`               |
| Plugin directory check       | `claude plugin validate . --profile directory`    |
| Load this copy for a session | `claude --plugin-dir .`                           |
| Tag a release                | `claude plugin tag .` (tag `my-pr-links--vX.Y.Z`) |

After a code change in a running session, run `/reload-plugins`, or restart `claude`.

## Group keys

A ticket key matches `[A-Z][A-Z0-9]{1,9}-\d+`. The first rule that matches gives the group key:

1. Branch: a key at the start of a path segment (`feature/ABC-123-retry`, `ABC-123-ui`).
2. Conventional-commit scope is a key, also inside a scope list (`feat(ABC-123): …`, `fix(api,ABC-123): …`).
3. The title, or its text after the commit type, starts with `KEY: ` or `[KEY] ` (`ABC-123: x`, `feat: ABC-123: x`). A bare `ABC-123 x` does not count.
4. A description line that starts with the whole word `Refs|Ref|Closes|Fixes|Resolves|Issue|Ticket|Task|Jira` (any case), an optional `:`, then a `,`/`;` list. The first list item that is a whole key wins; a leading `#` and a trailing `.` are dropped (`Refs: ABC-123.`, `Closes #12, ABC-2` gives `ABC-2`). The match never crosses lines.
5. No key, and 2 or more PRs in the band share a source branch that is not `main`, `master`, `develop`, `dev`, `trunk`, `staging` or `production`: the branch name is the key.

Keys in running text never count. A key whose letter part is `CVE`, `UTF`, `SHA`, `ISO`, `HTTP`, `RFC`, `TLS`, `MD` or `GHSA` never counts in any rule (`STANDARD_PREFIXES` in `hooks/prs.ts`). Lowercase keys (`eng-123`) are not supported. Only a lowercase word is a conventional-commit type.
The description is read for rule 4 in `fromGitlab` / `fromGithub` and is not stored. A change to the stored `Pr` shape bumps the `shape` tag of the `snapshot` atom in `hooks/register.tsx`.
Groups show first. Keyless PRs go under a bare `other` header when a group exists. With no group, the band is a plain list with no header.

## Title command contract

- The `task_title_cmd` option (`userConfig` in `plugin.json`, passed as `register(on, options)`) holds the path to one executable. When it is empty, `MY_PR_LINKS_TASK_TITLE_CMD` gives the path. When neither is set, nothing runs.
- `claude plugin configure my-pr-links@my-pr-links` sets the option for an installed copy only; it cannot reach a `--plugin-dir` session, so use the env var there. Tests set it with `test(name, { options: { task_title_cmd } }, body)`.
- The mod runs `<cmd> <KEY>` with no shell, once per ticket key per fetch, with a 2 s timeout and Claude Code's environment.
- Exit 0 and a non-empty first stdout line: that line is the header title. Any other result: no title.
- The mod never calls it for shared-branch groups (rule 5).

## Rules

- Use made-up names only in examples, fixtures, tests and docs: orgs `acme`, `octo-org`; repos `acme/shop-api`, `acme/web`; users `octo-user`; keys `SHOP-214`, `ABC-123`. Never paste real API output, real org, repo or ticket names, or real user logins. The one exception: the `verify` skill adds public PRs of well-known open-source repos at run time.
- Keep the plugin free of one team's conventions. Behaviour that fits only one setup goes behind a generic extension point, such as the title command.
- Fixtures mirror the real JSON shape of `gh pr view --json` and `glab api`: same field names, same nesting.
- Pure logic goes in `hooks/prs.ts` with unit tests. `hooks/register.tsx` holds only the wiring to Claude Code.
- Every exported function, type and constant has a JSDoc block.

## Skills

- `verify` (`.agents/skills/verify/SKILL.md`): drive a real session with this copy loaded and capture proof per scenario. Run it after a behaviour change.
- `release` (`.agents/skills/release/SKILL.md`): bump the version, test, verify, commit, tag, push on the owner's yes.
