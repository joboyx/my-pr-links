import { atom, read, update } from 'claude-code';
import type {
  EngineInterface,
  ProcessRunInit,
  Register,
  RenderChildren,
  SessionMessage,
} from 'claude-code';

import {
  ageOf,
  browserArgv,
  buildGroups,
  CI_TEXT,
  trackedUrls,
  fromGithub,
  fromGitlab,
  hasHeaders,
  isFinished,
  isReadyUnapproved,
  listText,
  LOOK,
  nextOf,
  outcomeOf,
  parsePrUrl,
} from './prs';
import type {
  GithubPrView,
  GitlabMrApprovals,
  GitlabMrDetail,
  GitlabMrItem,
  Pr,
  PrGroup,
  PrLink,
  Next,
  Snapshot,
} from './prs';

/**
 * PR band: the pull requests (GitHub PRs and GitLab merge requests) this session
 * (or one of its subagents) created or updated, above the prompt, grouped by
 * ticket key or shared source branch and fetched one by one with `glab` and
 * `gh`. Click a PR to open it in the host browser; hover it for the full
 * title. `/my-pr-links` shows or hides the band, `list` prints every PR of
 * the last fetch, `refresh` fetches now, `add <url>` adds a PR the session
 * did not touch. The `task_title_cmd` option, else `MY_PR_LINKS_TASK_TITLE_CMD`,
 * names an executable that prints the header title of a ticket key.
 */

const STALE_MS = 3 * 60 * 1000;
// How often the band checks whether its snapshot is stale.
const TICK_MS = 60 * 1000;
// How long the title command may run for one ticket key.
const TITLE_TIMEOUT_MS = 2000;
// How long the browser opener may run.
const OPEN_TIMEOUT_MS = 10000;

const GITHUB_VIEW_FIELDS =
  'number,title,body,url,isDraft,state,headRefName,baseRefName,reviewDecision,statusCheckRollup,mergeStateStatus,latestReviews';

const isHidden = atom({ plugin: 'my-pr-links', key: 'isHidden' } as const, false);
const snapshot = atom({ plugin: 'my-pr-links', key: 'snapshot' } as const, null, {
  shape: 'prs-3',
});
const created = atom({ plugin: 'my-pr-links', key: 'created' } as const, []);

// One refresh at a time per session; later callers share the running one and
// set `isPending`, so it fetches once more when done.
let inFlight: Promise<Snapshot> | undefined;
let isPending = false;

/**
 * What one PR's fetch found: the PR, an error line when its call failed, or
 * neither when its CLI is not installed.
 */
type PrResult = { pr?: Pr; error?: string };

/**
 * What a JSON call returned: its parsed output, or an error line for the band.
 */
type JsonResult = { value: unknown } | { error: string };

/**
 * The part of `gh auth status --json hosts --hostname github.com` the fetch
 * reads: each github.com login, whether its token works, and which is active.
 */
type GhAuthStatus = {
  hosts?: Record<string, { login: string; state: string; active: boolean }[]>;
};

/**
 * The github.com accounts one snapshot can run `gh` as: the logins whose
 * token works, the active one among them, and each other login's token,
 * read on first use and kept only for that snapshot.
 */
type GithubAuth = {
  logins: string[];
  active?: string;
  tokens: Map<string, Promise<string | undefined>>;
};

const NEXT_LOOK: Record<Next['kind'], { color: string; bold: boolean }> = {
  failing: { color: 'error', bold: true },
  you: { color: 'warning', bold: true },
  waiting: { color: 'inactive', bold: false },
  done: { color: 'merged', bold: false },
};

/**
 * Runs a CLI call that prints JSON. Resolves `undefined` when the binary
 * cannot start (a machine without that CLI), an error line when it exits
 * non-zero or prints something other than JSON.
 */
async function jsonCall(
  $: EngineInterface,
  argv: string[],
  init?: ProcessRunInit,
): Promise<JsonResult | undefined> {
  const tool = argv[0] ?? '';
  let out;
  try {
    out = await $.process.run(argv, init);
  } catch {
    return undefined;
  }
  if (out.exitCode !== 0) {
    const line = out.stderr
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean);
    return { error: `${tool}: ${(line ?? `exit ${out.exitCode}`).slice(0, 80)}` };
  }
  try {
    return { value: JSON.parse(out.stdout) as unknown };
  } catch {
    return { error: `${tool}: unparseable JSON` };
  }
}

