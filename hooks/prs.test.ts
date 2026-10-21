import { expect, test } from 'claude-code/testing';

import {
  GITHUB_88_VIEW,
  GITHUB_LATEST_REVIEWS,
  GITLAB_41_APPROVALS,
  GITLAB_MR_12,
  GITLAB_MR_17,
  GITLAB_MR_41,
  GITLAB_MR_42,
  GITLAB_NO_RULE_APPROVALS,
  SESSION_CREATE_CALLS,
} from './fixtures';
import type { GitlabMr } from './fixtures';
import {
  browserArgv,
  buildGroups,
  fromGithub,
  fromGitlab,
  hasHeaders,
  isReadyUnapproved,
  listText,
  nextOf,
  outcomeOf,
  parsePrUrl,
  rowTitleOf,
  ticketOf,
  trackedUrls,
} from './prs';
import type { GithubCheck, GithubPrView, GitlabMrDetail, Pr, PrGroup } from './prs';

const byRef = (prs: Pr[], ref: string) => prs.find((m) => m.ref === ref)!;

/**
 * Maps a single-MR response the way the band does: the response is both
 * the item and its detail.
 */
const gitlab = (pr: GitlabMr, approvals = GITLAB_41_APPROVALS) => fromGitlab(pr, pr, approvals);

const gitlabItem = (over: Partial<GitlabMr>): GitlabMr => ({
  ...GITLAB_MR_41,
  head_pipeline: undefined,
  ...over,
});

const githubView = (over: Partial<GithubPrView>): GithubPrView => ({
  ...GITHUB_88_VIEW,
  isDraft: false,
  ...over,
});

const PR_42 = 'https://gitlab.com/acme/platform/shop-api/-/merge_requests/42';
const PR_17 = 'https://gitlab.com/acme/platform/web/-/merge_requests/17';
const PR_88 = 'https://github.com/octo-org/docs/pull/88';

/**
 * A GitHub PR with no ticket key unless its branch, title or body has one.
 */
const githubPr = (number: number, headRefName: string, title = 'chore: tidy', over = {}) =>
  fromGithub(
    githubView({
      number,
      headRefName,
      title,
      body: '',
      url: `https://github.com/octo-org/docs/pull/${number}`,
      ...over,
    }),
  );

test('each glab mr create call yields the PR it created', () => {
  const [shopApi, web] = SESSION_CREATE_CALLS;

  expect(trackedUrls('Bash', { command: shopApi!.command }, shopApi!.result)).toEqual([PR_42]);
  expect(trackedUrls('Bash', { command: web!.command }, web!.result)).toEqual([PR_17]);
});

test('the git push hint to /merge_requests/new is ignored', () => {
  const result = [
    'remote:',
    'remote: To create a merge request for feature/SHOP-214-backoff, visit:',
    'remote:   https://gitlab.com/acme/platform/shop-api/-/merge_requests/new?merge_request%5Bsource_branch%5D=feature%2FSHOP-214-backoff',
    'remote:',
    'To gitlab.com:acme/platform/shop-api.git',
    ' * [new branch]      HEAD -> feature/SHOP-214-backoff',
    PR_42,
  ].join('\n');
  const command = 'git push -u origin HEAD && glab mr create --fill --yes';

  expect(trackedUrls('Bash', { command }, result)).toEqual([PR_42]);
});

test('a command that only prints or views a PR creates nothing', () => {
  const view = `title:\tfeat(SHOP-214): back off\nstate:\topen\nurl:\t${PR_42}\n`;

  expect(trackedUrls('Bash', { command: 'glab mr view 42' }, view)).toEqual([]);
  expect(trackedUrls('Bash', { command: `echo ${PR_42}` }, PR_42)).toEqual([]);
  expect(
    trackedUrls('Bash', { command: 'git push' }, `remote: View merge request:\nremote:   ${PR_42}`),
  ).toEqual([]);
  expect(trackedUrls('Read', { file_path: '/x.md' }, PR_42)).toEqual([]);
});

test('gh pr create output yields the PR URL', () => {
  const result = `\nCreating pull request for octo-user/docs-build into main in octo-org/docs\n\n${PR_88}\n`;

  expect(trackedUrls('Bash', { command: 'gh pr create --fill' }, result)).toEqual([PR_88]);
});

test('an MCP create_merge_request result yields its web_url', () => {
  const result = JSON.stringify({
    id: 1,
    iid: 42,
    author: { web_url: 'https://gitlab.com/octo-user' },
    web_url: PR_42,
  });

  expect(trackedUrls('mcp__gitlab__create_merge_request', {}, result)).toEqual([PR_42]);
  expect(trackedUrls('mcp__gitlab__get_merge_request', {}, result)).toEqual([]);
});

test('a POST to the API create endpoint counts; a POST to a PR note does not', () => {
  const created = JSON.stringify({ iid: 42, web_url: PR_42 });
  const post = 'glab api projects/1234/merge_requests -X POST -f title=x';
  const note = 'glab api projects/1234/merge_requests/42/notes -X POST -f body=x';
  const pr = JSON.stringify({ html_url: 'https://github.com/octo-org/docs/pull/89' });

  expect(trackedUrls('Bash', { command: post }, created)).toEqual([PR_42]);
  expect(trackedUrls('Bash', { command: note }, created)).toEqual([]);
  expect(
    trackedUrls('Bash', { command: 'gh api --method POST repos/octo-org/docs/pulls' }, pr),
  ).toEqual(['https://github.com/octo-org/docs/pull/89']);
});

test('a push hint for an existing PR is not tracked when the create fails', () => {
  const result = [
    'remote:',
    'remote: View merge request for feature/SHOP-214-backoff:',
    `remote:   ${PR_42}`,
    'remote:',
    'To gitlab.com:acme/platform/shop-api.git',
    '   1a2b3c4..5d6e7f8  HEAD -> feature/SHOP-214-backoff',
    'Failed to create merge request. Created one already: another merge request already exists for this source branch',
  ].join('\n');
  const command = 'git push -u origin HEAD 2>&1 && glab mr create --fill --yes';

  expect(trackedUrls('Bash', { command }, result)).toEqual([]);
});

