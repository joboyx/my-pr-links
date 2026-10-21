---
name: verify
description: Drives a real Claude Code session with this repo's copy of my-pr-links loaded, the way a user does, through tmux, and saves a screen capture per scenario with a pass or fail result. Use after a behaviour change, before a release, or when asked to prove the band works.
---

# verify

Start `claude --plugin-dir <repo>` in a detached tmux session, type `/my-pr-links` commands, read the screen with `tmux capture-pane -p`, and save each capture as proof.

Grouping rules (the key ladder, row title cleanup, shared-branch groups) have unit tests. Run `claude plugin test .` for them. This skill proves the wiring: load, commands, fetch, render, open and the title command.

## Control

| Command                    | Effect                                                     |
| -------------------------- | ---------------------------------------------------------- |
| `/my-pr-links`             | Toggle the band: hide it, or show it again                 |
| `/my-pr-links list`        | Print every PR of the last fetch                           |
| `/my-pr-links refresh`     | Fetch now; reply `N PRs from this session`                 |
| `/my-pr-links open <ref>`  | Open one PR (`14767`, `#14767`, `!42`)                    |
| `/my-pr-links add <url>`   | Add a PR or MR that the session did not touch              |

After a code change, run `/reload-plugins` in the session, or kill the tmux session and start again.

## Test data

Public PRs on well-known open-source repos. Each one was checked with `gh pr view <url> --json number`.

| URL                                         | Expected group                          |
| ------------------------------------------- | --------------------------------------- |
| `https://github.com/cli/cli/pull/14767`     | none (no key)                           |
| `https://github.com/cli/cli/pull/14722`     | none (no key)                           |
| `https://github.com/apache/kafka/pull/23862` | `KAFKA-21305` (title starts `KEY: `)   |
| `https://github.com/apache/kafka/pull/23867` | `KAFKA-21307` (branch is the key)      |

If one of them is gone, pick another merged PR from the same repo and check it with `gh pr view`.

## Setup

1. Preflight: `tmux -V`, `gh auth status --hostname github.com`. Stop if `gh` is not logged in.
2. Make the proof folder and the stubs. Shell state does not persist between tool calls, so the setup writes `lib.sh` with literal paths. Source it in each later call.

```sh
REPO="$(git rev-parse --show-toplevel)"
OUT="${TMPDIR:-/tmp}/my-pr-links-verify-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT/bin"

# $BROWSER stub: write the URL to a file, open nothing.
cat > "$OUT/bin/browser" <<EOF
#!/bin/sh
printf '%s\n' "\$1" >> "$OUT/opened.txt"
EOF

# Title command stub: log the key, print a fixed title.
cat > "$OUT/bin/title" <<EOF
#!/bin/sh
printf '%s\n' "\$1" >> "$OUT/title-calls.txt"
echo "Verify title for \$1"
EOF
chmod +x "$OUT/bin/browser" "$OUT/bin/title"

cat > "$OUT/lib.sh" <<EOF
REPO='$REPO'
OUT='$OUT'
start() { # start <session> [extra env assignments...]
  s="\$1"; shift
  tmux new-session -d -s "\$s" -x 220 -y 50 -c "\$REPO" "env -u MY_PR_LINKS_TASK_TITLE_CMD BROWSER='\$OUT/bin/browser' \$* claude --plugin-dir '\$REPO'"
}
send() { tmux send-keys -t "\$1" -l "\$2"; sleep 0.5; tmux send-keys -t "\$1" Enter; }
snap() { tmux capture-pane -p -t "\$1" > "\$OUT/\$2.txt"; echo "\$OUT/\$2.txt"; }
wait_for() { # wait_for <session> <grep -E pattern> [seconds]
  n="\${3:-30}"
  while [ "\$n" -gt 0 ]; do
    tmux capture-pane -p -t "\$1" | grep -Eq "\$2" && return 0
    sleep 1; n=\$((n - 1))
  done
  return 1
}
ready() { # ready <session>: accept the folder trust prompt if shown, then wait for the input line
  wait_for "\$1" 'trust this folder|^❯' 60 || return 1
  if tmux capture-pane -p -t "\$1" | grep -q 'trust this folder'; then
    tmux send-keys -t "\$1" Down; sleep 0.5; tmux send-keys -t "\$1" Enter; sleep 3
  fi
  wait_for "\$1" '^❯' 60
}
EOF
echo "$OUT"
```