/**
 * `glab api` arguments for a path on the PR's GitLab host.
 */
function glabApi(link: PrLink, path: string): string[] {
  return link.host === 'gitlab.com'
    ? ['glab', 'api', path]
    : ['glab', 'api', path, '--hostname', link.host];
}

/**
 * Fetches one GitLab MR (with its head pipeline) and its approvals. The
 * approvals are left out when their call fails.
 */
async function fetchGitlab($: EngineInterface, link: PrLink): Promise<PrResult> {
  const path = `projects/${encodeURIComponent(link.projectPath)}/merge_requests/${link.iid}`;
  const [found, approvals] = await Promise.all([
    jsonCall($, glabApi(link, path)),
    jsonCall($, glabApi(link, `${path}/approvals`)),
  ]);
  if (!found) return {};
  if ('error' in found) return { error: found.error };
  const item = found.value as GitlabMrItem & GitlabMrDetail;
  const given =
    approvals && 'value' in approvals ? (approvals.value as GitlabMrApprovals) : undefined;
  return { pr: fromGitlab(item, item, given) };
}

/**
 * The github.com accounts `gh` is logged in to with a working token, read
 * once per snapshot and only when one of `urls` is a GitHub PR. No logins
 * when `gh auth status` fails or `gh` is missing, so each PR is fetched as
 * the active account alone.
 */
async function githubAuthOf($: EngineInterface, urls: readonly string[]): Promise<GithubAuth> {
  const none: GithubAuth = { logins: [], tokens: new Map() };
  if (!urls.some((url) => parsePrUrl(url)?.provider === 'github')) return none;
  const found = await jsonCall($, [
    'gh',
    'auth',
    'status',
    '--json',
    'hosts',
    '--hostname',
    'github.com',
  ]);
  if (!found || 'error' in found) return none;
  const accounts = (found.value as GhAuthStatus).hosts?.['github.com'] ?? [];
  const working = accounts.filter((a) => a.state === 'success');
  return {
    logins: working.map((a) => a.login),
    active: working.find((a) => a.active)?.login,
    tokens: new Map(),
  };
}

/**
 * The order to try the accounts in for a PR of `owner`: the login named
 * like the owner (any case), then the active login, then the others.
 */
function githubCandidatesOf(auth: GithubAuth, owner: string): string[] {
  const own = auth.logins.filter((l) => l.toLowerCase() === owner.toLowerCase());
  const active = auth.active ? [auth.active] : [];
  return [...new Set([...own, ...active, ...auth.logins])];
}

/**
 * Reads the token of one github.com login with `gh auth token`; `undefined`
 * when `gh` cannot give it, so that account is skipped.
 */
async function readGithubToken($: EngineInterface, login: string): Promise<string | undefined> {
  try {
    const out = await $.process.run([
      'gh',
      'auth',
      'token',
      '--hostname',
      'github.com',
      '--user',
      login,
    ]);
    const token = out.stdout.trim();
    return out.exitCode === 0 && token ? token : undefined;
  } catch {
    return undefined;
  }
}

/**
 * How one `gh` call runs as `login`: plainly for the active account, else
 * with that account's token in `GH_TOKEN` (read once per snapshot);
 * `undefined` when the token cannot be read.
 */
async function githubRunAs(
  $: EngineInterface,
  auth: GithubAuth,
  login: string,
): Promise<ProcessRunInit | undefined> {
  if (login === auth.active) return {};
  let token = auth.tokens.get(login);
  if (!token) {
    token = readGithubToken($, login);
    auth.tokens.set(login, token);
  }
  const value = await token;
  return value ? { env: { GH_TOKEN: value } } : undefined;
}

/**
 * Fetches one GitHub pull request with its checks and review decision, as
 * each candidate account in turn until one can read it. When every account
 * fails, the first attempt's error line; with no account to try, one plain
 * call as the active account.
 */
async function fetchGithub($: EngineInterface, link: PrLink, auth: GithubAuth): Promise<PrResult> {
  const argv = ['gh', 'pr', 'view', link.url, '--json', GITHUB_VIEW_FIELDS];
  const owner = link.projectPath.split('/')[0] ?? '';
  let firstError: string | undefined;
  for (const login of githubCandidatesOf(auth, owner)) {
    const init = await githubRunAs($, auth, login);
    if (!init) continue;
    const found = await jsonCall($, argv, init);
    if (!found) return {};
    if ('value' in found) return { pr: fromGithub(found.value as GithubPrView) };
    firstError ??= found.error;
  }
  if (firstError) return { error: firstError };

  const found = await jsonCall($, argv);
  if (!found) return {};
  if ('error' in found) return { error: found.error };
  return { pr: fromGithub(found.value as GithubPrView) };
}