test('an API or MCP create takes only the response web_url / html_url', () => {
  const PR_43 = 'https://gitlab.com/acme/platform/shop-api/-/merge_requests/43';
  const gitlabBody = JSON.stringify({
    iid: 43,
    description: `Stacked on ${PR_42}; merge that one first.`,
    web_url: PR_43,
  });
  const PR_89 = 'https://github.com/octo-org/docs/pull/89';
  const githubBody = JSON.stringify({ body: `Follows ${PR_88}`, html_url: PR_89 });

  expect(trackedUrls('mcp__gitlab__create_merge_request', {}, gitlabBody)).toEqual([PR_43]);
  expect(
    trackedUrls('Bash', { command: 'glab api projects/1/merge_requests -X POST' }, gitlabBody),
  ).toEqual([PR_43]);
  expect(
    trackedUrls('Bash', { command: 'gh api repos/octo-org/docs/pulls -X POST' }, githubBody),
  ).toEqual([PR_89]);
  // Not JSON: every PR URL in the text.
  expect(trackedUrls('mcp__github__create_pull_request', {}, `Created ${PR_89}`)).toEqual([PR_89]);
});

test('the API POST method matches in any case', () => {
  const created = JSON.stringify({ iid: 42, web_url: PR_42 });

  expect(
    trackedUrls('Bash', { command: 'glab api projects/1/merge_requests -X post' }, created),
  ).toEqual([PR_42]);
  expect(
    trackedUrls('Bash', { command: 'glab api projects/1/merge_requests --method post' }, created),
  ).toEqual([PR_42]);
});

test('parsePrUrl splits GitLab and GitHub URLs and rejects others', () => {
  expect(parsePrUrl(PR_42)).toEqual({
    provider: 'gitlab',
    host: 'gitlab.com',
    projectPath: 'acme/platform/shop-api',
    iid: 42,
    ref: '!42',
    url: PR_42,
  });
  expect(parsePrUrl('https://gitlab.example.com/acme/web/-/merge_requests/7')?.host).toBe(
    'gitlab.example.com',
  );
  expect(parsePrUrl(PR_88)).toEqual({
    provider: 'github',
    host: 'github.com',
    projectPath: 'octo-org/docs',
    iid: 88,
    ref: '#88',
    url: PR_88,
  });
  expect(
    parsePrUrl('https://gitlab.com/acme/platform/shop-api/-/merge_requests/new'),
  ).toBeUndefined();
});

test('GitLab MR with pipeline and approvals is ready with CI pass and 1/1', () => {
  const pr = gitlab(GITLAB_MR_41);

  expect(pr).toMatchObject({
    provider: 'gitlab',
    repo: 'shop-api',
    ref: '!41',
    url: GITLAB_MR_41.web_url,
    title: 'feat(SHOP-214): add retry to the checkout client',
    rowTitle: 'add retry to the checkout client',
    sourceBranch: 'feature/SHOP-214-checkout-retry',
    targetBranch: 'main',
    state: 'ready',
    ci: 'pass',
    approvals: '1/1',
    ticket: 'SHOP-214',
  });
  expect(pr.note).toBeUndefined();
});

test('GitLab MRs group under one ticket, !42 stacked on !41, !17 draft', () => {
  const prs = [fromGitlab(GITLAB_MR_17), fromGitlab(GITLAB_MR_42), gitlab(GITLAB_MR_41)];
  const groups = buildGroups(prs);

  expect(groups).toHaveLength(1);
  const group = groups[0]!;
  expect([group.id, group.kind]).toEqual(['SHOP-214', 'ticket']);
  expect(group.prs.map((m) => m.ref)).toEqual(['!41', '!42', '!17']);

  const stacked = byRef(group.prs, '!42');
  expect(stacked.stackedOn).toBe('!41');
  expect(stacked.note).toBe('unresolved threads');
  expect(stacked.state).toBe('review');
  expect(byRef(group.prs, '!41').stackedOn).toBeUndefined();

  const draft = byRef(group.prs, '!17');
  expect(draft.state).toBe('draft');
  expect(draft.repo).toBe('web');
  expect(draft.title).toBe('feat(SHOP-214): show a retry notice at checkout');
  expect(draft.rowTitle).toBe('show a retry notice at checkout');
  // !17 shares !42's source branch but lives in another repo.
  expect(draft.stackedOn).toBeUndefined();

  expect(nextOf(group)).toEqual({ kind: 'you', text: 'you merge !41' });
});

test('a ticket header has the title the command gave, else none; never a PR title', () => {
  const prs = [GITLAB_MR_17, GITLAB_MR_42, GITLAB_MR_41].map((m) => fromGitlab(m));

  expect(buildGroups(prs, { 'SHOP-214': 'Checkout retries' })[0]?.title).toBe('Checkout retries');
  expect(buildGroups(prs)[0]?.title).toBeUndefined();
  expect(buildGroups(prs, { 'SHOP-999': 'Elsewhere' })[0]?.title).toBeUndefined();
});

test('a stacked PR follows its base even when its own ref sorts first', () => {
  const base = fromGitlab(
    gitlabItem({ iid: 300, source_branch: 'feature/ABC-1-base', target_branch: 'main' }),
  );
  const top = fromGitlab(
    gitlabItem({
      iid: 120,
      source_branch: 'feature/ABC-1-top',
      target_branch: 'feature/ABC-1-base',
    }),
  );

  const [group] = buildGroups([top, base]);

  expect(group?.prs.map((m) => m.ref)).toEqual(['!300', '!120']);
  expect(group?.prs[1]?.stackedOn).toBe('!300');
});

test('rule 1: a key at the start of a branch path segment wins over the title', () => {
  expect(ticketOf('feature/ABC-123-retry', 'feat(WEB-7): x')).toBe('ABC-123');
  expect(ticketOf('ABC-123-ui', 'x')).toBe('ABC-123');
  expect(ticketOf('octo-user/ABC-123', 'x')).toBe('ABC-123');
  expect(ticketOf('fix/ABC-123_typo', 'x')).toBe('ABC-123');
  expect(ticketOf('fix/ABC-123.hotfix', 'x')).toBe('ABC-123');
  // Not at the start of a segment, or followed by more letters.
  expect(ticketOf('fix/xABC-123', 'x')).toBeUndefined();
  expect(ticketOf('fix/ABC-123x', 'x')).toBeUndefined();
});

test('rule 2: a conventional-commit scope that is, or lists, a key', () => {
  expect(ticketOf('fix/retry', 'feat(SHOP-214): add retry')).toBe('SHOP-214');
  expect(ticketOf('fix/retry', 'fix(api,SHOP-214): handle timeouts')).toBe('SHOP-214');
  expect(ticketOf('fix/retry', 'fix(api, SHOP-214): handle timeouts')).toBe('SHOP-214');
  expect(ticketOf('fix/retry', 'fix(api/SHOP-214)!: drop v1')).toBe('SHOP-214');
  expect(ticketOf('fix/retry', 'Draft: feat(SHOP-214): add retry')).toBe('SHOP-214');
  expect(ticketOf('fix/retry', 'fix(api): handle timeouts')).toBeUndefined();
});

