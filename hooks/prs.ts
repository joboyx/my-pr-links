/**
 * Finds the pull requests a tool call created, and turns raw GitLab
 * (`glab api`) and GitHub (`gh pr view`) pull request JSON into the model
 * the band renders, grouped by ticket key or shared source branch. Pure: no
 * fetching, no engine calls.
 */

/**
 * Where a pull request stands, as the band shows it.
 */
export type PrState = 'merged' | 'ready' | 'review' | 'failing' | 'running' | 'draft' | 'closed';

/**
 * Pipeline or check result of a pull request's head commit.
 */
export type CiStatus = 'pass' | 'fail' | 'run';

/**
 * One pull request (GitHub) or merge request (GitLab), provider-neutral.
 */
export type Pr = {
  provider: 'gitlab' | 'github';
  /**
   * Short project or repository name, such as `shop-api` or `web`.
   */
  repo: string;
  /**
   * `!42` for GitLab, `#88` for GitHub.
   */
  ref: string;
  url: string;
  /**
   * Full title without a leading draft marker such as `Draft: ` or `[WIP]`.
   */
  title: string;
  /**
   * The title as the row shows it: no draft marker, no conventional-commit
   * type, no ticket key the group header already shows, at most 50
   * characters. The full title when nothing is left after that.
   */
  rowTitle: string;
  sourceBranch: string;
  targetBranch: string;
  state: PrState;
  ci?: CiStatus;
  /**
   * The page of the head pipeline (GitLab) or of one check (GitHub), when the
   * provider gives one.
   */
  ciUrl?: string;
  /**
   * Given approvals over required approvals, such as `1/1`, when the GitLab
   * MR has an approval rule; else the given count alone, such as `0` or `2`
   * (a GitHub PR, open, merged or closed, or a GitLab MR without a rule).
   * Undefined when GitLab approvals were not fetched.
   */
  approvals?: string;
  /**
   * Ticket key such as `SHOP-214`, from the source branch, the title or the
   * description; see `ticketOf`.
   */
  ticket?: string;
  /**
   * Ref of the newest open PR in the same repo whose source branch is this PR's
   * target branch. Set by `buildGroups`.
   */
  stackedOn?: string;
  /**
   * Ref of the PR this PR stacks on, in any state, for the row order only.
   * Set by `buildGroups`, and carried from the previous snapshot after the
   * host moved this PR's target branch off a merged base.
   */
  stackBase?: string;
  note?: string;
};

/**
 * What a group is keyed by: a ticket key, a source branch that 2 or more
 * PRs without a ticket key share, or neither (`other`).
 */
export type GroupKind = 'ticket' | 'branch' | 'other';

/**
 * The pull requests of one ticket or shared branch, as one band group.
 */
export type PrGroup = {
  /**
   * The ticket key such as `SHOP-214`, the shared branch name such as
   * `dependabot/npm_and_yarn/lodash-4.17.21`, or `other`.
   */
  id: string;
  /**
   * What the group is keyed by: a ticket key, a shared branch, or `other`.
   */
  kind: GroupKind;
  /**
   * The header title the title command gave for a ticket key; never set for
   * a branch group or `other`.
   */
  title?: string;
  /**
   * Every PR of the group in every state, by repo then PR number; a stacked
   * PR follows the PR it stacks on, also after that PR merged or closed.
   */
  prs: Pr[];
};

/**
 * One fetch of this session's pull requests, as the band draws it.
 */
export type Snapshot = {
  /**
   * When the fetch started, in milliseconds since the epoch.
   */
  fetchedAt: number;
  groups: PrGroup[];
  /**
   * One line per distinct failed PR call, such as `glab: 401 Unauthorized`.
   */
  errors: string[];
};

/**
 * A pull request or GitLab merge request URL, split into what the fetch needs.
 */
export type PrLink = {
  provider: 'gitlab' | 'github';
  /**
   * `gitlab.com`, a self-hosted GitLab host, or `github.com`.
   */
  host: string;
  /**
   * Full project path (`acme/platform/shop-api`) or `owner/repo`.
   */
  projectPath: string;
  iid: number;
  /**
   * `!42` for GitLab, `#88` for GitHub.
   */
  ref: string;
  url: string;
};

/**
 * The fields read from `glab api projects/:id/merge_requests/:iid`,
 * its head pipeline included.
 */
export type GitlabMrItem = {
  iid: number;
  title: string;
  /**
   * The MR description; `null` or empty when it has none. Read for the
   * ticket key only, never kept.
   */
  description?: string | null;
  source_branch: string;
  target_branch: string;
  draft: boolean;
  state: string;
  detailed_merge_status?: string;
  has_conflicts?: boolean;
  head_pipeline?: { status: string; web_url?: string } | null;
  web_url: string;
  references: { full: string };
};

/**
 * The fields read from `glab api projects/:id/merge_requests/:iid/approvals`.
 */
export type GitlabMrApprovals = {
  approvals_required: number;
  approvals_left: number;
  /**
   * One entry per user who approved; the given count when no rule applies.
   */
  approved_by?: { user: { username?: string } }[];
};

/**
 * One entry of a pull request's `statusCheckRollup`: a check run carries
 * `status`, `conclusion` and `detailsUrl`, a commit status context carries
 * `state` and `targetUrl`. `gh` writes an empty string or `null` for a
 * missing URL.
 */