/**
 * Fetches one created PR from its provider.
 */
async function fetchPr($: EngineInterface, url: string, auth: GithubAuth): Promise<PrResult> {
  const link = parsePrUrl(url);
  if (!link) return {};
  return link.provider === 'gitlab' ? fetchGitlab($, link) : fetchGithub($, link, auth);
}

/**
 * The header title of one ticket key from the title command: the trimmed
 * first line it prints when it exits 0, else `undefined` (non-zero exit,
 * empty output, timeout or a command that cannot start).
 */
async function titleOf($: EngineInterface, command: string, key: string): Promise<string | undefined> {
  try {
    const out = await $.process.run([command, key], { timeoutMs: TITLE_TIMEOUT_MS });
    const line = out.stdout.split('\n')[0]?.trim();
    return out.exitCode === 0 && line ? line : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The header title of each ticket key, from the title command run as
 * `<cmd> <KEY>` (no shell) once per key. The command is the `task_title_cmd`
 * option (`titleOption`) when it is set, else the executable that
 * `MY_PR_LINKS_TASK_TITLE_CMD` names. No titles when neither is set; a key
 * the command gives no title for stays untitled.
 */
async function ticketTitles(
  $: EngineInterface,
  keys: readonly string[],
  titleOption: string,
): Promise<Record<string, string>> {
  if (keys.length === 0) return {};
  const command = titleOption || (await $.env.get('MY_PR_LINKS_TASK_TITLE_CMD'))?.trim();
  if (!command) return {};
  const found = await Promise.all(keys.map((key) => titleOf($, command, key)));
  const titles: Record<string, string> = {};
  keys.forEach((key, i) => {
    const title = found[i];
    if (title) titles[key] = title;
  });
  return titles;
}

/**
 * Fetches each created PR, groups them with the stack bases of the previous
 * snapshot, and saves the snapshot to the state the band draws.
 * `titleOption` is the `task_title_cmd` option, empty when unset.
 */
async function fetchSnapshot(
  $: EngineInterface,
  urls: readonly string[],
  titleOption: string,
): Promise<Snapshot> {
  const fetchedAt = await $.clock.now();
  const auth = await githubAuthOf($, urls);
  const results = await Promise.all(urls.map((url) => fetchPr($, url, auth)));
  const prs = results.flatMap((r) => (r.pr ? [r.pr] : []));
  const errors = [...new Set(results.flatMap((r) => (r.error ? [r.error] : [])))];

  const keys = [...new Set(prs.flatMap((m) => (m.ticket ? [m.ticket] : [])))];
  // The previous snapshot keeps a stacked PR after its base once the base merged.
  const previous = allPrs(await read($, snapshot));
  const groups = buildGroups(prs, await ticketTitles($, keys, titleOption), previous);

  const snap: Snapshot = { fetchedAt, groups, errors };
  await update($, snapshot, () => snap);
  return snap;
}

/**
 * Fetches the created PRs, then once more when a refresh was asked for while
 * the fetch ran (a PR created meanwhile); several such asks share one fetch.
 */
async function fetchCurrent($: EngineInterface, titleOption: string): Promise<Snapshot> {
  let snap = await fetchSnapshot($, await read($, created), titleOption);
  while (isPending) {
    isPending = false;
    snap = await fetchSnapshot($, await read($, created), titleOption);
  }
  return snap;
}

/**
 * Refreshes the snapshot, or joins the refresh already running and asks it
 * for one more fetch.
 */
function refresh($: EngineInterface, titleOption: string): Promise<Snapshot> {
  if (inFlight) isPending = true;
  inFlight ??= fetchCurrent($, titleOption).finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}

/**
 * Adds the URLs not yet tracked to the session's tracked PRs. Resolves
 * whether any was new.
 */
async function track($: EngineInterface, urls: string[]): Promise<boolean> {
  const known = await read($, created);
  const fresh = urls.filter((url) => !known.includes(url));
  if (fresh.length === 0) return false;
  await update($, created, (was) => [...was, ...fresh.filter((url) => !was.includes(url))]);
  return true;
}

/**
 * The PR URLs the tool uses of a transcript created or updated, and those of every
 * agent an Agent tool use there spawned, nested agents included. `seen`
 * holds the agent ids already read; an agent the session cannot read is
 * skipped.
 */
async function createdInTranscript(
  $: EngineInterface,
  messages: readonly SessionMessage[],
  seen: Set<string>,
): Promise<string[]> {
  const urls: string[] = [];
  for (const use of messages.flatMap((m) => m.toolUses)) {
    urls.push(...trackedUrls(use.tool, use.input, use.text ?? ''));
    if (!use.agentId || seen.has(use.agentId)) continue;
    seen.add(use.agentId);
    const child = await $.session.messages({ agentId: use.agentId });
    if (!('deny' in child)) urls.push(...(await createdInTranscript($, child, seen)));
  }
  return urls;
}

/**
 * Tracks the PRs the session created before the band loaded (a restart or
 * resume), then fetches when the session has any.
 */
async function backfill($: EngineInterface, titleOption: string): Promise<void> {
  const urls = await createdInTranscript($, await $.session.messages(), new Set());
  await track($, urls);
  if ((await read($, created)).length > 0) void refresh($, titleOption);
}

/**
 * Refreshes once the snapshot is older than 3 minutes, while the session has
 * created PRs.
 */
async function refreshWhenStale($: EngineInterface, titleOption: string): Promise<void> {
  const [urls, snap, now] = await Promise.all([read($, created), read($, snapshot), $.clock.now()]);
  if (urls.length === 0) return;
  if (!snap || now - snap.fetchedAt >= STALE_MS) void refresh($, titleOption);
}

/**
 * Every PR the snapshot holds, in every state.
 */
function allPrs(snap: Snapshot | null): Pr[] {
  return (snap?.groups ?? []).flatMap((g) => g.prs);
}

/**
 * Finds a PR by `42`, `!42` or `#88`.
 */
function findPr(snap: Snapshot | null, arg: string): Pr | undefined {
  const prs = allPrs(snap);
  return /^[!#]/.test(arg)
    ? prs.find((m) => m.ref === arg)
    : prs.find((m) => m.ref.slice(1) === arg);
}

/**
 * Opens a URL in the host's browser: the command `$BROWSER` gives when set
 * (see `browserArgv`; no shell); else, or when that command cannot start or
 * times out, on WSL the Windows browser (explorer.exe hands the URL to the
 * Windows default), on macOS `open`, elsewhere `xdg-open`. explorer.exe
 * exits 1 even when it worked.
 */
async function openUrl($: EngineInterface, url: string): Promise<string> {
  const browser = browserArgv((await $.env.get('BROWSER')) ?? '', url);
  if (browser.length > 0) {
    try {
      await $.process.run(browser, { timeoutMs: OPEN_TIMEOUT_MS });
      return 'browser';
    } catch {
      // `$BROWSER` cannot start or timed out: the platform opener below takes over.
    }
  }
  const kernel = await $.process.run(['uname', '-sr']);
  const os = kernel.stdout.toLowerCase();
  const argv = os.includes('darwin')
    ? ['open', url]
    : os.includes('microsoft')
      ? ['explorer.exe', url]
      : ['xdg-open', url];
  await $.process.run(argv, { timeoutMs: OPEN_TIMEOUT_MS });
  return argv[0] === 'explorer.exe'
    ? 'Windows browser'
    : argv[0] === 'open'
      ? 'macOS browser'
      : 'browser';
}

/**
 * Opens a clicked PR link and says which PR it was.
 */
async function openPr($: EngineInterface, href: string): Promise<void> {
  const where = await openUrl($, href);
  const pr = allPrs(await read($, snapshot)).find((m) => m.url === href);
  $.ui.toast(`⑂ opened ${pr ? `${pr.repo} ${pr.ref}` : href} in ${where}`);
}

/**
 * `N PRs from this session`, then any fetch errors.
 */
function summaryOf(count: number, snap: Snapshot): string {
  const counts = `${count} PRs from this session`;
  return snap.errors.length > 0 ? `${counts} · ⚠ ${snap.errors.join(' · ')}` : counts;
}

/**
 * Registers the band: at session start, the `/my-pr-links` command, the
 * backfill of PRs created or updated earlier in the session and a one-minute tick that
 * refreshes a stale snapshot; a `tool.call` observer that tracks each PR a
 * call creates or updates, in the main loop or a subagent's; the command's toggle,
 * `list`, `refresh`, `open <ref>` and `add <url>`; and the band drawn on
 * `AbovePrompt`. `options.task_title_cmd` is the title command option.
 */
export const register: Register = (on, options) => {
  const option = options.task_title_cmd;
  const titleOption = typeof option === 'string' ? option.trim() : '';

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'my-pr-links',
      description:
        "Show or hide the band of this session's pull requests; list prints them all; refresh fetches now; open <ref> opens one (42, !42, #88); add <url> adds an MR/PR",
      argumentHint: '[list | refresh | open <ref> | add <url>]',
    });

    await backfill($, titleOption);
    $.clock.every(TICK_MS, () => void refreshWhenStale($, titleOption));

    return next(e);
  });

  on('tool.call', async ($, e, next) => {
    const ran = await next(e);
    const urls = trackedUrls(e.tool, e, ran.text ?? '');
    if (urls.length > 0 && (await track($, urls))) void refresh($, titleOption);
    return ran;
  }).catch(($, e, next) => next(e));

  on('command.run', { command: 'my-pr-links' }, async ($, e) => {
    const [verb, arg] = e.args.trim().split(/\s+/);

    if (verb === 'list') {
      if ((await read($, created)).length === 0)
        return { text: 'No pull requests created or updated in this session yet.' };
      const snap = await read($, snapshot);
      if (!snap)
        return {
          text: 'Still fetching the pull requests of this session. Retry in a moment, or run /my-pr-links refresh.',
        };
      return { text: listText(snap, await $.clock.now()) };
    }

    if (verb === 'refresh') {
      const urls = await read($, created);
      if (urls.length === 0)
        return { text: 'No pull requests created or updated in this session yet.' };
      return { text: summaryOf(urls.length, await refresh($, titleOption)) };
    }

    if (verb === 'open') {
      const pr = findPr(await read($, snapshot), arg ?? '');
      if (!pr) return { text: `No PR ${arg ?? ''} in the band.` };
      const where = await openUrl($, pr.url);
      return { text: `Opened ${pr.repo} ${pr.ref} in ${where}` };
    }

    if (verb === 'add') {
      const link = parsePrUrl(arg ?? '');
      if (!link)
        return {
          text: 'Usage: /my-pr-links add <url> (https://host/group/project/-/merge_requests/<n> or https://host/owner/repo/pull/<n>)',
        };
      if (!(await track($, [link.url]))) return { text: `${link.url} is already in the band.` };
      void refresh($, titleOption);
      return { text: `Added ${link.ref} to the band.` };
    }

    const hidden = await update($, isHidden, (was) => !was);
    return {
      text: hidden
        ? 'PR band hidden. /my-pr-links shows it again.'
        : 'PR band shown above the prompt.',
    };
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e);
    if ((await read($, created)).length === 0) return next(e);
    const snap = await read($, snapshot);
    if (!snap || (snap.groups.length === 0 && snap.errors.length === 0)) return next(e);

    const { Box, Text, Markdown } = $.ui.resolve(e);

    const age = ageOf(snap.fetchedAt, await $.clock.now());
    const ageText = (first: boolean) => (first ? <Text dimColor> · {age}</Text> : null);

    // Every PR has a row, so the column widths stay when a PR merges or closes.
    const { groups } = snap;
    const rowPrs = groups.flatMap((g) => g.prs);
    // With no ticket or shared-branch group, the PRs are plain rows with no header.
    const headed = hasHeaders(groups);

    const refWidth = Math.max(0, ...rowPrs.map((m) => m.ref.length));
    const repoWidth = Math.max(0, ...rowPrs.map((m) => m.repo.length));
    const titleWidth = Math.max(0, ...rowPrs.map((m) => m.rowTitle.length));
    const approvalsWidth = Math.max(
      0,
      ...rowPrs.map((m) => (m.approvals ? m.approvals.length + 3 : 0)),
    );

    const scopeOf = (group: PrGroup, m: Pr) =>
      `pr-${group.kind}-${group.id}-${m.provider}-${m.repo}-${m.ref.slice(1)}`;

    const prRow = (group: PrGroup, m: Pr, showsAge: boolean) => {
      const look = LOOK[m.state];
      const scope = scopeOf(group, m);
      const ci = m.ci ? CI_TEXT[m.ci] : '';
      // A closed row is dim except its icon and label; a finished row hides its stale note.
      const isClosed = m.state === 'closed';
      const showsNote = m.state !== 'draft' && m.state !== 'merged' && !isClosed;
      return (
        <Box key={scope} gap={2} paddingLeft={headed ? 2 : 0}>
          <Box gap={1} flexShrink={0}>
            <Text color={look.color}>{look.icon}</Text>
            <Box width={refWidth} flexShrink={0}>
              <Markdown
                key={`link-${scope}`}
                dimColor={isClosed}
                text={`[${m.ref}](${m.url})`}
                onLinkPress={(link) => void openPr($, link.href)}
              />
            </Box>
          </Box>
          <Box width={repoWidth} flexShrink={0}>
            <Text dimColor>{m.repo}</Text>
          </Box>
          <Box width={titleWidth} flexShrink={1}>
            <Text wrap="truncate-end" dimColor={isClosed} hover={{ scope, inverse: true }}>
              {m.rowTitle}
            </Text>
          </Box>
          <Box flexShrink={0}>
            {isClosed ? (
              <Text dimColor>{ci.padEnd(4)}</Text>
            ) : (
              <Text color={m.ci === 'fail' ? 'error' : m.ci === 'run' ? 'warning' : 'inactive'}>
                {ci.padEnd(4)}
              </Text>
            )}
          </Box>
          {approvalsWidth > 0 && (
            <Box width={approvalsWidth} flexShrink={0}>
              {isReadyUnapproved(m) ? (
                <Text color="warning">{`👍 ${m.approvals}`}</Text>
              ) : (
                <Text dimColor>{m.approvals ? `👍 ${m.approvals}` : ''}</Text>
              )}
            </Box>
          )}
          <Box flexShrink={0}>
            <Text color={look.color}>{look.label}</Text>
            {ageText(showsAge)}
          </Box>
          {m.stackedOn ? (
            <Box flexShrink={0}>
              <Text color="warning">⧗ after {m.stackedOn}</Text>
            </Box>
          ) : null}
          {m.note && showsNote ? (
            <Text italic color="warning" wrap="truncate-end">
              · {m.note}
            </Text>
          ) : null}
        </Box>
      );
    };

    const detail = (group: PrGroup, m: Pr) => {
      const scope = scopeOf(group, m);
      return (
        <Box key={`d-${scope}`} display="none" hover={{ scope, display: 'flex' }} gap={1}>
          <Text color="claude">›</Text>
          <Text bold>
            {m.repo} {m.ref}
          </Text>
          <Text wrap="truncate-end">{m.title}</Text>
          <Text dimColor>→ {m.targetBranch}</Text>
          {m.note ? (
            <Text italic dimColor>
              · {m.note}
            </Text>
          ) : null}
        </Box>
      );
    };

    const groupOf = (group: PrGroup, first: boolean) => {
      const key = `group-${group.kind}-${group.id}`;
      if (!headed) {
        const rows: RenderChildren[] = group.prs.map((m, i) => prRow(group, m, first && i === 0));
        return (
          <Box key={key} flexDirection="column">
            {rows}
          </Box>
        );
      }

      const rows: RenderChildren[] = group.prs.map((m) => prRow(group, m, false));
      const step = nextOf(group);
      const outcome = isFinished(group) ? outcomeOf(group) : undefined;

      return (
        <Box key={key} flexDirection="column">
          <Box gap={2}>
            <Box flexShrink={0}>
              <Text bold color="claude">
                {group.id}
              </Text>
            </Box>
            {group.title ? (
              <Box flexShrink={1}>
                <Text wrap="truncate-end">{group.title}</Text>
              </Box>
            ) : null}
            <Box flexShrink={0}>
              {outcome ? (
                <Text color={outcome.color}>{outcome.text}</Text>
              ) : (
                <Text color={NEXT_LOOK[step.kind].color} bold={NEXT_LOOK[step.kind].bold}>
                  ▸ {step.text}
                </Text>
              )}
              {ageText(first)}
            </Box>
          </Box>
          {rows}
        </Box>
      );
    };

    const band = (
      <Box flexDirection="column">
        {groups.flatMap((group) => group.prs.map((m) => detail(group, m)))}
        {snap.errors.length > 0 && <Text dimColor>⚠ {snap.errors.join(' · ')}</Text>}
        {groups.map((group, i) => groupOf(group, i === 0))}
      </Box>
    );

    // A tree from a hook beneath stacks under this band; core's own drawing is not repeated.
    const below = await next(e);
    if (below.type === 'engine') return band;
    return (
      <Box flexDirection="column">
        {band}
        {below}
      </Box>
    );
  });
};