test('rule 3: a key that opens the description as "KEY: x" or "[KEY] x", not "KEY x"', () => {
  expect(ticketOf('fix/retry', 'ABC-1: add retry')).toBe('ABC-1');
  expect(ticketOf('fix/retry', '[ABC-1] add retry')).toBe('ABC-1');
  expect(ticketOf('fix/retry', 'Draft: [ABC-1] add retry')).toBe('ABC-1');
  expect(ticketOf('fix/retry', 'feat: ABC-1: add retry')).toBe('ABC-1');
  expect(ticketOf('fix/retry', 'ABC-1 add retry')).toBeUndefined();
  expect(ticketOf('fix/retry', 'add retry for ABC-1')).toBeUndefined();
});

test('rule 4: a trailer line of the description', () => {
  expect(ticketOf('fix/retry', 'add retry', 'Adds retry.\n\nRefs: WEB-7')).toBe('WEB-7');
  expect(ticketOf('fix/retry', 'add retry', 'Closes #WEB-7')).toBe('WEB-7');
  expect(ticketOf('fix/retry', 'add retry', 'fixes WEB-7')).toBe('WEB-7');
  expect(ticketOf('fix/retry', 'add retry', 'Jira: WEB-7\nTicket: ABC-1')).toBe('WEB-7');
  expect(ticketOf('fix/retry', 'add retry', 'See WEB-7 for the background.')).toBeUndefined();
  expect(ticketOf('fix/retry', 'add retry', 'Refs: web-7')).toBeUndefined();

  // The description reaches the rule from both hosts, and is not kept on the PR.
  const gitlabPr = fromGitlab(
    gitlabItem({ source_branch: 'fix/retry', title: 'add retry', description: 'Refs: WEB-7' }),
  );
  const githubPr = fromGithub(githubView({ headRefName: 'fix/retry', body: 'Resolves: WEB-7' }));
  expect(gitlabPr.ticket).toBe('WEB-7');
  expect(githubPr.ticket).toBe('WEB-7');
  expect('body' in gitlabPr || 'description' in gitlabPr).toBe(false);
  expect('body' in githubPr).toBe(false);
});

test('rule 4: the trailer key ends its line or a list item, and never crosses lines', () => {
  expect(ticketOf('fix/x', 'x', 'Fixes UTF-8 decoding')).toBeUndefined();
  expect(ticketOf('fix/x', 'x', 'Fixes HTTP-2 push')).toBeUndefined();
  expect(ticketOf('fix/x', 'x', 'Refs: SHOP-214')).toBe('SHOP-214');
  expect(ticketOf('fix/x', 'x', 'Closes ABC-1, ABC-2')).toBe('ABC-1');
  expect(ticketOf('fix/x', 'x', 'Closes ABC-1; ABC-2')).toBe('ABC-1');
  expect(ticketOf('fix/x', 'x', 'Task\n\nUTF-8 cleanup')).toBeUndefined();
  expect(ticketOf('fix/x', 'x', 'Task\nSHOP-214')).toBeUndefined();
  // A GitHub body from the web editor has CRLF line ends.
  expect(ticketOf('fix/x', 'x', 'Adds retry.\r\n\r\nRefs: SHOP-214\r\n')).toBe('SHOP-214');
});

test('standard codes never form a key, in any rule', () => {
  for (const branch of [
    'fix/CVE-2024-1234',
    'feature/ISO-8601-dates',
    'fix/UTF-8-decoding',
    'fix/HTTP-2-push',
    'chore/SHA-256-checksums',
    'fix/GHSA-1234-abcd',
  ]) {
    expect(ticketOf(branch, 'x')).toBeUndefined();
  }
  // A real key later in the branch still counts.
  expect(ticketOf('fix/CVE-2024-1234/SHOP-214-patch', 'x')).toBe('SHOP-214');

  expect(ticketOf('fix/x', 'fix(CVE-2024-1234): patch the parser')).toBeUndefined();
  expect(ticketOf('fix/x', 'fix(RFC-7231, SHOP-214): x')).toBe('SHOP-214');
  expect(ticketOf('fix/x', 'TLS-13: drop old ciphers')).toBeUndefined();
  expect(ticketOf('fix/x', '[MD-5] drop the hash')).toBeUndefined();
  expect(ticketOf('fix/x', 'x', 'Fixes CVE-2024-1234')).toBeUndefined();
  expect(ticketOf('fix/x', 'x', 'Refs: RFC-9110')).toBeUndefined();
});

test('the first rule that matches wins: branch, then scope, then title start, then trailer', () => {
  const body = 'Refs: WEB-4';
  expect(ticketOf('feature/WEB-1-x', 'feat(WEB-2): WEB-3: x', body)).toBe('WEB-1');
  expect(ticketOf('fix/x', 'feat(WEB-2): WEB-3: x', body)).toBe('WEB-2');
  expect(ticketOf('fix/x', 'feat: WEB-3: x', body)).toBe('WEB-3');
  expect(ticketOf('fix/x', 'feat: x', body)).toBe('WEB-4');
});

test('keys in running text and lowercase keys never match', () => {
  const none = [
    'fix UTF-8 decoding',
    'chore: verify SHA-256 checksums',
    'feat: parse ISO-8601 dates',
    'fix: patch CVE-2024-1234 in the parser',
    'fix(server): HTTP-2 push',
    'feat(eng-123): lowercase scope',
  ];
  for (const title of none) expect(ticketOf('fix/thing', title)).toBeUndefined();

  expect(ticketOf('octo-user/eng-123-x', 'x')).toBeUndefined();
  expect(ticketOf('feature/abc-1-x', 'x')).toBeUndefined();
});

test('rule 5: keyless PRs that share a source branch group under the branch', () => {
  const branch = 'dependabot/npm_and_yarn/lodash-4.17.21';
  const docs = githubPr(5, branch, 'Bump lodash from 4.17.20 to 4.17.21');
  const site = fromGithub(
    githubView({
      number: 9,
      headRefName: branch,
      title: 'Bump lodash from 4.17.20 to 4.17.21',
      body: '',
      url: 'https://github.com/octo-org/site/pull/9',
    }),
  );
  const alone = githubPr(6, 'octo-user/typo');
  const keyed = githubPr(7, 'feature/ABC-1-x');

  const groups = buildGroups([alone, docs, keyed, site], { [branch]: 'not used' });

  // Both groups wait on review, so they sort by id.
  expect(groups.map((g) => `${g.kind} ${g.id}`)).toEqual([
    'ticket ABC-1',
    `branch ${branch}`,
    'other other',
  ]);
  expect(groups[1]?.prs.map((m) => `${m.repo} ${m.ref}`)).toEqual(['docs #5', 'site #9']);
  expect(groups[1]?.title).toBeUndefined();
  expect(hasHeaders(groups)).toBe(true);
});