export type GithubCheck = {
  status?: string;
  conclusion?: string;
  state?: string;
  detailsUrl?: string | null;
  targetUrl?: string | null;
};

/**
 * The fields read from `gh pr view <url> --json number,title,body,url,...`.
 */
export type GithubPrView = {
  number: number;
  title: string;
  /**
   * The PR description; empty when it has none. Read for the ticket key
   * only, never kept.
   */
  body?: string;
  url: string;
  isDraft: boolean;
  state: string;
  headRefName: string;
  baseRefName: string;
  reviewDecision: string;
  statusCheckRollup: GithubCheck[];
  /**
   * `CLEAN` when GitHub lets the PR merge now.
   */
  mergeStateStatus?: string;
  /**
   * Each reviewer's latest review; `state` is `APPROVED`,
   * `CHANGES_REQUESTED`, `COMMENTED`, `DISMISSED` or `PENDING`.
   */
  latestReviews?: GithubReview[];
};

/**
 * One entry of a pull request's `latestReviews`.
 */
export type GithubReview = {
  author: { login: string };
  state: string;
};

/**
 * Icon, theme color and label for each state.
 */
export const LOOK: Record<PrState, { icon: string; color: string; label: string }> = {
  merged: { icon: '✔', color: 'merged', label: 'merged' },
  ready: { icon: '●', color: 'success', label: 'ready to merge' },
  review: { icon: '○', color: 'suggestion', label: 'in review' },
  failing: { icon: '✖', color: 'error', label: 'CI failed' },
  running: { icon: '◐', color: 'warning', label: 'CI running' },
  draft: { icon: '◌', color: 'inactive', label: 'draft' },
  closed: { icon: '⊘', color: 'inactive', label: 'closed' },
};

/**
 * Row text of each CI status, such as `CI ✓` for a passed pipeline.
 */
export const CI_TEXT: Record<CiStatus, string> = { pass: 'CI ✓', fail: 'CI ✖', run: 'CI …' };

/**
 * The next action of a group and who owns it.
 */
export type Next = { kind: 'failing' | 'you' | 'waiting' | 'done'; text: string };

/**
 * Sort rank of a group by its next action: lower sorts first, so what needs
 * attention leads.
 */
const URGENCY: Record<Next['kind'], number> = { failing: 0, you: 1, waiting: 2, done: 3 };

const OTHER = 'other';

/**
 * Whether the PR is still open: neither merged nor closed.
 */
const isOpen = (m: Pr) => m.state !== 'merged' && m.state !== 'closed';

/**
 * Picks the next action of a group: a failing PR first, then one ready for
 * you to merge, else whatever the first open PR waits on.
 */
export function nextOf(group: PrGroup): Next {
  const open = group.prs.filter(isOpen);
  const failing = open.find((m) => m.state === 'failing');
  if (failing) return { kind: 'failing', text: `fix CI ${failing.ref}` };
  const ready = open.find((m) => m.state === 'ready');
  if (ready) return { kind: 'you', text: `you merge ${ready.ref}` };
  const first = open[0];
  if (!first) return { kind: 'done', text: 'all merged' };
  if (first.state === 'running') return { kind: 'waiting', text: `CI running ${first.ref}` };
  if (first.state === 'draft') return { kind: 'waiting', text: `undraft ${first.ref}` };
  return { kind: 'waiting', text: `review ${first.ref}` };
}

// Leading draft markers, in any case: `Draft:`, `WIP:`, `[Draft]`, `[WIP]`, `(Draft)`.
const DRAFT_MARKER = /^(?:(?:draft:|wip:|\[draft\]|\[wip\]|\(draft\))\s*)+/i;

/**
 * The title without its leading draft markers.
 */
const stripDraft = (title: string) => title.replace(DRAFT_MARKER, '');

// A ticket key: 2 to 10 capitals or digits that start with a capital, a dash, a number.
const KEY = '[A-Z][A-Z0-9]{1,9}-\\d+';
const WHOLE_KEY = new RegExp(`^${KEY}$`);
// Rule 1: a ticket key at the start of a branch path segment, such as `feature/SHOP-214-x`.
const BRANCH_KEY = new RegExp(`(?:^|/)(${KEY})(?=$|[-_/.])`, 'g');
// Rule 2: a conventional-commit title, `type(scope)!: description`; the type is a lowercase word.
const CONVENTIONAL = /^([a-z]+)(?:\(([^)]*)\))?(!)?:\s*(.*)$/;
// Rule 3: a ticket key that opens the description, `SHOP-214: x` or `[SHOP-214] x`.
const LEAD_KEY = new RegExp(`^(?:\\[(${KEY})\\]|(${KEY}):)\\s`);
// Rule 4: a footer or git trailer line, such as `Refs: SHOP-214` or `Closes #SHOP-214`: a whole
// keyword, an optional `:`, then the rest of the line as a `,`/`;` list (see `trailerKeyOf`).
const TRAILER_LINE = /^(?:refs?|closes|fixes|resolves|issue|ticket|task|jira)\b[ \t]*:?(.*)$/gim;
const ROW_TITLE_MAX = 50;