Keep the printed `$OUT` path. Use a unique session name per run, for example `prl-a-<timestamp>` and `prl-b-<timestamp>`.

3. The folder trust prompt defaults to `No, exit`. `ready` selects `Yes, I trust this folder` with `Down`, then `Enter`. If a slash-command menu stays open after `send`, send `Enter` once more.

The band shows the short repo name (`cli`, `kafka`). Command replies stay on screen above the band, so match a band row by its columns (`#14767 +cli +Bump`), not by the ref alone.

`wait_for` patterns are extended regular expressions (`grep -E`): `+` means one or more, so `#14767 +cli ` matches the ref, one or more spaces, then `cli`.

The `list` output also holds the ref and the repo (`✔ #14767 cli — Bump…`). Where `list` ran earlier, match the band row only: two or more spaces and no em dash, such as `#14767 +cli +Bump`.

`snap` and `wait_for` read the visible screen, which is right for band checks. A reply can scroll off. Read reply text (`Added #…`, `PR band hidden.`) from the scrollback: `tmux capture-pane -p -S -200 -t "$A"`.

To change an env var of the session, pass it to `start` as an extra assignment. It comes after `BROWSER='$OUT/bin/browser'` in the `env` call, so the later assignment wins: `start "$C" "BROWSER=no-such-browser-xyz"`.

Between two `add` commands, wait up to 4 s for the reply to the first one: `wait_for <session> 'Added #<n>' 4`.

## Scenarios

Session A runs with no title command. Session B runs with the title command stub. Session C runs with a `BROWSER` that does not exist.

```sh
. "<OUT>/lib.sh"; A=prl-a-<timestamp>
start "$A"
ready "$A"; snap "$A" 00-start
```