test('a ticket PR on a branch does not make a keyless PR on it a shared branch', () => {
  const keyed = githubPr(1, 'shared-work', 'feat(ABC-1): x');
  const keyless = githubPr(2, 'shared-work');

  expect(buildGroups([keyed, keyless]).map((g) => `${g.kind} ${g.id}`)).toEqual([
    'ticket ABC-1',
    'other other',
  ]);
});

test('default branches never group, in any case', () => {
  for (const branch of ['main', 'Master', 'develop', 'dev', 'trunk', 'staging', 'production']) {
    const groups = buildGroups([githubPr(1, branch), githubPr(2, branch)]);
    expect(groups.map((g) => g.kind)).toEqual(['other']);
  }
});

test('with no ticket or branch group the band has no headers', () => {
  const groups = buildGroups([githubPr(1, 'octo-user/a'), githubPr(2, 'octo-user/b')]);

  expect(groups.map((g) => `${g.kind} ${g.id}`)).toEqual(['other other']);
  expect(groups[0]?.title).toBeUndefined();
  expect(hasHeaders(groups)).toBe(false);
});

test('the row title drops the draft marker, the type and the group key', () => {
  expect(rowTitleOf('feat(SHOP-214): add retry', 'SHOP-214')).toBe('add retry');
  expect(rowTitleOf('Draft: fix(SHOP-214): add retry', 'SHOP-214')).toBe('add retry');
  expect(rowTitleOf('[Draft] fix: keep line breaks')).toBe('keep line breaks');
  expect(rowTitleOf('WIP: tidy imports')).toBe('tidy imports');
  expect(rowTitleOf('feat!: drop the v1 endpoint')).toBe('drop the v1 endpoint');
  expect(rowTitleOf('SHOP-214: add retry', 'SHOP-214')).toBe('add retry');
  expect(rowTitleOf('[SHOP-214] add retry', 'SHOP-214')).toBe('add retry');
  expect(rowTitleOf('Draft: [SHOP-214] add retry', 'SHOP-214')).toBe('add retry');
});

test('the row title keeps an area scope, the rest of a scope list and other keys', () => {
  expect(rowTitleOf('fix(api): handle timeouts', 'SHOP-214')).toBe('api: handle timeouts');
  expect(rowTitleOf('fix(api, SHOP-214): handle timeouts', 'SHOP-214')).toBe(
    'api: handle timeouts',
  );
  expect(rowTitleOf('fix(api,web,SHOP-214): handle timeouts', 'SHOP-214')).toBe(
    'api, web: handle timeouts',
  );
  expect(rowTitleOf('feat(SHOP-198): x', 'SHOP-214')).toBe('SHOP-198: x');
  expect(rowTitleOf('SHOP-198: add retry', 'SHOP-214')).toBe('SHOP-198: add retry');
  expect(rowTitleOf('Bump lodash from 4.17.20 to 4.17.21')).toBe(
    'Bump lodash from 4.17.20 to 4.17.21',
  );
});

test('every draft marker leaves the row title and the full title, in any case', () => {
  for (const marker of ['[WIP]', '(Draft)', '[Draft]', 'Draft:', 'WIP:', 'wip:', '[wip]', 'DRAFT:']) {
    expect(rowTitleOf(`${marker} feat(SHOP-214): add retry`, 'SHOP-214')).toBe('add retry');
    expect(rowTitleOf(`${marker} tidy imports`)).toBe('tidy imports');
    const pr = fromGitlab(gitlabItem({ title: `${marker} feat(SHOP-214): add retry` }));
    expect(pr.title).toBe('feat(SHOP-214): add retry');
    const gh = fromGithub(githubView({ title: `${marker} tidy imports` }));
    expect(gh.title).toBe('tidy imports');
  }
  expect(ticketOf('fix/x', '[WIP] feat(SHOP-214): add retry')).toBe('SHOP-214');
  expect(ticketOf('fix/x', '(Draft) SHOP-214: add retry')).toBe('SHOP-214');
});

test('only a lowercase word is a conventional-commit type', () => {
  expect(rowTitleOf('Payments: retry 503s')).toBe('Payments: retry 503s');
  expect(rowTitleOf('Re: x')).toBe('Re: x');
  expect(rowTitleOf('Release: v1.2')).toBe('Release: v1.2');
  expect(rowTitleOf('FIX(api): x')).toBe('FIX(api): x');
  expect(rowTitleOf('fix: x')).toBe('x');
  expect(ticketOf('fix/x', 'Feat(SHOP-214): x')).toBeUndefined();
});

test('a row title with nothing left after the cleanup falls back to the full title', () => {
  expect(rowTitleOf('feat(SHOP-214): ', 'SHOP-214')).toBe('feat(SHOP-214):');
  const pr = fromGitlab(gitlabItem({ title: 'Draft: feat(SHOP-214):' }));
  expect([pr.ticket, pr.rowTitle]).toEqual(['SHOP-214', 'feat(SHOP-214):']);
});

test('the row title cut never splits an emoji', () => {
  const title = `${'x'.repeat(48)}🚀yyyy`;
  const cut = rowTitleOf(title);

  expect(cut).toBe(`${'x'.repeat(48)}🚀…`);
  expect(Array.from(cut)).toHaveLength(50);
  // Old UTF-16 cut would leave a lone high surrogate before the ellipsis.
  expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(cut)).toBe(false);
  expect(rowTitleOf(`${'x'.repeat(49)}🚀`)).toBe(`${'x'.repeat(49)}🚀`);
});

test('the row title is cut to 50 characters with an ellipsis', () => {
  const long = 'Add a very long description that keeps going well past the limit';
  const cut = rowTitleOf(long);

  expect(cut.length).toBeLessThanOrEqual(50);
  expect(cut).toBe('Add a very long description that keeps going well…');
  expect(rowTitleOf(`feat(ABC-1): ${'x'.repeat(51)}`, 'ABC-1')).toBe(`${'x'.repeat(49)}…`);
  expect(rowTitleOf('x'.repeat(50))).toBe('x'.repeat(50));
});

test('a gh pr view result alone maps to a draft PR, its repo from the URL', () => {
  const pr = fromGithub(GITHUB_88_VIEW);

  expect(pr).toMatchObject({
    provider: 'github',
    repo: 'docs',
    ref: '#88',
    url: PR_88,
    title: 'chore(ci): add a docs build workflow',
    rowTitle: 'ci: add a docs build workflow',
    sourceBranch: 'octo-user/docs-build',
    targetBranch: 'main',
    state: 'draft',
  });
  expect(pr.ci).toBeUndefined();
  expect(pr.approvals).toBe('0');
  expect(pr.ticket).toBeUndefined();
});