/**
 * Prefixes of standard codes that look like ticket keys (`CVE-2024-1234`,
 * `UTF-8`, `SHA-256`, `ISO-8601`, `HTTP-2`); they never form a key.
 */
const STANDARD_PREFIXES = new Set(['CVE', 'UTF', 'SHA', 'ISO', 'HTTP', 'RFC', 'TLS', 'MD', 'GHSA']);

/**
 * Whether the text is a whole ticket key, and not a standard code.
 */
const isKey = (text: string) =>
  WHOLE_KEY.test(text) && !STANDARD_PREFIXES.has(text.slice(0, text.indexOf('-')));

/**
 * Branches a release or integration flow shares between unrelated PRs; they
 * never form a shared-branch group.
 */
const DEFAULT_BRANCHES = new Set([
  'main',
  'master',
  'develop',
  'dev',
  'trunk',
  'staging',
  'production',
]);

/**
 * A title split as a conventional commit: its type, its scopes (the raw
 * scope text, and its entries split on `,` or `/`) and its description.
 * A title that is not a conventional commit has no type and keeps its whole
 * text, less a draft marker, as the description.
 */
type ParsedTitle = { type?: string; scopeText?: string; scopes: string[]; desc: string };

/**
 * Splits a title as a conventional commit (see `ParsedTitle`).
 */
