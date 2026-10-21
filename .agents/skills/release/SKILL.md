---
name: release
description: Releases a new version of my-pr-links. Bumps the semver version in the plugin manifest, runs the unit tests, the manifest check and the verify skill, checks commit identities, commits, tags, and pushes only on the owner's explicit yes. Use when asked to release, cut a version, or tag the plugin.
---

# release

Run all steps from the repo root. Stop at the first failure and report it.

## 1. Check the start state

```sh
git status --short          # must be empty
git branch --show-current   # must be main
git fetch origin && git status -sb   # must not be behind origin
```

## 2. Pick the version

Read `version` in `.claude-plugin/plugin.json` and the commits since the last tag:

```sh
git describe --tags --abbrev=0
git log --oneline "$(git describe --tags --abbrev=0)"..HEAD
```

| Change since the last tag                         | Bump  |
| ------------------------------------------------- | ----- |
| Fixes only                                        | patch |
| New behaviour, old behaviour kept                 | minor |
| Removed or changed command, env var or behaviour  | major |

With no tag yet, release the current version without a bump.

Set the new `version` in `.claude-plugin/plugin.json`. If the plugin entry in `.claude-plugin/marketplace.json` has a `version`, set the same value there.

## 3. Test

```sh
claude plugin test .
claude plugin validate .
```

Both must exit 0.

## 4. Verify

Run the `verify` skill. Every scenario must pass. Keep its report table for step 8.

## 5. Check commit identities

```sh
git log --format='%h %an <%ae> | %cn <%ce>' "$(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)"..HEAD
git config user.name; git config user.email
```

Every author and committer must be the owner's public identity. If one is not, stop and show the owner the commits. Do not rewrite history without the owner's yes.

## 6. Commit

```sh
git add .claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "chore(release): vX.Y.Z"
```

## 7. Tag

`claude plugin tag .` checks that `plugin.json` and the marketplace entry agree, then makes the tag `my-pr-links--vX.Y.Z`.

```sh
claude plugin tag . --dry-run
claude plugin tag . -m "my-pr-links %s"
```

If `claude plugin tag` does not fit (for example the owner wants plain `vX.Y.Z` tags), use `git tag -a vX.Y.Z -m "my-pr-links vX.Y.Z"`.

## 8. Push on the owner's yes

Show the owner the version, the commit, the tag name and the verify table. Ask for an explicit yes. Only then:

```sh
git push origin main
git push origin <tag>
```

Never pass `--push` to `claude plugin tag`, and never force-push. Without a yes, stop and report that the commit and the tag are local.