test('GitHub checks map to failing, running, and ready', () => {
  const failing = fromGithub(
    githubView({
      reviewDecision: 'APPROVED',
      statusCheckRollup: [
        { status: 'COMPLETED', conclusion: 'SUCCESS' },
        { status: 'COMPLETED', conclusion: 'TIMED_OUT' },
      ],
    }),
  );
  expect([failing.state, failing.ci]).toEqual(['failing', 'fail']);

  const running = fromGithub(
    githubView({ statusCheckRollup: [{ status: 'IN_PROGRESS' }, { state: 'SUCCESS' }] }),
  );
  expect([running.state, running.ci]).toEqual(['running', 'run']);

  const ready = fromGithub(
    githubView({
      reviewDecision: 'APPROVED',
      statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { state: 'SUCCESS' }],
    }),
  );
  expect([ready.state, ready.ci]).toEqual(['ready', 'pass']);

  const review = fromGithub(githubView({ reviewDecision: 'REVIEW_REQUIRED' }));
  expect([review.state, review.ci]).toEqual(['review', undefined]);
});

test('GitLab pipeline maps to failing and running', () => {
  const failing = fromGitlab(GITLAB_MR_41, { head_pipeline: { status: 'failed' } });
  expect([failing.state, failing.ci]).toEqual(['failing', 'fail']);

  const running = fromGitlab(GITLAB_MR_41, { head_pipeline: { status: 'pending' } });
  expect([running.state, running.ci]).toEqual(['running', 'run']);

  const noPipeline = fromGitlab(GITLAB_MR_42, GITLAB_MR_42);
  expect([noPipeline.state, noPipeline.ci]).toEqual(['review', undefined]);

  const missing = gitlab(GITLAB_MR_41, { approvals_required: 2, approvals_left: 1 });
  expect([missing.state, missing.approvals]).toEqual(['review', '1/2']);

  const conflicts = fromGitlab(gitlabItem({ has_conflicts: true }));
  expect(conflicts.note).toBe('has conflicts');
});

test('a finished ticket keeps its merged PRs and sorts after open tickets, before other', () => {
  const open = gitlab(GITLAB_MR_41);
  const merged = fromGitlab(GITLAB_MR_12);
  const other = fromGitlab(
    gitlabItem({ iid: 5, source_branch: 'fix/no-key', title: 'fix: no key', draft: true }),
  );

  const groups = buildGroups([merged, open, other]);

  expect(groups.map((g) => g.id)).toEqual(['SHOP-214', 'SHOP-198', 'other']);
  const done = groups[1]!;
  expect(done.title).toBeUndefined();
  expect(done.prs.map((m) => `${m.ref} ${m.state}`)).toEqual(['!12 merged']);
  expect(nextOf(done)).toEqual({ kind: 'done', text: 'all merged' });
});

/**
 * A GitLab MR of ticket ABC-1 in `repo`, on its own source branch.
 */
const ticketPr = (iid: number, state: string, repo = 'shop-api', over: Partial<GitlabMr> = {}) =>
  fromGitlab(
    gitlabItem({
      iid,
      state,
      title: `feat(ABC-1): change ${iid}`,
      source_branch: `feature/ABC-1-${iid}`,
      web_url: `https://gitlab.com/acme/platform/${repo}/-/merge_requests/${iid}`,
      references: { full: `acme/platform/${repo}!${iid}` },
      ...over,
    }),
  );

test('every PR keeps its place by repo then number, whatever its state', () => {
  const states = (prs: Pr[]) => buildGroups(prs)[0]?.prs.map((m) => `${m.ref} ${m.state}`);

  const before = [
    ticketPr(30, 'opened'),
    ticketPr(5, 'opened', 'web'),
    ticketPr(20, 'opened'),
    ticketPr(10, 'opened'),
  ];
  const after = [
    ticketPr(30, 'opened'),
    ticketPr(5, 'closed', 'web'),
    ticketPr(20, 'merged'),
    ticketPr(10, 'opened'),
  ];

  expect(states(before)).toEqual(['!10 ready', '!20 ready', '!30 ready', '!5 ready']);
  expect(states(after)).toEqual(['!10 ready', '!20 merged', '!30 ready', '!5 closed']);
});

test('a ticket with only closed PRs is kept, with every PR, after the open tickets', () => {
  const closed = [70, 71].map((iid) =>
    fromGitlab(gitlabItem({ iid, state: 'closed', source_branch: `feature/ABC-9-${iid}` })),
  );

  const groups = buildGroups([...closed, fromGitlab(GITLAB_MR_12), gitlab(GITLAB_MR_41)]);

  expect(groups.map((g) => g.id)).toEqual(['SHOP-214', 'ABC-9', 'SHOP-198']);
  expect(groups[1]?.prs.map((m) => `${m.ref} ${m.state}`)).toEqual(['!70 closed', '!71 closed']);
});

test('a stacked PR keeps its place after its base merges, without the ⧗ mark', () => {
  const stack = (baseState: string) => [
    ticketPr(200, 'opened'),
    ticketPr(300, baseState, 'shop-api', { source_branch: 'feature/ABC-1-base' }),
    ticketPr(120, 'opened', 'shop-api', { target_branch: 'feature/ABC-1-base' }),
  ];
  const rows = (prs: Pr[]) => buildGroups(prs)[0]?.prs.map((m) => `${m.ref} ${m.stackedOn ?? '-'}`);

  expect(rows(stack('opened'))).toEqual(['!300 -', '!120 !300', '!200 -']);
  expect(rows(stack('merged'))).toEqual(['!300 -', '!120 -', '!200 -']);
  expect(rows(stack('closed'))).toEqual(['!300 -', '!120 -', '!200 -']);
});

test('a stacked PR the host retargeted after its base merged keeps its place', () => {
  const base = (state: string) =>
    ticketPr(300, state, 'shop-api', { source_branch: 'feature/ABC-1-base' });
  const top = (target: string) => ticketPr(120, 'opened', 'shop-api', { target_branch: target });
  const refs = (groups: PrGroup[]) => groups[0]?.prs.map((m) => m.ref);

  const before = buildGroups([ticketPr(200, 'opened'), base('opened'), top('feature/ABC-1-base')]);
  const retargeted = [ticketPr(200, 'opened'), base('merged'), top('main')];
  const after = buildGroups(retargeted, {}, before[0]!.prs);
  const later = buildGroups(retargeted, {}, after[0]!.prs);

  expect(refs(after)).toEqual(['!300', '!120', '!200']);
  expect(refs(later)).toEqual(['!300', '!120', '!200']);
  expect(after[0]?.prs[1]?.stackedOn).toBeUndefined();
  expect(refs(buildGroups(retargeted))).toEqual(['!120', '!200', '!300']);
});