function parseTitle(title: string): ParsedTitle {
  const text = stripDraft(title.trim());
  const m = CONVENTIONAL.exec(text);
  if (!m) return { scopes: [], desc: text };
  const scopeText = m[2];
  const scopes = (scopeText ?? '')
    .split(/[,/]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return { type: m[1], scopeText, scopes, desc: m[4] ?? '' };
}

/**
 * The ticket key that opens the description, `KEY: x` or `[KEY] x`, with the
 * text it takes up, else `undefined`.
 */
function leadKeyOf(desc: string): { key: string; text: string } | undefined {
  const m = LEAD_KEY.exec(desc);
  const key = m?.[1] ?? m?.[2];
  return m && key ? { key, text: m[0] } : undefined;
}

/**
 * The ticket key of a PR, first match wins: (1) a key at the start of a
 * source branch path segment; (2) a conventional-commit scope that is, or
 * lists, a key; (3) a key that opens the title's description as `KEY: x` or
 * `[KEY] x`; (4) a footer or trailer line of the description such as
 * `Refs: KEY`. A key inside running text (`fix UTF-8 decoding`), a
 * lowercase key and a standard code (`CVE-2024-1234`, `ISO-8601`) never
 * match.
 */
export function ticketOf(sourceBranch: string, title: string, body = ''): string | undefined {
  for (const m of sourceBranch.matchAll(BRANCH_KEY)) {
    if (m[1] && isKey(m[1])) return m[1];
  }
  const parsed = parseTitle(title);
  const fromScope = parsed.scopes.find(isKey);
  if (fromScope) return fromScope;
  const fromLead = leadKeyOf(parsed.desc)?.key;
  if (fromLead && isKey(fromLead)) return fromLead;
  // The trailer keyword matches in any case; the key itself only in capitals.
  for (const m of body.matchAll(TRAILER_LINE)) {
    const key = trailerKeyOf(m[1] ?? '');
    if (key) return key;
  }
  return undefined;
}

/**
 * The first item of a trailer's `,`/`;` list that is a whole key, less a
 * leading `#` and a trailing `.` (`#12, ABC-2.` gives `ABC-2`); `undefined`
 * when no item is a key, such as `ABC-123 later`.
 */
function trailerKeyOf(list: string): string | undefined {
  return list
    .split(/[,;]/)
    .map((item) => item.trim().replace(/^#/, '').replace(/\.$/, ''))
    .find(isKey);
}

/**
 * The row text of a title: no draft marker and no conventional-commit type;
 * the scope `ticket` is dropped (from a scope list, only that entry), any
 * other scope kept as `scope: description`; a leading `ticket:` or
 * `[ticket]` dropped. A title that is not a conventional commit stays as
 * written, less its draft marker. When nothing is left, the full title less
 * its draft marker. Cut to at most 50 code points, ending in `…`.
 */
export function rowTitleOf(title: string, ticket?: string): string {
  const parsed = parseTitle(title);
  const lead = leadKeyOf(parsed.desc);
  const desc = lead && lead.key === ticket ? parsed.desc.slice(lead.text.length) : parsed.desc;

  let text = desc.trim();
  if (parsed.type !== undefined) {
    const rest = parsed.scopes.filter((s) => s !== ticket);
    const scope = rest.length === parsed.scopes.length ? parsed.scopeText?.trim() : rest.join(', ');
    if (scope) text = `${scope}: ${text}`;
  }
  if (!text) text = stripDraft(title.trim());
  // Code points, so a cut never splits a surrogate pair such as an emoji.
  const chars = Array.from(text);
  return chars.length > ROW_TITLE_MAX
    ? `${chars.slice(0, ROW_TITLE_MAX - 1).join('').trimEnd()}…`
    : text;
}

const PIPELINE_RUNNING = [
  'created',
  'waiting_for_resource',
  'preparing',
  'pending',
  'running',
  'scheduled',
];

/**
 * Maps a GitLab head pipeline status to the band's CI status.
 */
function gitlabCi(status: string | undefined): CiStatus | undefined {
  if (status === 'success') return 'pass';
  if (status === 'failed') return 'fail';
  if (status && PIPELINE_RUNNING.includes(status)) return 'run';
  return undefined;
}

/**
 * `given/required` when the MR has an approval rule, else the count of
 * `approved_by`; `undefined` when approvals were not fetched or carry no
 * `approved_by`.
 */
function gitlabApprovals(approvals: GitlabMrApprovals | undefined): string | undefined {
  if (!approvals) return undefined;
  const required = approvals.approvals_required;
  if (required > 0) return `${required - approvals.approvals_left}/${required}`;
  return approvals.approved_by ? String(approvals.approved_by.length) : undefined;
}

/**
 * Maps one GitLab MR, with its head pipeline, plus its approvals when
 * fetched, to a `Pr`.
 */
export function fromGitlab(item: GitlabMrItem, approvals?: GitlabMrApprovals): Pr {
  const mergeStatus = item.detailed_merge_status;
  const ci = gitlabCi(item.head_pipeline?.status);
  const approvalsMissing = (approvals?.approvals_left ?? 0) > 0;
  const state: PrState =
    item.state === 'merged'
      ? 'merged'
      : item.state === 'closed'
        ? 'closed'
        : item.draft
          ? 'draft'
          : ci === 'fail'
            ? 'failing'
            : ci === 'run'
              ? 'running'
              : mergeStatus === 'mergeable' && !approvalsMissing
                ? 'ready'
                : 'review';

  const notes: string[] = [];
  if (mergeStatus === 'discussions_not_resolved') notes.push('unresolved threads');
  if (item.has_conflicts || mergeStatus === 'conflict') notes.push('has conflicts');

  const project = item.references.full.split('!')[0] ?? '';
  const title = stripDraft(item.title);
  const ticket = ticketOf(item.source_branch, item.title, item.description ?? '');
  return {
    provider: 'gitlab',
    repo: project.split('/').pop() ?? project,
    ref: `!${item.iid}`,
    url: item.web_url,
    title,
    rowTitle: rowTitleOf(item.title, ticket),
    sourceBranch: item.source_branch,
    targetBranch: item.target_branch,
    state,
    ci,
    ciUrl: item.head_pipeline?.web_url || undefined,
    approvals: gitlabApprovals(approvals),
    ticket,
    note: notes.length > 0 ? notes.join(', ') : undefined,
  };
}

const CHECK_FAILED = [
  'FAILURE',
  'TIMED_OUT',
  'CANCELLED',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
  'ERROR',
];
const CHECK_RUNNING = ['IN_PROGRESS', 'QUEUED', 'PENDING', 'WAITING', 'REQUESTED'];
const CONTEXT_RUNNING = ['PENDING', 'EXPECTED'];
const CHECK_PASSED = ['SUCCESS', 'NEUTRAL', 'SKIPPED'];

/**
 * Whether the check's conclusion (check run) or state (status context) is
 * one of `values`.
 */
const hasResult = (c: GithubCheck, values: string[]) =>
  [c.conclusion, c.state].some((v) => v !== undefined && values.includes(v));

/**
 * Whether the check failed.
 */
const isCheckFailed = (c: GithubCheck) => hasResult(c, CHECK_FAILED);

/**
 * Whether the check is not finished yet.
 */
const isCheckRunning = (c: GithubCheck) =>
  (c.status !== undefined && CHECK_RUNNING.includes(c.status)) ||
  (c.state !== undefined && CONTEXT_RUNNING.includes(c.state));

/**
 * Folds a PR's check runs and status contexts into one CI status: any
 * failure fails, else anything unfinished runs, else all passed passes.
 */
function githubCi(checks: GithubCheck[]): CiStatus | undefined {
  if (checks.length === 0) return undefined;
  if (checks.some(isCheckFailed)) return 'fail';
  if (checks.some(isCheckRunning)) return 'run';
  if (checks.every((c) => hasResult(c, CHECK_PASSED))) return 'pass';
  return undefined;
}

/**
 * The page of the check that explains the CI status: the first failed check
 * with a URL, else the first running one, else the first check with a URL.
 */
function githubCiUrl(checks: GithubCheck[]): string | undefined {
  const urlOf = (c: GithubCheck) => c.detailsUrl || c.targetUrl || undefined;
  const failed = checks.filter(isCheckFailed);
  const running = checks.filter(isCheckRunning);
  return [...failed, ...running, ...checks].map(urlOf).find((url) => url !== undefined);
}

/**
 * Maps one `gh pr view` result to a `Pr`; the repo name comes from its URL.
 */
export function fromGithub(view: GithubPrView): Pr {
  const prState = view.state.toUpperCase();
  const ci = githubCi(view.statusCheckRollup);
  const state: PrState =
    prState === 'MERGED'
      ? 'merged'
      : prState === 'CLOSED'
        ? 'closed'
        : view.isDraft
          ? 'draft'
          : ci === 'fail'
            ? 'failing'
            : ci === 'run'
              ? 'running'
              : view.reviewDecision === 'APPROVED' || view.mergeStateStatus === 'CLEAN'
                ? 'ready'
                : 'review';

  const projectPath = parsePrUrl(view.url)?.projectPath ?? '';
  const title = stripDraft(view.title);
  const ticket = ticketOf(view.headRefName, view.title, view.body ?? '');
  return {
    provider: 'github',
    repo: projectPath.split('/').pop() ?? projectPath,
    ref: `#${view.number}`,
    url: view.url,
    title,
    rowTitle: rowTitleOf(view.title, ticket),
    sourceBranch: view.headRefName,
    targetBranch: view.baseRefName,
    state,
    ci,
    ciUrl: githubCiUrl(view.statusCheckRollup),
    approvals: githubApprovals(view),
    ticket,
  };
}

/**
 * The count of distinct reviewers whose latest review approves; no
 * `latestReviews` counts as none.
 */
function githubApprovals(view: GithubPrView): string {
  const approvers = new Set(
    (view.latestReviews ?? []).filter((r) => r.state === 'APPROVED').map((r) => r.author.login),
  );
  return String(approvers.size);
}

/**
 * Whether the PR is ready to merge although nobody approved it: its given
 * approval count is `0`. A GitLab MR with a rule is never ready unapproved.
 * The band shows its 👍 cell in the warning color, such as for a repo whose
 * target branch is not protected.
 */
export function isReadyUnapproved(m: Pr): boolean {
  return m.state === 'ready' && m.approvals === '0';
}

/**
 * Whether both PRs live in the same repo of the same provider.
 */
const sameRepo = (a: Pr, b: Pr) => a.provider === b.provider && a.repo === b.repo;

/**
 * The PR's number, `42` for `!42`.
 */
const refNumber = (m: Pr) => Number(m.ref.slice(1));

/**
 * Sort order: by repo, then by PR number.
 */
const byRepoRef = (a: Pr, b: Pr) => a.repo.localeCompare(b.repo) || refNumber(a) - refNumber(b);

/**
 * Whether `base` is the PR that `m` stacks on, in any state: another PR in
 * the same repo whose source branch is the target branch of `m`.
 */
const isBaseOf = (base: Pr, m: Pr) =>
  base !== m &&
  Boolean(m.targetBranch) &&
  sameRepo(base, m) &&
  base.sourceBranch === m.targetBranch;

/**
 * The highest-numbered PR among `candidates` that `m` stacks on: when an old
 * and a new PR share one source branch, the new one is the base.
 */
function newestBaseOf(m: Pr, candidates: Pr[]): Pr | undefined {
  return candidates.filter((b) => isBaseOf(b, m)).sort((a, b) => refNumber(b) - refNumber(a))[0];
}

/**
 * The base ref that the previous snapshot gave the PR with the same URL.
 * When a base merges, the host moves the target branch of the PR stacked on
 * it, so the branch match is lost; this ref keeps the stacked PR in its
 * place. The ref is kept while its base is missing from this fetch, merged
 * or closed; an open base that no longer matches by branch means the PR was
 * moved off it on purpose, so the ref is dropped.
 */
function carriedBaseOf(m: Pr, all: Pr[], previous: Pr[]): string | undefined {
  const ref = previous.find((p) => p.url === m.url)?.stackBase;
  const base = all.find((b) => b !== m && sameRepo(b, m) && b.ref === ref);
  return base && isOpen(base) ? undefined : ref;
}

/**
 * Where one PR goes: its group's kind and id.
 */
type GroupKey = { kind: GroupKind; id: string };

/**
 * The group of each PR in the band: its ticket key; else (5) its source
 * branch, when 2 or more PRs without a ticket key share it and it is not a
 * default branch such as `main`; else `other`.
 */
function groupKeysOf(prs: Pr[]): Map<Pr, GroupKey> {
  const keyless = prs.filter((m) => !m.ticket);
  const branchCount = new Map<string, number>();
  for (const m of keyless) branchCount.set(m.sourceBranch, (branchCount.get(m.sourceBranch) ?? 0) + 1);
  const isShared = (branch: string) =>
    Boolean(branch) &&
    !DEFAULT_BRANCHES.has(branch.toLowerCase()) &&
    (branchCount.get(branch) ?? 0) >= 2;

  return new Map(
    prs.map((m): [Pr, GroupKey] => [
      m,
      m.ticket
        ? { kind: 'ticket', id: m.ticket }
        : isShared(m.sourceBranch)
          ? { kind: 'branch', id: m.sourceBranch }
          : { kind: 'other', id: OTHER },
    ]),
  );
}

/**
 * Sets the base of the PR: `stackedOn` names its open base PR in any group,
 * for the mark; `stackBase` names its base PR in the same group in any
 * state, else the base carried from the previous snapshot, for the row
 * order. `groupOf` names each PR's group.
 */
function withStack(m: Pr, all: Pr[], previous: Pr[], groupOf: (pr: Pr) => string): Pr {
  const stackedOn = newestBaseOf(m, all.filter(isOpen))?.ref;
  const sameGroup = all.filter((b) => groupOf(b) === groupOf(m));
  const stackBase = newestBaseOf(m, sameGroup)?.ref ?? carriedBaseOf(m, all, previous);
  return stackedOn || stackBase ? { ...m, stackedOn, stackBase } : m;
}

/**
 * Repo-then-ref order in every state, except a stacked PR follows its base
 * PR (`stackBase`). The base can be merged or closed, so a PR keeps its
 * place when its base finishes.
 */
function stackOrder(prs: Pr[]): Pr[] {
  const sorted = [...prs].sort(byRepoRef);
  const out: Pr[] = [];
  const place = (m: Pr, seen: Set<Pr>) => {
    if (out.includes(m) || seen.has(m)) return;
    seen.add(m);
    const base = sorted.find((b) => sameRepo(b, m) && b.ref === m.stackBase);
    if (base) place(base, seen);
    out.push(m);
  };
  for (const m of sorted) place(m, new Set());
  return out;
}

/**
 * Whether the group has no open PR left: every PR it holds is merged or
 * closed.
 */
export const isFinished = (group: PrGroup) => !group.prs.some(isOpen);

/**
 * Whether the band draws group headers: only when at least one group is a
 * ticket or shared-branch group. With none, every PR is a plain row.
 */
export const hasHeaders = (groups: readonly PrGroup[]) => groups.some((g) => g.kind !== 'other');

/**
 * Header text and theme color of a finished group (no open PR): `✔ all N
 * merged`, `✔ N merged · M closed`, or `⊘ all N closed` in the inactive
 * color.
 */
export function outcomeOf(group: PrGroup): { text: string; color: string } {
  const merged = group.prs.filter((m) => m.state === 'merged').length;
  const closed = group.prs.filter((m) => m.state === 'closed').length;
  if (merged === 0) return { text: `⊘ all ${closed} closed`, color: LOOK.closed.color };
  const text = closed === 0 ? `✔ all ${merged} merged` : `✔ ${merged} merged · ${closed} closed`;
  return { text, color: LOOK.merged.color };
}

/**
 * How long ago a snapshot was fetched: `just now` under a minute, else
 * whole minutes such as `5m ago`.
 */
export function ageOf(fetchedAt: number, now: number): string {
  const minutes = Math.floor((now - fetchedAt) / 60000);
  return minutes < 1 ? 'just now' : `${minutes}m ago`;
}

/**
 * The states a toast announces when a PR moves into them.
 */
const TOAST_STATES: PrState[] = ['merged', 'closed', 'failing', 'ready'];

/**
 * The states that start a new CI cycle: moving into one forgets what was
 * announced for the PR, so the next result is announced again.
 */
const NEW_CYCLE_STATES: PrState[] = ['running', 'failing', 'draft'];

/**
 * The states already announced for each PR, by URL.
 */
export type Announced = Record<string, PrState[]>;

/**
 * Toast text for the PRs whose state changed into merged, closed, CI failed
 * or ready to merge since the previous snapshot, such as `✔ !42 shop-api
 * merged · ✖ #88 docs CI failed`, and the announced states updated with
 * them. A PR matches by URL; a PR not in `previous` (the first snapshot, a
 * newly tracked PR) or not in `next` (missing from this fetch) is skipped.
 * A state already in `announced` for the PR is not announced again, so a
 * merge status that blips (ready, review, ready) toasts once; a change into
 * running, failing or draft forgets the PR's announced states first. `text`
 * is `undefined` when nothing is announced.
 */
export function changesOf(
  previous: Pr[],
  next: Pr[],
  announced: Announced = {},
): { text?: string; announced: Announced } {
  const record: Announced = { ...announced };
  const changes = next.flatMap((m) => {
    const was = previous.find((p) => p.url === m.url);
    if (!was || was.state === m.state) return [];
    if (NEW_CYCLE_STATES.includes(m.state)) delete record[m.url];
    const said = record[m.url] ?? [];
    if (!TOAST_STATES.includes(m.state) || said.includes(m.state)) return [];
    record[m.url] = [...said, m.state];
    const look = LOOK[m.state];
    return [`${look.icon} ${m.ref} ${m.repo} ${look.label}`];
  });
  return { text: changes.length > 0 ? changes.join(' · ') : undefined, announced: record };
}

/**
 * Markdown list of every PR in the snapshot in band order: when the band
 * has headers, a `**<id>**` line per group (then its title, when set), then
 * one bullet per PR with its state icon, linked ref, repo, full title and
 * state label, plus its CI, 👍 approvals and note when set. Without headers,
 * the bullets alone. The first line ends with the snapshot age; fetch errors
 * follow the groups.
 */
export function listText(snap: Snapshot, now: number): string {
  const headed = hasHeaders(snap.groups);
  const blocks = snap.groups.map((group) => {
    const rows = group.prs.map((m) => {
      const look = LOOK[m.state];
      const parts = [`${look.icon} [${m.ref}](${m.url}) ${m.repo} — ${m.title}`, look.label];
      if (m.ci) parts.push(CI_TEXT[m.ci]);
      if (m.approvals !== undefined) parts.push(`👍 ${m.approvals}`);
      if (m.note) parts.push(m.note);
      return `- ${parts.join(' · ')}`;
    });
    if (!headed) return rows.join('\n');
    const header = group.title ? `**${group.id}** ${group.title}` : `**${group.id}**`;
    return [header, ...rows].join('\n');
  });
  if (snap.errors.length > 0) blocks.push(`⚠ ${snap.errors.join(' · ')}`);
  if (blocks.length === 0) blocks.push('No pull requests in the snapshot');

  const [first = '', ...rest] = blocks.join('\n\n').split('\n');
  return [`${first} · fetched ${ageOf(snap.fetchedAt, now)}`, ...rest].join('\n');
}

/**
 * Groups PRs for the band by ticket key, else by a shared source branch,
 * else into `other` (see `groupKeysOf`). Each group keeps every PR, open,
 * merged or closed, in `stackOrder`. `other` always sorts last; before it, a
 * finished group (no open PR) sorts after every group with open PRs, and
 * open groups sort by the urgency of their next action, then by id. A
 * ticket group takes its header title from `titles`; no other group has
 * one. `previous` holds the PRs of the previous snapshot, for the stack
 * bases it carries over.
 */
export function buildGroups(
  prs: Pr[],
  titles: Record<string, string> = {},
  previous: Pr[] = [],
): PrGroup[] {
  const keys = groupKeysOf(prs);
  const keyOf = (m: Pr): GroupKey => keys.get(m) ?? { kind: 'other', id: OTHER };
  const nameOf = (m: Pr) => `${keyOf(m).kind}:${keyOf(m).id}`;

  const byGroup = new Map<string, { key: GroupKey; prs: Pr[] }>();
  for (const m of prs) {
    const pr = withStack(m, prs, previous, nameOf);
    const entry = byGroup.get(nameOf(m));
    if (entry) entry.prs.push(pr);
    else byGroup.set(nameOf(m), { key: keyOf(m), prs: [pr] });
  }

  const groups: PrGroup[] = [...byGroup.values()].map(({ key, prs: list }) => {
    const title = key.kind === 'ticket' ? titles[key.id] : undefined;
    return { id: key.id, kind: key.kind, ...(title ? { title } : {}), prs: stackOrder(list) };
  });

  return groups.sort(
    (a, b) =>
      Number(a.kind === 'other') - Number(b.kind === 'other') ||
      Number(isFinished(a)) - Number(isFinished(b)) ||
      URGENCY[nextOf(a).kind] - URGENCY[nextOf(b).kind] ||
      a.id.localeCompare(b.id),
  );
}

const GITLAB_MR_URL =
  /https:\/\/([\w.-]+(?::\d+)?)\/([\w.~-]+(?:\/[\w.~-]+)*)\/-\/merge_requests\/(\d+)/g;
const GITHUB_PR_URL = /https:\/\/(github\.com)\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g;

/**
 * Splits a GitLab merge request URL or a GitHub pull request URL; `undefined`
 * for any other URL, such as a `/merge_requests/new` link.
 */
export function parsePrUrl(url: string): PrLink | undefined {
  const gitlab = new RegExp(`^${GITLAB_MR_URL.source}$`).exec(url);
  if (gitlab) {
    const [, host = '', projectPath = '', iid = ''] = gitlab;
    return { provider: 'gitlab', host, projectPath, iid: Number(iid), ref: `!${iid}`, url };
  }
  const github = new RegExp(`^${GITHUB_PR_URL.source}$`).exec(url);
  if (github) {
    const [, host = '', projectPath = '', iid = ''] = github;
    return { provider: 'github', host, projectPath, iid: Number(iid), ref: `#${iid}`, url };
  }
  return undefined;
}

/**
 * Every GitLab merge request URL and GitHub pull request URL in the text,
 * once each, in order. Lines a `git push` relays from the server
 * (`remote: ...`) are skipped: their hint may name a PR that already
 * existed. A match ends at the number, so trailing punctuation and
 * `/merge_requests/new?...` links never match.
 */
function prUrlsIn(text: string): string[] {
  const own = text
    .split('\n')
    .filter((line) => !/^\s*remote:/.test(line))
    .join('\n');
  const found = [...own.matchAll(GITLAB_MR_URL), ...own.matchAll(GITHUB_PR_URL)]
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((m) => m[0]);
  return [...new Set(found)];
}

/**
 * The created PR's URL from an API response: its top-level `web_url`
 * (GitLab) or `html_url` (GitHub). Falls back to every PR URL in the text
 * when it is not JSON or holds no such field.
 */
function prUrlsInResponse(text: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return prUrlsIn(text);
  }
  if (parsed && typeof parsed === 'object') {
    const fields = parsed as { web_url?: unknown; html_url?: unknown };
    const url = [fields.web_url, fields.html_url].find(
      (value): value is string => typeof value === 'string' && parsePrUrl(value) !== undefined,
    );
    if (url) return [url];
  }
  return prUrlsIn(text);
}

const CLI_CHANGE = /\b(glab\s+mr\s+(?:create|update)|gh\s+pr\s+(?:create|edit))\b/;
const API_POST = /(?:^|\s)(?:-X\s*|--method[=\s]+)[Pp][Oo][Ss][Tt]\b/;
// The collection endpoint only: a POST to `merge_requests/:iid/notes` creates no PR.
const GITLAB_API_CREATE = /\bglab\s+api\b.*\bmerge_requests(?![\w/])/;
const GITHUB_API_CREATE = /\bgh\s+api\b.*\/pulls(?![\w/])/;
const MCP_CHANGE = /(?:create|update)_(?:merge|pull)_request/i;
const API_UPDATE = /(?:^|\s)(?:-X\s*|--method[=\s]+)(?:PUT|PATCH)\b/i;
// The single-PR endpoint only, the iid a number or a shell variable: `/notes`, `/approve` and
// `/merge` after it never match.
const GITLAB_API_UPDATE =
  /\bglab\s+api\b.*?\bprojects\/([^\s"'/]+)\/merge_requests\/(\d+|\$[\w{}]+)["']?(?=[\s)?]|$)/;
const GITHUB_API_UPDATE =
  /\bgh\s+api\b.*?\brepos\/([^\s"'/]+)\/([^\s"'/]+)\/pulls\/(\d+|\$[\w{}]+)["']?(?=[\s)?]|$)/;
// The CLI error line (`glab: 404 Not found (HTTP 404)`), often glued to the JSON error body.
const HTTP_ERROR = /\b(?:glab|gh): [^\n]*\(HTTP [45]\d\d\)$/m;
const API_HOSTNAME = /--hostname[=\s]+([\w.-]+(?::\d+)?)/;
const COMMAND_STEPS = /&&|\|\||[;|\n]/;

/**
 * How a shell command creates or updates a pull request: `cli` for
 * `glab mr create`, `glab mr update`, `gh pr create` or `gh pr edit`; `api`
 * for a POST to the GitLab or GitHub API create endpoint, `apiUpdate` for a
 * PUT or PATCH to the endpoint of one existing merge request or pull request
 * (not its `/notes` or `/merge`), each in one of its `&&`, `||`, `;` or `|`
 * steps, else `undefined`.
 */
function changeKindOf(command: string): 'cli' | 'api' | 'apiUpdate' | undefined {
  if (CLI_CHANGE.test(command)) return 'cli';
  const steps = command.split(COMMAND_STEPS);
  const isApi = steps.some(
    (step) => API_POST.test(step) && (GITLAB_API_CREATE.test(step) || GITHUB_API_CREATE.test(step)),
  );
  if (isApi) return 'api';
  const isUpdate = steps.some(
    (step) =>
      API_UPDATE.test(step) && (GITLAB_API_UPDATE.test(step) || GITHUB_API_UPDATE.test(step)),
  );
  return isUpdate ? 'apiUpdate' : undefined;
}

/**
 * The PR URL one API update step names in its literal path, or `undefined`
 * when the path holds a shell variable, a numeric project id or anything that
 * is not a PR URL. The GitLab host is the step's `--hostname`, else
 * `gitlab.com`; GitHub is `github.com` only.
 */
function updateUrlOf(step: string): string | undefined {
  if (!API_UPDATE.test(step)) return undefined;
  const gitlab = GITLAB_API_UPDATE.exec(step);
  const github = GITHUB_API_UPDATE.exec(step);
  let url: string | undefined;
  if (gitlab) {
    const [, project = '', iid = ''] = gitlab;
    if (project.includes('$') || iid.includes('$') || /^\d+$/.test(project)) return undefined;
    const host = API_HOSTNAME.exec(step)?.[1] ?? 'gitlab.com';
    try {
      url = `https://${host}/${decodeURIComponent(project)}/-/merge_requests/${iid}`;
    } catch {
      return undefined;
    }
  } else if (github) {
    // GitHub Enterprise host: leave it to the response's html_url.
    const hostname = API_HOSTNAME.exec(step)?.[1];
    if (hostname !== undefined && hostname !== 'github.com') return undefined;
    const [, owner = '', repo = '', number = ''] = github;
    if ([owner, repo, number].some((part) => part.includes('$'))) return undefined;
    url = `https://github.com/${owner}/${repo}/pull/${number}`;
  }
  return url !== undefined && parsePrUrl(url) ? url : undefined;
}

/**
 * The pull request URLs one tool call created or updated,
 * read from its result text. A Bash `glab mr create|update` or
 * `gh pr create|edit` yields the URLs its output prints; an API POST, or a
 * tool named like `create_merge_request` / `update_pull_request` (MCP),
 * yields the response's `web_url` / `html_url`. An API PUT or PATCH of one
 * existing merge request or pull request yields the URL(s) its literal path
 * names, once each in order, else the response's URL like a POST. Any other
 * call, such as `glab mr view` or a `git push` hint, tracks none.
 */
export function trackedUrls(toolName: string, input: object, resultText: string): string[] {
  const command = 'command' in input && typeof input.command === 'string' ? input.command : '';
  const kind = toolName === 'Bash' ? changeKindOf(command) : MCP_CHANGE.test(toolName) && 'api';
  if (kind === 'apiUpdate') {
    // A failed call changed nothing: do not track the URL its command path names.
    if (HTTP_ERROR.test(resultText)) return [];
    const derived = command
      .split(COMMAND_STEPS)
      .map(updateUrlOf)
      .filter((url): url is string => url !== undefined);
    return derived.length > 0 ? [...new Set(derived)] : prUrlsInResponse(resultText);
  }
  if (kind === 'cli') return prUrlsIn(resultText);
  if (kind === 'api') return prUrlsInResponse(resultText);
  return [];
}

/**
 * The argv that `$BROWSER` gives for a URL, in its common form: the first
 * entry of a `:`-separated list, split on whitespace, with each `%s`
 * replaced by the URL, else the URL appended. Empty when `$BROWSER` names
 * no command.
 */
export function browserArgv(browser: string, url: string): string[] {
  const words = (browser.split(':')[0] ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return words.some((w) => w.includes('%s'))
    ? words.map((w) => w.replaceAll('%s', url))
    : [...words, url];
}