| #  | Scenario                     | Steps (session A unless named)                                                                                 | Pass when                                                                                         |
| -- | ---------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1  | Plugin loads                 | `send "$A" '/my-pr-links list'`; `wait_for "$A" 'No pull requests'`; `snap "$A" 01-load`                       | Reply `my-pr-links: No pull requests created or updated in this session yet.`                     |
| 2  | Add                          | `send` `add` for `cli/cli/pull/14767`; `wait_for "$A" 'Added #14767' 4`; `send` `add` for `cli/cli/pull/14722`; `wait_for "$A" '#14722 +cli ' 60`; `snap "$A" 02-add` | Replies `Added #14767 to the band.` and `Added #14722 to the band.`; both rows show above the prompt |
| 3  | Plain list, no header        | Read `02-add.txt`                                                                                              | The rows have no header: no `other` line and no key line above them (`grep -E '^\s*other\b'` finds nothing) |
| 4  | List                         | `send "$A" '/my-pr-links list'`; `snap "$A" 04-list`                                                           | Output names `#14767` and `#14722` with their state                                               |
| 5  | Refresh                      | `send "$A" '/my-pr-links refresh'`; `wait_for "$A" '2 PRs from this session'`; `snap "$A" 05-refresh`         | Reply `2 PRs from this session`; the band shows `just now`                                        |
| 6  | Open via `$BROWSER`          | `send "$A" '/my-pr-links open #14767'`; `wait_for "$A" 'Opened'`; `snap "$A" 06-open`; `cat "$OUT/opened.txt"` | `opened.txt` holds `https://github.com/cli/cli/pull/14767`; reply starts `Opened cli #14767`; no browser window opens |
| 7  | Hide                         | `send "$A" '/my-pr-links'`; `wait_for "$A" 'PR band hidden'`; `sleep 2`; `snap "$A" 07-hide`                  | Reply `PR band hidden.` (read it from the scrollback); `grep -E '#14767 +cli +Bump' 07-hide.txt` finds nothing. The `list` output (`✔ #14767 cli — Bump…`) does not match that pattern |
| 8  | Show                         | `send "$A" '/my-pr-links'`; `wait_for "$A" '#14767 +cli +Bump'`; `snap "$A" 08-show`                           | Reply `PR band shown above the prompt.` (read it from the scrollback); the band rows are back (`#14767 +cli +Bump` matches) |
| 9  | Groups, title command off    | `send` `add` for `apache/kafka/pull/23862`; `wait_for "$A" 'Added #23862' 4`; `send` `add` for `apache/kafka/pull/23867`; `wait_for "$A" '#23867 +kafka ' 60`; `snap "$A" 09-groups-no-title` | Header lines `KAFKA-21305` and `KAFKA-21307` with no title text; the `cli` rows sit under `other`; `title-calls.txt` does not exist |
| 10 | Title command on             | `B=prl-b-<timestamp>`; `start "$B" "MY_PR_LINKS_TASK_TITLE_CMD='$OUT/bin/title'"`; `ready "$B"`; `send` `add` for `apache/kafka/pull/23862`; `wait_for "$B" 'Added #23862' 4`; `send` `add` for `cli/cli/pull/14767`; `wait_for "$B" 'Verify title for KAFKA-21305' 60`; `wait_for "$B" '#14767 +cli ' 60` (the title shows before the second fetch ends); `snap "$B" 10-title-on` | Header `KAFKA-21305` then `Verify title for KAFKA-21305`; `title-calls.txt` holds `KAFKA-21305` (the command runs once per ticket key per fetch, so the key can appear more than once); the `cli` row sits under `other` |
| 11 | Bad BROWSER                  | `C=prl-c-<timestamp>`; `start "$C" "BROWSER=no-such-browser-xyz"`; `ready "$C"`; `send` `add` for `cli/cli/pull/14767`; `wait_for "$C" 'Added #14767' 30`; `send "$C" '/my-pr-links open 14767'`; `wait_for "$C" 'Opened|could not open' 30`; `snap "$C" 11-bad-browser` | Reply is `Opened … ` (platform fallback) or `could not open … : <reason>`; the prompt returns and the session does not hang. On WSL the fallback opens a real browser tab once |
| 12 | Open CI via `$BROWSER`       | `send "$A" '/my-pr-links open #14767 ci'`; `wait_for "$A" 'Opened CI of'`; `snap "$A" 12-open-ci`; `tail -1 "$OUT/opened.txt"` | The last line of `opened.txt` is a check page such as `https://github.com/cli/cli/actions/runs/<id>/job/<id>`, not the PR URL; reply starts `Opened CI of cli #14767` |

For each scenario, compare the capture with the pass rule. On a fail, keep the capture, take one more capture after 10 s (a fetch can be slow), and record both.

## Cleanup

```sh
tmux kill-session -t "$A"; tmux kill-session -t "$B"; tmux kill-session -t "$C"
tmux ls 2>/dev/null | grep prl- || echo "no verify sessions left"
```

Keep `$OUT` for the report. Delete it only when the owner asks.

## Report

End with this table. Give the proof file as the full path under `$OUT`.

| # | Scenario                  | Result    | Proof                        |
| - | ------------------------- | --------- | ---------------------------- |
| 1 | Plugin loads              | pass/fail | `$OUT/01-load.txt`           |
| 2 | Add                       | pass/fail | `$OUT/02-add.txt`            |
| 3 | Plain list, no header     | pass/fail | `$OUT/02-add.txt`            |
| 4 | List                      | pass/fail | `$OUT/04-list.txt`           |
| 5 | Refresh                   | pass/fail | `$OUT/05-refresh.txt`        |
| 6 | Open via `$BROWSER`       | pass/fail | `$OUT/opened.txt`, `$OUT/06-open.txt` |
| 7 | Hide                      | pass/fail | `$OUT/07-hide.txt`           |
| 8 | Show                      | pass/fail | `$OUT/08-show.txt`           |
| 9 | Groups, title command off | pass/fail | `$OUT/09-groups-no-title.txt` |
| 10 | Title command on         | pass/fail | `$OUT/10-title-on.txt`, `$OUT/title-calls.txt` |
| 11 | Bad BROWSER              | pass/fail | `$OUT/11-bad-browser.txt`    |
| 12 | Open CI via `$BROWSER`   | pass/fail | `$OUT/opened.txt`, `$OUT/12-open-ci.txt` |

Under the table, quote the band lines from the capture of each failed scenario.