test('a retargeted PR keeps its merged base over a branch match in another group', () => {
  const base = (state: string) =>
    ticketPr(300, state, 'shop-api', { source_branch: 'feature/ABC-1-base' });
  const top = (target: string) => ticketPr(120, 'opened', 'shop-api', { target_branch: target });
  const release = ticketPr(50, 'opened', 'shop-api', {
    title: 'chore(WEB-2): release',
    source_branch: 'develop',
  });

  const before = buildGroups([base('opened'), top('feature/ABC-1-base'), release]);
  const previous = before.flatMap((g) => g.prs);
  const after = buildGroups([base('merged'), top('develop'), release], {}, previous);

  const group = after.find((g) => g.id === 'ABC-1');
  expect(group?.prs.map((m) => `${m.ref} ${m.stackBase ?? '-'}`)).toEqual(['!300 -', '!120 !300']);
});

test('a base missing from one fetch is still the base when it comes back', () => {
  const base = ticketPr(300, 'merged', 'shop-api', { source_branch: 'feature/ABC-1-base' });
  const top = (target: string) => ticketPr(120, 'opened', 'shop-api', { target_branch: target });
  const refs = (groups: PrGroup[]) => groups[0]?.prs.map((m) => m.ref);

  const first = buildGroups([ticketPr(200, 'opened'), base, top('feature/ABC-1-base')]);
  const missing = buildGroups([ticketPr(200, 'opened'), top('main')], {}, first[0]!.prs);
  const back = buildGroups([ticketPr(200, 'opened'), base, top('main')], {}, missing[0]!.prs);

  expect(refs(missing)).toEqual(['!120', '!200']);
  expect(refs(back)).toEqual(['!300', '!120', '!200']);
});

test('a PR moved off a base that is still open sorts by repo then number', () => {
  const base = ticketPr(300, 'opened', 'shop-api', { source_branch: 'feature/ABC-1-base' });
  const top = (target: string) => ticketPr(120, 'opened', 'shop-api', { target_branch: target });

  const before = buildGroups([ticketPr(200, 'opened'), base, top('feature/ABC-1-base')]);
  const [after] = buildGroups([ticketPr(200, 'opened'), base, top('main')], {}, before[0]!.prs);

  expect(after?.prs.map((m) => `${m.ref} ${m.stackBase ?? '-'}`)).toEqual([
    '!120 -',
    '!200 -',
    '!300 -',
  ]);
});

test('a PR stacked on an open PR of another group keeps the mark, not the place', () => {
  const groupA = ticketPr(300, 'opened', 'shop-api', { source_branch: 'feature/ABC-1-base' });
  const groupB = (iid: number, over: Partial<GitlabMr> = {}) =>
    ticketPr(iid, 'opened', 'shop-api', {
      title: `feat(WEB-2): change ${iid}`,
      source_branch: `feature/WEB-2-${iid}`,
      ...over,
    });

  const groups = buildGroups([
    groupA,
    groupB(400, { target_branch: 'feature/ABC-1-base' }),
    groupB(350),
  ]);

  const group = groups.find((g) => g.id === 'WEB-2');
  expect(group?.prs.map((m) => `${m.ref} ${m.stackedOn ?? '-'}`)).toEqual(['!350 -', '!400 !300']);
});

test('of an old closed and a new open PR on one branch, the new one is the base', () => {
  const [group] = buildGroups([
    ticketPr(300, 'closed', 'shop-api', { source_branch: 'feature/ABC-1-base' }),
    ticketPr(310, 'opened', 'shop-api', { source_branch: 'feature/ABC-1-base' }),
    ticketPr(120, 'opened', 'shop-api', { target_branch: 'feature/ABC-1-base' }),
  ]);

  expect(group?.prs.map((m) => `${m.ref} ${m.stackedOn ?? '-'}`)).toEqual([
    '!310 -',
    '!120 !310',
    '!300 -',
  ]);
});

test('a finished group header says all merged, merged and closed, or all closed', () => {
  const outcome = (states: string[]) => {
    const [group] = buildGroups(states.map((state, i) => ticketPr(i + 1, state)));
    return outcomeOf(group!);
  };

  expect(outcome(['merged', 'merged'])).toEqual({ text: '✔ all 2 merged', color: 'merged' });
  expect(outcome(['merged', 'closed', 'closed'])).toEqual({
    text: '✔ 1 merged · 2 closed',
    color: 'merged',
  });
  expect(outcome(['closed'])).toEqual({ text: '⊘ all 1 closed', color: 'inactive' });
});

test('groups sort failing, then yours, then waiting, with other last', () => {
  const pr = (key: string, iid: number, detail?: GitlabMrDetail) =>
    fromGitlab(
      gitlabItem({ iid, source_branch: `feature/${key}-x`, detailed_merge_status: 'mergeable' }),
      detail,
    );
  const waitingA = fromGitlab(
    gitlabItem({ iid: 1, source_branch: 'feature/AAA-1-x', detailed_merge_status: 'not_approved' }),
  );
  const waitingB = fromGitlab(
    gitlabItem({ iid: 2, source_branch: 'feature/BBB-1-x', draft: true }),
  );
  const yours = pr('CCC-1', 3);
  const failing = pr('ZZZ-1', 4, { head_pipeline: { status: 'failed' } });
  const other = fromGitlab(
    gitlabItem({
      iid: 5,
      source_branch: 'fix/no-key',
      title: 'fix: no key',
      detailed_merge_status: 'mergeable',
      references: { full: 'acme/platform/shop-api!5' },
    }),
    { head_pipeline: { status: 'failed' } },
  );

  const groups = buildGroups([other, waitingB, yours, waitingA, failing]);

  expect(groups.map((g) => g.id)).toEqual(['ZZZ-1', 'CCC-1', 'AAA-1', 'BBB-1', 'other']);
  expect(groups.map((g) => nextOf(g).text)).toEqual([
    'fix CI !4',
    'you merge !3',
    'review !1',
    'undraft !2',
    'fix CI !5',
  ]);
});

test('a merged base gives no ⧗ mark', () => {
  const merged = fromGitlab(
    gitlabItem({
      iid: 50,
      state: 'merged',
      title: 'chore(ABC-1): release',
      source_branch: 'develop',
      target_branch: 'main',
    }),
  );
  const open = fromGitlab(
    gitlabItem({ iid: 60, source_branch: 'feature/ABC-1-x', target_branch: 'develop' }),
  );

  const [group] = buildGroups([merged, open]);

  expect(group?.prs.map((m) => `${m.ref} ${m.stackedOn ?? '-'}`)).toEqual(['!50 -', '!60 -']);
});

test('a GitHub PR with mergeStateStatus CLEAN is ready', () => {
  const view = githubView({ reviewDecision: '' });

  expect(fromGithub({ ...view, mergeStateStatus: 'CLEAN' }).state).toBe('ready');
  expect(fromGithub({ ...view, mergeStateStatus: 'BLOCKED' }).state).toBe('review');
  expect(fromGithub({ ...GITHUB_88_VIEW, mergeStateStatus: 'CLEAN' }).state).toBe('draft');
});

test('GitHub approvals count distinct approvers among the latest reviews', () => {
  expect(fromGithub(githubView({ latestReviews: [] })).approvals).toBe('0');
  expect(fromGithub(githubView({ latestReviews: GITHUB_LATEST_REVIEWS })).approvals).toBe('2');

  const twice = [...GITHUB_LATEST_REVIEWS, { author: { login: 'reviewer-ana' }, state: 'APPROVED' }];
  expect(fromGithub(githubView({ latestReviews: twice })).approvals).toBe('2');

  const merged = fromGithub(githubView({ state: 'MERGED', latestReviews: GITHUB_LATEST_REVIEWS }));
  expect([merged.state, merged.approvals]).toEqual(['merged', '2']);
});

test('a ready PR nobody approved is flagged, an approved or unready one is not', () => {
  const clean = githubView({ reviewDecision: '', mergeStateStatus: 'CLEAN' });

  const unapproved = fromGithub({ ...clean, latestReviews: [] });
  expect([unapproved.state, unapproved.approvals]).toEqual(['ready', '0']);
  expect(isReadyUnapproved(unapproved)).toBe(true);

  expect(isReadyUnapproved(fromGithub({ ...clean, latestReviews: GITHUB_LATEST_REVIEWS }))).toBe(
    false,
  );
  expect(isReadyUnapproved(fromGithub(githubView({ mergeStateStatus: 'BLOCKED' })))).toBe(false);
  expect(isReadyUnapproved(gitlab(GITLAB_MR_41))).toBe(false);
});

test('a GitLab MR without an approval rule shows the given count', () => {
  expect(gitlab(GITLAB_MR_41, GITLAB_NO_RULE_APPROVALS).approvals).toBe('1');

  const none = gitlab(GITLAB_MR_41, { ...GITLAB_NO_RULE_APPROVALS, approved_by: [] });
  expect([none.state, none.approvals]).toEqual(['ready', '0']);
  expect(isReadyUnapproved(none)).toBe(true);

  expect(fromGitlab(GITLAB_MR_41, GITLAB_MR_41).approvals).toBeUndefined();
});

test('every unfinished or failed status maps to running or failing', () => {
  const ciOf = (check: GithubCheck) => fromGithub(githubView({ statusCheckRollup: [check] })).ci;

  expect(ciOf({ status: 'COMPLETED', conclusion: 'STARTUP_FAILURE' })).toBe('fail');
  expect(ciOf({ status: 'WAITING' })).toBe('run');
  expect(ciOf({ status: 'REQUESTED' })).toBe('run');
  expect(ciOf({ state: 'EXPECTED' })).toBe('run');

  for (const status of ['preparing', 'waiting_for_resource', 'scheduled']) {
    expect(fromGitlab(GITLAB_MR_41, { head_pipeline: { status } }).ci).toBe('run');
  }
});

test('glab mr update, gh pr edit and an MCP update tool yield the PR they changed', () => {
  const update = `✓ updated body\n${PR_42}\n`;
  const edit = `${PR_88}\n`;
  const mcp = JSON.stringify({ iid: 42, web_url: PR_42 });

  expect(
    trackedUrls('Bash', { command: 'glab mr update 42 --title "x" --description "y"' }, update),
  ).toEqual([PR_42]);
  expect(trackedUrls('Bash', { command: 'gh pr edit 88 --title "x"' }, edit)).toEqual([PR_88]);
  expect(trackedUrls('mcp__gitlab__update_merge_request', {}, mcp)).toEqual([PR_42]);
  expect(trackedUrls('Bash', { command: 'glab mr view 42' }, update)).toEqual([]);
});

const put = (path: string, tail = '') => `glab api -X PUT "${path}" -f assignee_ids=1${tail}`;
const webPath = 'projects/acme%2Fplatform%2Fweb/merge_requests/57';
const WEB_57 = 'https://gitlab.com/acme/platform/web/-/merge_requests/57';

test('API update: derives the URL from a literal GitLab path when jq strips the output', () => {
  expect(trackedUrls('Bash', { command: put(webPath, " | jq -r '.title'") }, 'a title')).toEqual([
    WEB_57,
  ]);
});

test('API update: uses --hostname as the GitLab host', () => {
  const command = `glab api --hostname gitlab.example.com -X PUT ${webPath}`;

  expect(trackedUrls('Bash', { command }, '')).toEqual([
    'https://gitlab.example.com/acme/platform/web/-/merge_requests/57',
  ]);
});

test('API update: derives the URL from a gh api pulls path, --method=PATCH', () => {
  const command = 'gh api --method=PATCH repos/octo-org/docs/pulls/89 -f title=x';

  expect(trackedUrls('Bash', { command }, '')).toEqual(['https://github.com/octo-org/docs/pull/89']);
});

test('API update: a variable path falls back to the response, and tracks nothing without a PR URL', () => {
  const command = put('projects/acme%2Fplatform%2F$1/merge_requests/$2');
  const json = JSON.stringify({ web_url: PR_42 });

  expect(trackedUrls('Bash', { command: `${command} | jq -r .title` }, 'a title')).toEqual([]);
  expect(trackedUrls('Bash', { command }, json)).toEqual([PR_42]);
});

test('API update: a numeric project id falls back to the response', () => {
  const command = put('projects/1234/merge_requests/42');

  expect(trackedUrls('Bash', { command }, JSON.stringify({ web_url: PR_42 }))).toEqual([PR_42]);
  expect(trackedUrls('Bash', { command }, 'ok')).toEqual([]);
});

test('API update: a note, a merge, or a GET without a method does not count', () => {
  const json = JSON.stringify({ web_url: PR_42 });

  expect(trackedUrls('Bash', { command: put(`${webPath}/notes`) }, json)).toEqual([]);
  expect(trackedUrls('Bash', { command: put(`${webPath}/merge`) }, json)).toEqual([]);
  expect(trackedUrls('Bash', { command: 'gh api -X PUT repos/o/r/pulls/5/merge' }, json)).toEqual(
    [],
  );
  expect(trackedUrls('Bash', { command: `glab api ${webPath}` }, json)).toEqual([]);
});

test('API update: a failed call (HTTP 4xx) tracks nothing', () => {
  expect(
    trackedUrls(
      'Bash',
      { command: put(webPath) },
      '{"message":"404 Not found"}glab: 404 Not found (HTTP 404)',
    ),
  ).toEqual([]);
  expect(
    trackedUrls(
      'Bash',
      { command: 'gh api --method=PATCH repos/octo-org/docs/pulls/89 -f title=x' },
      'gh: Validation Failed (HTTP 422)',
    ),
  ).toEqual([]);
});

test('API update: a successful call whose body mentions HTTP 400 is still tracked', () => {
  const json = JSON.stringify({ title: 'fix: return HTTP 400 for bad input', web_url: WEB_57 });

  expect(trackedUrls('Bash', { command: put(webPath) }, json)).toEqual([WEB_57]);
});

test('API update: a gh api --hostname other than github.com falls back to the response', () => {
  const command = 'gh api --hostname ghe.example.com -X PATCH repos/o/r/pulls/5';
  const json = JSON.stringify({ html_url: 'https://github.com/o/r/pull/5' });

  expect(trackedUrls('Bash', { command }, json)).toEqual(['https://github.com/o/r/pull/5']);
  expect(trackedUrls('Bash', { command }, '')).toEqual([]);
});

test('API update: matches inside $(...), with a query string, and with a compact -XPUT', () => {
  const sub = `x=$(glab api -X PUT ${webPath})`;
  const query = `glab api -X PUT ${webPath}?foo=1`;
  const compact = `glab api -XPUT ${webPath}`;

  expect(trackedUrls('Bash', { command: sub }, '')).toEqual([WEB_57]);
  expect(trackedUrls('Bash', { command: query }, '')).toEqual([WEB_57]);
  expect(trackedUrls('Bash', { command: compact }, '')).toEqual([WEB_57]);
});

test('API update: several update steps yield each URL once, in order', () => {
  const command = [
    put(webPath),
    put('projects/acme%2Fplatform%2Fshop-api/merge_requests/42'),
    put(webPath),
  ].join(' && ');

  expect(trackedUrls('Bash', { command }, '')).toEqual([WEB_57, PR_42]);
});

test('a mixed ticket keeps its merged and closed PRs beside the open one; a merged ticket keeps all', () => {
  const mergedGithub = fromGithub(githubView({ state: 'MERGED', headRefName: 'feature/SHOP-198-x' }));
  const closed = fromGitlab(gitlabItem({ iid: 71, state: 'closed' }));
  const [open, done] = buildGroups([
    gitlab(GITLAB_MR_41),
    fromGitlab(gitlabItem({ iid: 28, state: 'merged' })),
    closed,
    fromGitlab(GITLAB_MR_12),
    mergedGithub,
  ]);

  expect(open?.prs.map((m) => `${m.ref} ${m.state}`)).toEqual([
    '!28 merged',
    '!41 ready',
    '!71 closed',
  ]);
  expect(done?.prs.map((m) => m.ref)).toEqual(['#88', '!12']);
});

test('browserArgv takes the first $BROWSER entry, split into argv, with %s or the URL last', () => {
  const url = PR_88;

  expect(browserArgv('firefox --new-window', url)).toEqual(['firefox', '--new-window', url]);
  expect(browserArgv('  /usr/bin/web-browser  ', url)).toEqual(['/usr/bin/web-browser', url]);
  expect(browserArgv('chromium --app=%s:firefox', url)).toEqual(['chromium', `--app=${url}`]);
  expect(browserArgv('opener %s --raise', url)).toEqual(['opener', url, '--raise']);
  expect(browserArgv('', url)).toEqual([]);
  expect(browserArgv(' :firefox', url)).toEqual([]);
});

const FETCHED_AT = Date.UTC(2026, 0, 15, 4, 0, 0);

test('listText lists every PR by group with icon, link, label, CI, 👍 and note', () => {
  const mergedGithub = fromGithub(
    githubView({
      state: 'MERGED',
      headRefName: 'feature/SHOP-198-x',
      latestReviews: GITHUB_LATEST_REVIEWS,
    }),
  );
  const groups = buildGroups(
    [gitlab(GITLAB_MR_42), gitlab(GITLAB_MR_41), fromGitlab(GITLAB_MR_12), mergedGithub],
    { 'SHOP-214': 'Checkout retries' },
  );

  expect(listText({ fetchedAt: FETCHED_AT, groups, errors: [] }, FETCHED_AT + 5 * 60000)).toBe(
    [
      '**SHOP-214** Checkout retries · fetched 5m ago',
      `- ● [!41](${GITLAB_MR_41.web_url}) shop-api — feat(SHOP-214): add retry to the checkout client · ready to merge · CI ✓ · 👍 1/1`,
      `- ○ [!42](${PR_42}) shop-api — feat(SHOP-214): back off between checkout retries · in review · 👍 1/1 · unresolved threads`,
      '',
      '**SHOP-198**',
      `- ✔ [#88](${PR_88}) docs — chore(ci): add a docs build workflow · merged · 👍 2`,
      `- ✔ [!12](${GITLAB_MR_12.web_url}) web — feat(SHOP-198): add a size chart to the product page · merged`,
    ].join('\n'),
  );
});

test('listText puts keyless PRs under a bare other header when a group exists', () => {
  const groups = buildGroups([gitlab(GITLAB_MR_41), fromGithub(GITHUB_88_VIEW)]);

  expect(listText({ fetchedAt: FETCHED_AT, groups, errors: [] }, FETCHED_AT)).toBe(
    [
      '**SHOP-214** · fetched just now',
      `- ● [!41](${GITLAB_MR_41.web_url}) shop-api — feat(SHOP-214): add retry to the checkout client · ready to merge · CI ✓ · 👍 1/1`,
      '',
      '**other**',
      `- ◌ [#88](${PR_88}) docs — chore(ci): add a docs build workflow · draft · 👍 0`,
    ].join('\n'),
  );
});

test('listText of a band with no group is a plain list with no header', () => {
  const groups = buildGroups([fromGithub(GITHUB_88_VIEW)]);

  expect(listText({ fetchedAt: FETCHED_AT, groups, errors: [] }, FETCHED_AT)).toBe(
    `- ◌ [#88](${PR_88}) docs — chore(ci): add a docs build workflow · draft · 👍 0 · fetched just now`,
  );
});

test('listText of a fresh snapshot with only errors says so, fetched just now', () => {
  expect(listText({ fetchedAt: FETCHED_AT, groups: [], errors: ['glab: 401'] }, FETCHED_AT + 59000)).toBe(
    '⚠ glab: 401 · fetched just now',
  );
  expect(listText({ fetchedAt: FETCHED_AT, groups: [], errors: [] }, FETCHED_AT)).toBe(
    'No pull requests in the snapshot · fetched just now',
  );
});
