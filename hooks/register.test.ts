import { expect, mock, test } from 'claude-code/testing';
import type { Engine, MockClock } from 'claude-code/testing';
import type { On, SessionMessage } from 'claude-code';

import {
  GH_AUTH_STATUS,
  GITHUB_88_VIEW,
  GITHUB_LATEST_REVIEWS,
  GITLAB_41_APPROVALS,
  GITLAB_MR_17,
  GITLAB_MR_41,
  GITLAB_MR_42,
  SESSION_CREATE_CALLS,
} from './fixtures';
import type { GitlabMr } from './fixtures';
import type { GithubPrView } from './prs';

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 160,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const;

const COMPOSER = {
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 160 },
} as const;

const NOW = Date.UTC(2026, 0, 15, 4, 0, 0);

const SHOP_API = 'projects/acme%2Fplatform%2Fshop-api/merge_requests';
const WEB = 'projects/acme%2Fplatform%2Fweb/merge_requests';
const PR_42 = GITLAB_MR_42.web_url;
const PR_88 = GITHUB_88_VIEW.url;
// A private repo: only the `octo-user` account can read it.
const PRIVATE_PR = 'https://github.com/octo-user/notebook/pull/12';
const TITLE_CMD = '/opt/bin/ticket-title';
// The title command the `task_title_cmd` option names.
const OPTION_TITLE_CMD = '/opt/bin/option-title';

/**
 * A finished MR of ticket SHOP-214 in shop-api, based on !41.
 */
function finishedMr(iid: number, state: string, over: Partial<GitlabMr> = {}): GitlabMr {
  return {
    ...GITLAB_MR_41,
    iid,
    state,
    title: `feat(SHOP-214): finished change ${iid}`,
    source_branch: `feature/SHOP-214-change-${iid}`,
    detailed_merge_status: 'not_open',
    web_url: `https://gitlab.com/acme/platform/shop-api/-/merge_requests/${iid}`,
    references: { full: `acme/platform/shop-api!${iid}` },
    ...over,
  };
}

// !7 was closed with conflicts and a failed pipeline; !28 merged.
const CLOSED_7 = finishedMr(7, 'closed', {
  has_conflicts: true,
  head_pipeline: { status: 'failed' },
});
const MERGED_28 = finishedMr(28, 'merged');

/**
 * How the test hosts answer one command: its output, or `'missing'` when its
 * binary cannot start (as a timeout, the call rejects).
 */
type Answer = { exitCode?: number; stdout?: string; stderr?: string } | 'missing';

/**
 * Per-command overrides of the default host answers. `gh` answers every
 * `gh pr` call (or, as `'missing'`, every `gh` call); `ghAuth` answers
 * `gh auth status`; `noToken` lists the logins whose `gh auth token` fails;
 * `views` adds `gh pr view` results by URL; `title` answers the title
 * command; `uname` is what `uname -sr` prints (a WSL kernel when unset);
 * `missing` lists the binaries that cannot start; `env` is the environment
 * the plugin reads.
 */
type Hosts = {
  glab?: Answer;
  gh?: Answer;
  ghAuth?: Answer;
  noToken?: string[];
  views?: Record<string, GithubPrView>;
  title?: Answer;
  uname?: string;
  missing?: string[];
  env?: Record<string, string>;
};

/**
 * One command the plugin ran, with the variables it set over the host's
 * environment and its timeout.
 */
type Run = { argv: string[]; env?: Record<string, string>; timeoutMs?: number };

/**
 * The fake token `gh auth token --user <login>` prints for a login.
 */
function tokenOf(login: string): string {
  return `gho_fake_${login}`;
}

/**
 * A successful run that prints `value` as JSON.
 */
function ok(value: unknown): Answer {
  return { stdout: JSON.stringify(value) };
}

/**
 * A run that exits 1, as `glab api` or `gh pr view` does for an unknown PR.
 */
const failed: Answer = { exitCode: 1, stderr: 'not found\n' };

/**
 * The fixtures, answered by argv the way `glab`, `gh`, `uname` and the
 * title command would on a WSL host. `gh` runs as the account whose token is
 * in `GH_TOKEN`, else as the active one; a PR it cannot read fails with an
 * error line that names that account.
 */
function answerOf(argv: readonly string[], hosts: Hosts, env?: Record<string, string>): Answer {
  const [tool, sub, path = ''] = argv;
  if (tool && hosts.missing?.includes(tool)) return 'missing';
  if (tool === TITLE_CMD) return hosts.title ?? { stdout: 'Checkout retries\nsecond line\n' };
  if (tool === OPTION_TITLE_CMD) return { stdout: 'Checkout retries from the option\n' };
  if (tool === 'glab' && hosts.glab) return hosts.glab;
  if (tool === 'gh' && hosts.gh === 'missing') return 'missing';
  if (tool === 'gh' && sub === 'auth' && path === 'status')
    return hosts.ghAuth ?? ok(GH_AUTH_STATUS);
  if (tool === 'gh' && sub === 'auth' && path === 'token') {
    const login = argv[argv.indexOf('--user') + 1] ?? '';
    return hosts.noToken?.includes(login) ? failed : { stdout: `${tokenOf(login)}\n` };
  }
  if (tool === 'gh' && hosts.gh) return hosts.gh;
  if (tool === 'glab' && sub === 'api') {
    if (path === `${SHOP_API}/41`) return ok(GITLAB_MR_41);
    if (path === `${SHOP_API}/41/approvals`) return ok(GITLAB_41_APPROVALS);
    if (path === `${SHOP_API}/42`) return ok(GITLAB_MR_42);
    if (path === `${SHOP_API}/42/approvals`) return ok({ approvals_required: 1, approvals_left: 1 });
    if (path === `${WEB}/17`) return ok(GITLAB_MR_17);
    if (path === `${SHOP_API}/7`) return ok(CLOSED_7);
    if (path === `${SHOP_API}/28`) return ok(MERGED_28);
    return failed;
  }
  const view = hosts.views?.[argv[3] ?? ''];
  if (tool === 'gh' && sub === 'pr' && view) return ok(view);
  if (tool === 'gh' && sub === 'pr' && argv[3] === PR_88) return ok(GITHUB_88_VIEW);
  if (
    tool === 'gh' &&
    sub === 'pr' &&
    argv[3] === PRIVATE_PR &&
    env?.GH_TOKEN === tokenOf('octo-user')
  )
    return ok({ ...GITHUB_88_VIEW, number: 12, url: PRIVATE_PR });
  if (tool === 'gh' && sub === 'pr') {
    const repo = (argv[3] ?? '').split('/').slice(3, 5).join('/');
    const who = env?.GH_TOKEN?.replace(tokenOf(''), '') ?? 'active';
    return {
      exitCode: 1,
      stderr: `GraphQL: Could not resolve to a Repository '${repo}' (as ${who})\n`,
    };
  }
  if (tool === 'gh') return failed;
  if (tool === 'uname') return { stdout: hosts.uname ?? 'Linux 6.6.0-microsoft-standard-WSL2\n' };
  return { exitCode: 1 };
}

/**
 * Answers `process.run` from the fixtures, `$.env.get` from `hosts.env`, and
 * the clock at `NOW`; returns every argv the plugin ran, each run with its
 * environment and timeout, and the clock.
 */
function hostsFor(on: On, hosts: Hosts = {}): { ran: string[][]; runs: Run[]; clock: MockClock } {
  engineBandFor(on);
  mock.env(on, hosts.env ?? {});
  const clock = mock.clock(on, { now: NOW });
  const ran: string[][] = [];
  const runs: Run[] = [];
  on('process.run', ($, e) => {
    ran.push([...e.argv]);
    runs.push({ argv: [...e.argv], env: e.init?.env, timeoutMs: e.init?.timeoutMs });
    const answer = answerOf(e.argv, hosts, e.init?.env);
    if (answer === 'missing') throw new Error(`${e.argv[0]}: not found`);
    return {
      value: {
        exitCode: answer.exitCode ?? 0,
        stdout: answer.stdout ?? '',
        stderr: answer.stderr ?? '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });
  return { ran, runs, clock };
}

/**
 * Answers every tool call as the shell would: each session command with
 * its result text, `gh pr create` with the PR URL, anything else with no
 * output. Returns the agent id each call ran under.
 */
function toolsFor(on: On): { agents: (string | undefined)[] } {
  const agents: (string | undefined)[] = [];
  on('tool.call', ($, e) => {
    agents.push(e.agentId);
    const command = e.tool === 'Bash' ? e.command : '';
    const call = SESSION_CREATE_CALLS.find((c) => c.command === command);
    const text = call?.result ?? (command.startsWith('gh pr create') ? `${PR_88}\n` : '');
    return { result: { stdout: text, stderr: '', interrupted: false }, text };
  });
  return { agents };
}

/**
 * Stands for the engine's own band drawing beneath the plugin's.
 */
function engineBandFor(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return Text({ children: 'engine band' });
  });
}

/**
 * Answers the engine beneath `session.start`: the command registration and
 * the session's own start.
 */
function sessionFor(on: On, messages: Record<string, SessionMessage[]> = {}): void {
  on('command.register', ($, e) => ({ value: { command: e.name } }));
  on('session.start', ($, e) => ({ cwd: e.cwd }));
  on('session.messages', ($, e) => {
    const id = e.agentId ?? 'main';
    const found = messages[id];
    if (found) return { value: found };
    return { value: id === 'main' ? [] : { deny: `no agent ${id}` } };
  });
}

/**
 * An assistant message holding one tool use, answered with `text`.
 */
function toolMessage(
  tool: string,
  input: Record<string, unknown>,
  text: string,
  agentId?: string,
): SessionMessage {
  return {
    role: 'assistant',
    text: '',
    toolUses: [{ tool_use_id: `toolu_${tool}_${text.length}`, tool, input, text, agentId }],
  };
}

/**
 * A main transcript whose `gh pr create` calls created each of `urls`.
 */
function createdTranscript(urls: string[]): Record<string, SessionMessage[]> {
  return { main: urls.map((url) => toolMessage('Bash', { command: 'gh pr create --fill' }, `${url}\n`)) };
}

const START = { cwd: '/tmp', surface: 'terminal', isInteractive: true } as const;

/**
 * Runs the first `glab mr create` call (shop-api !42) through the tool
 * chain, from the main loop or from a subagent's.
 */
async function createShopApiPr($: Engine, agentId?: string): Promise<void> {
  const call = SESSION_CREATE_CALLS[0]!;
  await $.tool.call({ tool: 'Bash', command: call.command, ...(agentId ? { agentId } : {}) });
}

/**
 * The title command runs among `runs`, from the env var or the option.
 */
function titleRunsOf(runs: Run[]): Run[] {
  return runs.filter((r) => r.argv[0] === TITLE_CMD || r.argv[0] === OPTION_TITLE_CMD);
}

test('a main-loop glab mr create adds the PR and the band shows it after the fetch', async ($, on) => {
  const { ran, clock } = hostsFor(on);
  toolsFor(on);

  await createShopApiPr($);
  await clock.settle();

  expect(ran).toContainEqual(['glab', 'api', `${SHOP_API}/42`]);
  expect(ran).toContainEqual(['glab', 'api', `${SHOP_API}/42/approvals`]);
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'my-pr-links', surface, ...BAND });

    expect((await ui.findAll({ type: 'Text', text: /just now/ })).length).toBe(1);
    expect(await ui.find({ text: /👍 0\/1/ })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: 'SHOP-214' })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: 'back off between checkout retries' })).toBeDefined();
    expect(await ui.find({ text: /review !42/ })).toBeDefined();
    expect(await ui.find({ text: /\[!42\]/ })).toBeDefined();
    expect(await ui.find({ text: /\[!41\]/ })).toBeUndefined();
    expect(await ui.find({ text: /⚠/ })).toBeUndefined();
  }
});

test('the band stacks above a band drawn by a hook beneath', async ($, on) => {
  const { clock } = hostsFor(on);
  toolsFor(on);

  await createShopApiPr($);
  await clock.settle();

  const ui = await $.ui.mount({ plugin: 'my-pr-links', surface: 'terminal', ...BAND });
  expect(await ui.find({ text: /\[!42\]/ })).toBeDefined();
  expect(await ui.find({ text: 'engine band' })).toBeDefined();
});

test('a glab mr create in a subagent loop adds the PR too', async ($, on) => {
  const { ran, clock } = hostsFor(on);
  const { agents } = toolsFor(on);

  await createShopApiPr($, 'agent-1');
  expect(agents).toEqual(['agent-1']);
  await clock.settle();

  expect(ran).toContainEqual(['glab', 'api', `${SHOP_API}/42`]);
  const ui = await $.ui.mount({ plugin: 'my-pr-links', surface: 'terminal', ...BAND });
  expect(await ui.find({ text: /\[!42\]/ })).toBeDefined();
});

test('session start backfills PRs from the main transcript and a subagent', async ($, on) => {
  const [shopApi, web] = SESSION_CREATE_CALLS;
  const { ran, clock } = hostsFor(on);
  sessionFor(on, {
    main: [
      toolMessage('Bash', { command: shopApi!.command }, shopApi!.result),
      toolMessage('Agent', { prompt: 'open the web PR' }, 'done', 'agent-1'),
      toolMessage('Bash', { command: 'glab mr view 41' }, GITLAB_MR_41.web_url),
    ],
    'agent-1': [
      toolMessage('Bash', { command: web!.command }, web!.result),
      toolMessage('Bash', { command: 'gh pr create --fill' }, `${PR_88}\n`),
      // A nested agent the session cannot read is skipped.
      toolMessage('Agent', { prompt: 'x' }, 'done', 'agent-gone'),
    ],
  });

  await $.session.start(START);
  await clock.settle();

  expect(ran).toContainEqual(['glab', 'api', `${SHOP_API}/42`]);
  expect(ran).toContainEqual(['glab', 'api', `${WEB}/17`]);
  expect(ran).toContainEqual(['gh', 'pr', 'view', PR_88, '--json', expect.any(String)]);
  expect(ran.some((argv) => argv[2] === `${SHOP_API}/41`)).toBe(false);

  const out = await $.command.run({ command: 'my-pr-links', args: 'refresh', ...COMPOSER });
  expect(out.text).toBe('3 PRs from this session');
  const ui = await $.ui.mount({ plugin: 'my-pr-links', surface: 'terminal', ...BAND });
  expect(await ui.find({ text: /\[!17\]/ })).toBeDefined();
  expect(await ui.find({ text: /\[#88\]/ })).toBeDefined();
  expect((await ui.findAll({ type: 'Text', text: /just now/ })).length).toBe(1);
  expect((await ui.find({ key: 'group-ticket-SHOP-214' }))?.text).toMatch(/just now/);
  expect((await ui.find({ key: 'group-other-other' }))?.text).toMatch(/\[#88\]/);
});

test('with nothing created the band is not drawn and nothing is fetched', async ($, on) => {
  const { ran, clock } = hostsFor(on);
  toolsFor(on);
  sessionFor(on);

  await $.session.start(START);
  await $.tool.call({ tool: 'Bash', command: 'glab mr view 41' });
  await clock.advance(10 * 60 * 1000);

  const out = await $.command.run({ command: 'my-pr-links', args: 'refresh', ...COMPOSER });
  expect(out.text).toBe('No pull requests created or updated in this session yet.');
  expect(ran.filter((argv) => argv[0] === 'glab' || argv[0] === 'gh')).toEqual([]);
  const ui = await $.ui.mount({ plugin: 'my-pr-links', surface: 'terminal', ...BAND });
  expect(await ui.find({ text: 'engine band' })).toBeDefined();
  expect(await ui.find({ text: /\[!/ })).toBeUndefined();
});

test('refresh reports the session PRs and a failing call as an error line', async ($, on) => {
  const { clock } = hostsFor(on, {
    glab: { exitCode: 1, stderr: 'HTTP 401: Unauthorized\nmore\n' },
  });
  toolsFor(on);

  await createShopApiPr($);
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' });
  await clock.settle();
  const out = await $.command.run({ command: 'my-pr-links', args: 'refresh', ...COMPOSER });

  expect(out.text).toBe('2 PRs from this session · ⚠ glab: HTTP 401: Unauthorized');
  const ui = await $.ui.mount({ plugin: 'my-pr-links', surface: 'terminal', ...BAND });
  expect(await ui.find({ text: /⚠ glab: HTTP 401: Unauthorized/ })).toBeDefined();
  expect(await ui.find({ text: 'ci: add a docs build workflow' })).toBeDefined();
});

test('a band with no ticket or branch group shows plain rows with no header', async ($, on) => {
  const { clock } = hostsFor(on);
  toolsFor(on);

  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' });
  await clock.settle();

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'my-pr-links', surface, ...BAND });
    expect(await ui.find({ text: /\[#88\]/ })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: 'ci: add a docs build workflow' })).toBeDefined();
    expect(await ui.find({ type: 'Text', text: 'other' })).toBeUndefined();
    expect(await ui.find({ text: /undraft #88/ })).toBeUndefined();
    expect((await ui.findAll({ type: 'Text', text: /just now/ })).length).toBe(1);
  }
});

test('keyless PRs go under a bare other header when a ticket group exists', async ($, on) => {
  const { clock } = hostsFor(on);
  toolsFor(on);

  await createShopApiPr($);
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' });
  await clock.settle();

  const ui = await $.ui.mount({ plugin: 'my-pr-links', surface: 'terminal', ...BAND });
  const other = await ui.find({ key: 'group-other-other' });
  expect(other?.text).toMatch(/^other▸ undraft #88/);
  expect(await ui.find({ type: 'Text', text: 'other' })).toBeDefined();
  // `other` is the last group.
  expect((await ui.find({ text: /SHOP-214[\s\S]*other/ }))).toBeDefined();
});

test('PRs without a key that share a branch group under it, with no title command call', async ($, on) => {
  const branch = 'dependabot/npm_and_yarn/lodash-4.17.21';
  const bump = (repo: string, number: number): GithubPrView => ({
    ...GITHUB_88_VIEW,
    isDraft: false,
    number,
    title: 'Bump lodash from 4.17.20 to 4.17.21',
    body: 'Bumps lodash.',
    headRefName: branch,
    url: `https://github.com/octo-org/${repo}/pull/${number}`,
  });
  const views = { [bump('docs', 5).url]: bump('docs', 5), [bump('site', 9).url]: bump('site', 9) };
  const { runs, clock } = hostsFor(on, { views, env: { MY_PR_LINKS_TASK_TITLE_CMD: TITLE_CMD } });
  sessionFor(on, createdTranscript(Object.keys(views)));

  await $.session.start(START);
  await clock.settle();

  expect(titleRunsOf(runs)).toEqual([]);
  const ui = await $.ui.mount({ plugin: 'my-pr-links', surface: 'terminal', ...BAND });
  const group = await ui.find({ key: `group-branch-${branch}` });
  expect(group?.text).toMatch(/\[#5\][\s\S]*\[#9\]/);
  expect(await ui.find({ type: 'Text', text: branch })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: 'Checkout retries' })).toBeUndefined();
});

test('the title command gives the ticket header its title, once per key per fetch', async ($, on) => {
  const { runs, clock } = hostsFor(on, { env: { MY_PR_LINKS_TASK_TITLE_CMD: TITLE_CMD } });
  sessionFor(on, createdTranscript([PR_42, GITLAB_MR_17.web_url, PR_88]));

  await $.session.start(START);
  await clock.settle();

  expect(titleRunsOf(runs)).toEqual([
    { argv: [TITLE_CMD, 'SHOP-214'], env: undefined, timeoutMs: 2000 },
  ]);
  const ui = await $.ui.mount({ plugin: 'my-pr-links', surface: 'terminal', ...BAND });
  expect((await ui.find({ key: 'group-ticket-SHOP-214' }))?.text).toMatch(
    /^SHOP-214Checkout retries▸ review !42/,
  );
  expect(await ui.find({ text: /second line/ })).toBeUndefined();
  // `other` never has a title.
  expect((await ui.find({ key: 'group-other-other' }))?.text).not.toMatch(/Checkout retries/);

  await $.command.run({ command: 'my-pr-links', args: 'refresh', ...COMPOSER });
  expect(titleRunsOf(runs)).toHaveLength(2);
  const list = await $.command.run({ command: 'my-pr-links', args: 'list', ...COMPOSER });
  expect(list.text?.split('\n')[0]).toBe('**SHOP-214** Checkout retries · fetched just now');
});

test('with the title command unset, nothing runs and the header shows the key alone', async ($, on) => {
  const { ran, clock } = hostsFor(on);
  toolsFor(on);

  await createShopApiPr($);
  await clock.settle();

  expect(ran.filter((argv) => argv[0] === TITLE_CMD)).toEqual([]);
  const ui = await $.ui.mount({ plugin: 'my-pr-links', surface: 'terminal', ...BAND });
  expect((await ui.find({ key: 'group-ticket-SHOP-214' }))?.text).toMatch(/^SHOP-214▸ review !42/);
});

test(
  'the task_title_cmd option wins over the env var',
  { options: { task_title_cmd: OPTION_TITLE_CMD } },
  async ($, on) => {
    const { runs, clock } = hostsFor(on, { env: { MY_PR_LINKS_TASK_TITLE_CMD: TITLE_CMD } });
    toolsFor(on);

    await createShopApiPr($);
    await clock.settle();

    expect(titleRunsOf(runs)).toEqual([
      { argv: [OPTION_TITLE_CMD, 'SHOP-214'], env: undefined, timeoutMs: 2000 },
    ]);
    const ui = await $.ui.mount({ plugin: 'my-pr-links', surface: 'terminal', ...BAND });
    expect((await ui.find({ key: 'group-ticket-SHOP-214' }))?.text).toMatch(
      /^SHOP-214Checkout retries from the option▸ review !42/,
    );
  },
);

test(
  'an empty task_title_cmd option falls back to the env var',
  { options: { task_title_cmd: '  ' } },
  async ($, on) => {
    const { runs, clock } = hostsFor(on, { env: { MY_PR_LINKS_TASK_TITLE_CMD: TITLE_CMD } });
    toolsFor(on);

    await createShopApiPr($);
    await clock.settle();

    expect(titleRunsOf(runs).map((r) => r.argv)).toEqual([[TITLE_CMD, 'SHOP-214']]);
  },
);

test(
  'with an empty option and no env var, no title command runs',
  { options: { task_title_cmd: '' } },
  async ($, on) => {
    const { runs, clock } = hostsFor(on);
    toolsFor(on);

    await createShopApiPr($);
    await clock.settle();

    expect(titleRunsOf(runs)).toEqual([]);
  },
);

for (const [name, title] of [
  ['exits non-zero',{ exitCode: 1, stdout: 'Checkout retries\n', stderr: 'no such ticket\n' }],
  ['prints nothing', { stdout: '\n  \n' }],
  ['times out', 'missing'],
] as const) {
  test(`a title command that ${name} leaves the header untitled, with no error`, async ($, on) => {
    const { runs, clock } = hostsFor(on, {
      title,
      env: { MY_PR_LINKS_TASK_TITLE_CMD: TITLE_CMD },
    });
    toolsFor(on);

    await createShopApiPr($);
    await clock.settle();

    expect(titleRunsOf(runs).map((r) => r.argv)).toEqual([[TITLE_CMD, 'SHOP-214']]);
    const ui = await $.ui.mount({ plugin: 'my-pr-links', surface: 'terminal', ...BAND });
    expect((await ui.find({ key: 'group-ticket-SHOP-214' }))?.text).toMatch(
      /^SHOP-214▸ review !42/,
    );
    expect(await ui.find({ text: /Checkout retries/ })).toBeUndefined();
    expect(await ui.find({ text: /⚠/ })).toBeUndefined();
  });
}

test('a long row title is cut to 50 characters; its hover detail keeps the full title', async ($, on) => {
  const long = 'feat(SHOP-214): add a retry with exponential backoff and jitter to every checkout call';
  const { clock } = hostsFor(on, {
    glab: ok({ ...GITLAB_MR_42, title: long }),
  });
  toolsFor(on);

  await createShopApiPr($);
  await clock.settle();

  const ui = await $.ui.mount({ plugin: 'my-pr-links', surface: 'terminal', ...BAND });
  const row = await ui.find({ type: 'Text', text: /^add a retry/ });
  expect(row?.text).toBe('add a retry with exponential backoff and jitter t…');
  expect(row?.text.length).toBe(50);
  expect(row?.props).toMatchObject({ wrap: 'truncate-end' });
  const detail = await ui.find({ key: 'd-pr-ticket-SHOP-214-gitlab-shop-api-42' });
  expect(detail?.text).toContain(long);
});

test('a ready GitHub PR nobody approved shows 👍 0 in the warning color', async ($, on) => {
  const ready = { ...GITHUB_88_VIEW, isDraft: false, mergeStateStatus: 'CLEAN' };
  const { ran, clock } = hostsFor(on, { gh: ok({ ...ready, latestReviews: [] }) });
  toolsFor(on);

  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' });
  await clock.settle();

  const view = ran.find((argv) => argv[0] === 'gh' && argv[1] === 'pr');
  expect(view?.[5]?.split(',')).toContain('latestReviews');
  expect(view?.[5]?.split(',')).toContain('body');
  const ui = await $.ui.mount({ plugin: 'my-pr-links', surface: 'terminal', ...BAND });
  const cell = await ui.find({ type: 'Text', text: '👍 0' });
  expect(cell?.props).toMatchObject({ color: 'warning' });
  expect(cell?.props.dimColor).toBeUndefined();
});

test('an approved ready GitHub PR shows its 👍 count dim', async ($, on) => {
  const ready = { ...GITHUB_88_VIEW, isDraft: false, mergeStateStatus: 'CLEAN' };
  const { clock } = hostsFor(on, { gh: ok({ ...ready, latestReviews: GITHUB_LATEST_REVIEWS }) });
  toolsFor(on);

  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' });
  await clock.settle();

  const ui = await $.ui.mount({ plugin: 'my-pr-links', surface: 'terminal', ...BAND });
  const cell = await ui.find({ type: 'Text', text: '👍 2' });
  expect(cell?.props).toMatchObject({ dimColor: true });
  expect(cell?.props.color).toBeUndefined();
});

test('a CLI whose binary cannot start skips its PR without an error line', async ($, on) => {
  const { clock } = hostsFor(on, { gh: 'missing' });
  toolsFor(on);

  await createShopApiPr($);
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' });
  await clock.settle();
  const out = await $.command.run({ command: 'my-pr-links', args: 'refresh', ...COMPOSER });

  expect(out.text).toBe('2 PRs from this session');
  const ui = await $.ui.mount({ plugin: 'my-pr-links', surface: 'terminal', ...BAND });
  expect(await ui.find({ text: /\[!42\]/ })).toBeDefined();
  expect(await ui.find({ text: /#88/ })).toBeUndefined();
  expect(await ui.find({ text: /⚠/ })).toBeUndefined();
});

/**
 * The `gh pr view` runs among `runs`, each as its URL and the `GH_TOKEN` it set.
 */
function viewsOf(runs: Run[]): { url: string | undefined; token: string | undefined }[] {
  return runs
    .filter((r) => r.argv[0] === 'gh' && r.argv[1] === 'pr')
    .map((r) => ({ url: r.argv[3], token: r.env?.GH_TOKEN }));
}

test('a private PR resolves as the account named like the URL owner', async ($, on) => {
  const { ran, runs, clock } = hostsFor(on);
  toolsFor(on);

  await $.command.run({ command: 'my-pr-links', args: `add ${PRIVATE_PR}`, ...COMPOSER });
  await clock.settle();

  expect(ran).toContainEqual([
    'gh',
    'auth',
    'status',
    '--json',
    'hosts',
    '--hostname',
    'github.com',
  ]);
  expect(ran).toContainEqual([
    'gh',
    'auth',
    'token',
    '--hostname',
    'github.com',
    '--user',
    'octo-user',
  ]);
  expect(viewsOf(runs)).toEqual([{ url: PRIVATE_PR, token: tokenOf('octo-user') }]);
  const ui = await $.ui.mount({ plugin: 'my-pr-links', surface: 'terminal', ...BAND });
  expect(await ui.find({ text: /\[#12\]/ })).toBeDefined();
  expect(await ui.find({ text: /⚠/ })).toBeUndefined();
});

test('a PR no account can read shows the first attempt as one error line', async ($, on) => {
  const gone = 'https://github.com/octo-user/gone/pull/3';
  const { ran, runs, clock } = hostsFor(on);
  toolsFor(on);

  await $.command.run({ command: 'my-pr-links', args: `add ${gone}`, ...COMPOSER });
  await clock.settle();

  // The owner's account first, then the active one; the account in error is never tried.
  expect(viewsOf(runs)).toEqual([
    { url: gone, token: tokenOf('octo-user') },
    { url: gone, token: undefined },
  ]);
  expect(ran.some((argv) => argv.includes('octo-retired'))).toBe(false);
  const ui = await $.ui.mount({ plugin: 'my-pr-links', surface: 'terminal', ...BAND });
  const errors = await ui.findAll({ type: 'Text', text: /⚠/ });
  expect(errors.map((t) => t.text)).toEqual([
    "⚠ gh: GraphQL: Could not resolve to a Repository 'octo-user/gone' (as octo-user)",
  ]);
});

test('an account whose token cannot be read is skipped for one plain gh pr view', async ($, on) => {
  // The active login's token is broken; only `octo-user` (inactive) is logged in.
  const accounts = GH_AUTH_STATUS.hosts['github.com'].map((a) =>
    a.active ? { ...a, state: 'error' } : a,
  );
  const { ran, runs, clock } = hostsFor(on, {
    ghAuth: ok({ hosts: { 'github.com': accounts } }),
    noToken: ['octo-user'],
  });
  toolsFor(on);

  await $.command.run({ command: 'my-pr-links', args: `add ${PRIVATE_PR}`, ...COMPOSER });
  await clock.settle();

  expect(ran.filter((argv) => argv[1] === 'auth' && argv[2] === 'token')).toEqual([
    ['gh', 'auth', 'token', '--hostname', 'github.com', '--user', 'octo-user'],
  ]);
  expect(viewsOf(runs)).toEqual([{ url: PRIVATE_PR, token: undefined }]);
});

test('a token is read once per snapshot for all its PRs, and again on refresh', async ($, on) => {
  const otherPrivate = 'https://github.com/octo-user/notebook/pull/13';
  const { ran, runs, clock } = hostsFor(on);
  sessionFor(on, createdTranscript([PRIVATE_PR, otherPrivate]));
  const tokenReads = () =>
    ran.filter((argv) => argv[1] === 'auth' && argv[2] === 'token' && argv.at(-1) === 'octo-user')
      .length;

  await $.session.start(START);
  await clock.settle();

  expect(viewsOf(runs).slice(0, 2)).toEqual([
    { url: PRIVATE_PR, token: tokenOf('octo-user') },
    { url: otherPrivate, token: tokenOf('octo-user') },
  ]);
  expect(tokenReads()).toBe(1);

  await $.command.run({ command: 'my-pr-links', args: 'refresh', ...COMPOSER });
  expect(tokenReads()).toBe(2);
});

test('when gh auth status fails each GitHub PR gets one plain gh pr view', async ($, on) => {
  const { ran, runs, clock } = hostsFor(on, { ghAuth: failed });
  toolsFor(on);

  await $.command.run({ command: 'my-pr-links', args: `add ${PRIVATE_PR}`, ...COMPOSER });
  await clock.settle();

  expect(ran.some((argv) => argv[1] === 'auth' && argv[2] === 'token')).toBe(false);
  expect(viewsOf(runs)).toEqual([{ url: PRIVATE_PR, token: undefined }]);
  const ui = await $.ui.mount({ plugin: 'my-pr-links', surface: 'terminal', ...BAND });
  expect(
    await ui.find({
      text: /⚠ gh: GraphQL: Could not resolve to a Repository 'octo-user\/notebook' \(as active\)/,
    }),
  ).toBeDefined();
});

test('the tick refreshes once the snapshot is 3 minutes old', async ($, on) => {
  const { ran, clock } = hostsFor(on);
  toolsFor(on);
  sessionFor(on);

  await $.session.start(START);
  await createShopApiPr($);
  await clock.settle();
  const fetches = () => ran.filter((argv) => argv[2] === `${SHOP_API}/42`).length;
  expect(fetches()).toBe(1);

  await clock.advance(2 * 60 * 1000);
  expect(fetches()).toBe(1);
  await clock.advance(60 * 1000);
  expect(fetches()).toBe(2);
});

test('a PR created while a fetch runs gets one more fetch', async ($, on) => {
  const { ran, clock } = hostsFor(on);
  toolsFor(on);
  const [, web] = SESSION_CREATE_CALLS;

  await Promise.all([createShopApiPr($), $.tool.call({ tool: 'Bash', command: web!.command })]);
  await clock.settle();

  expect(ran).toContainEqual(['glab', 'api', `${WEB}/17`]);
  const ui = await $.ui.mount({ plugin: 'my-pr-links', surface: 'terminal', ...BAND });
  expect(await ui.find({ text: /\[!42\]/ })).toBeDefined();
  expect(await ui.find({ text: /\[!17\]/ })).toBeDefined();
});

test('a self-hosted GitLab MR is fetched with --hostname', async ($, on) => {
  const { ran, clock } = hostsFor(on);
  on('tool.call', () => {
    const text = 'https://gitlab.example.com/acme/web/-/merge_requests/7\n';
    return { result: { stdout: text, stderr: '', interrupted: false }, text };
  });

  await $.tool.call({ tool: 'Bash', command: 'glab mr create --fill --yes' });
  await clock.settle();

  expect(ran).toContainEqual([
    'glab',
    'api',
    'projects/acme%2Fweb/merge_requests/7',
    '--hostname',
    'gitlab.example.com',
  ]);
});

test('/my-pr-links open routes 42, !42 and #88 to explorer.exe on WSL', async ($, on) => {
  const { ran, clock } = hostsFor(on);
  toolsFor(on);
  await createShopApiPr($);
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' });
  await clock.settle();

  const bare = await $.command.run({ command: 'my-pr-links', args: 'open 42', ...COMPOSER });
  const gitlab = await $.command.run({ command: 'my-pr-links', args: 'open !42', ...COMPOSER });
  const github = await $.command.run({ command: 'my-pr-links', args: 'open #88', ...COMPOSER });
  const missing = await $.command.run({ command: 'my-pr-links', args: 'open !41', ...COMPOSER });

  expect(bare.text).toBe('Opened shop-api !42 in Windows browser');
  expect(gitlab.text).toBe('Opened shop-api !42 in Windows browser');
  expect(github.text).toBe('Opened docs #88 in Windows browser');
  expect(missing.text).toBe('No PR !41 in the band.');
  expect(ran).toContainEqual(['explorer.exe', PR_42]);
  expect(ran).toContainEqual(['explorer.exe', PR_88]);
});

test('/my-pr-links open runs $BROWSER with the URL when it is set', async ($, on) => {
  const { ran, clock } = hostsFor(on, { env: { BROWSER: '/usr/local/bin/web-browser' } });
  toolsFor(on);
  await createShopApiPr($);
  await clock.settle();

  const out = await $.command.run({ command: 'my-pr-links', args: 'open !42', ...COMPOSER });

  expect(out.text).toBe('Opened shop-api !42 in browser');
  expect(ran).toContainEqual(['/usr/local/bin/web-browser', PR_42]);
  expect(ran.some((argv) => argv[0] === 'uname' || argv[0] === 'explorer.exe')).toBe(false);
});

test('$BROWSER with arguments runs as argv with the URL last', async ($, on) => {
  const { ran, clock } = hostsFor(on, { env: { BROWSER: 'firefox --new-window' } });
  toolsFor(on);
  await createShopApiPr($);
  await clock.settle();

  const out = await $.command.run({ command: 'my-pr-links', args: 'open !42', ...COMPOSER });

  expect(out.text).toBe('Opened shop-api !42 in browser');
  expect(ran).toContainEqual(['firefox', '--new-window', PR_42]);
  expect(ran.some((argv) => argv[0] === 'uname')).toBe(false);
});

test('a $BROWSER that cannot start falls back to the platform opener', async ($, on) => {
  const { ran, clock } = hostsFor(on, {
    env: { BROWSER: 'firefox --new-window' },
    missing: ['firefox'],
  });
  toolsFor(on);
  await createShopApiPr($);
  await clock.settle();

  const out = await $.command.run({ command: 'my-pr-links', args: 'open !42', ...COMPOSER });

  expect(out.text).toBe('Opened shop-api !42 in Windows browser');
  const opens = ran.filter((argv) => argv.includes(PR_42));
  expect(opens).toEqual([
    ['firefox', '--new-window', PR_42],
    ['explorer.exe', PR_42],
  ]);
});

for (const [os, kernel, opener, where] of [
  ['macOS', 'Darwin 23.6.0\n', 'open', 'macOS browser'],
  ['plain Linux', 'Linux 6.8.0-45-generic\n', 'xdg-open', 'browser'],
] as const) {
  test(`with $BROWSER unset, open uses ${opener} on ${os}`, async ($, on) => {
    const { ran, clock } = hostsFor(on, { uname: kernel });
    toolsFor(on);
    await createShopApiPr($);
    await clock.settle();

    const out = await $.command.run({ command: 'my-pr-links', args: 'open !42', ...COMPOSER });

    expect(out.text).toBe(`Opened shop-api !42 in ${where}`);
    expect(ran).toContainEqual([opener, PR_42]);
    expect(ran.some((argv) => argv[0] === 'explorer.exe')).toBe(false);
  });
}

test('clicking a ref opens its URL and says which PR it was', async ($, on) => {
  const { ran, clock } = hostsFor(on);
  toolsFor(on);
  const toasts: string[] = [];
  on('ui.toast', ($, e) => {
    toasts.push(e.text);
    return { value: undefined };
  });
  await createShopApiPr($);
  await clock.settle();

  const ui = await $.ui.mount({ plugin: 'my-pr-links', surface: 'terminal', ...BAND });
  await ui.press({ key: 'link-pr-ticket-SHOP-214-gitlab-shop-api-42', link: { href: PR_42 } });

  expect(ran).toContainEqual(['explorer.exe', PR_42]);
  expect(toasts).toEqual(['⑂ opened shop-api !42 in Windows browser']);
});

test('unparseable gh and glab output shows one error line per CLI', async ($, on) => {
  const { clock } = hostsFor(on, {
    glab: { stdout: '<html>502 Bad Gateway</html>' },
    gh: { stdout: 'not json' },
  });
  toolsFor(on);

  await createShopApiPr($);
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' });
  await clock.settle();
  const out = await $.command.run({ command: 'my-pr-links', args: 'refresh', ...COMPOSER });

  expect(out.text).toBe('2 PRs from this session · ⚠ glab: unparseable JSON · gh: unparseable JSON');
  const ui = await $.ui.mount({ plugin: 'my-pr-links', surface: 'terminal', ...BAND });
  expect(await ui.find({ text: /⚠ glab: unparseable JSON · gh: unparseable JSON/ })).toBeDefined();
  expect(await ui.find({ text: /\[!42\]|\[#88\]/ })).toBeUndefined();
});

test('a description trailer puts PRs from both hosts in the ticket group', async ($, on) => {
  const mr = {
    ...GITLAB_MR_42,
    source_branch: 'fix/backoff',
    title: 'back off between checkout retries',
    description: 'Adds a backoff.\n\nRefs: SHOP-214',
  };
  const pr = {
    ...GITHUB_88_VIEW,
    headRefName: 'octo-user/retry-banner',
    title: 'show a retry banner',
    body: 'Shows a banner.\r\n\r\nCloses SHOP-214\r\n',
  };
  const { clock } = hostsFor(on, { glab: ok(mr), gh: ok(pr) });
  toolsFor(on);

  await createShopApiPr($);
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' });
  await clock.settle();

  const ui = await $.ui.mount({ plugin: 'my-pr-links', surface: 'terminal', ...BAND });
  expect((await ui.find({ key: 'group-ticket-SHOP-214' }))?.text).toMatch(/\[#88\][\s\S]*\[!42\]/);
  expect(await ui.find({ key: 'group-other-other' })).toBeUndefined();
  const list = await $.command.run({ command: 'my-pr-links', args: 'list', ...COMPOSER });
  expect(list.text).not.toMatch(/Adds a backoff|Shows a banner/);
});

test('/my-pr-links toggles the band', async ($) => {
  const hid = await $.command.run({ command: 'my-pr-links', args: '', ...COMPOSER });
  expect(hid.text).toContain('hidden');

  const shown = await $.command.run({ command: 'my-pr-links', args: '', ...COMPOSER });
  expect(shown.text).toContain('shown');
});

test('/my-pr-links add adds a PR once and rejects a bad argument', async ($, on) => {
  const { ran, clock } = hostsFor(on);
  toolsFor(on);
  const run = (args: string) => $.command.run({ command: 'my-pr-links', args, ...COMPOSER });

  const first = await run(`add ${PR_42}`);
  await clock.settle();
  const again = await run(`add ${PR_42}`);
  const none = await run('add');
  const bad = await run('add https://gitlab.com/acme/web/-/merge_requests/new');

  expect(first.text).toBe('Added !42 to the band.');
  expect(again.text).toBe(`${PR_42} is already in the band.`);
  expect(none.text).toContain('Usage: /my-pr-links add <url>');
  expect(bad.text).toContain('Usage: /my-pr-links add <url>');
  expect(ran.filter((argv) => argv[2] === `${SHOP_API}/42`)).toHaveLength(1);
  const ui = await $.ui.mount({ plugin: 'my-pr-links', surface: 'terminal', ...BAND });
  expect(await ui.find({ text: /\[!42\]/ })).toBeDefined();
});

test('an all-merged ticket still shows each merged PR as a row with its 👍 count', async ($, on) => {
  const merged = {
    ...GITHUB_88_VIEW,
    isDraft: false,
    state: 'MERGED',
    headRefName: 'feature/WEB-7-docs-build',
  };
  const { clock } = hostsFor(on, { gh: ok({ ...merged, latestReviews: GITHUB_LATEST_REVIEWS }) });
  toolsFor(on);

  await $.tool.call({ tool: 'Bash', command: 'gh pr create --fill' });
  await clock.settle();

  const ui = await $.ui.mount({ plugin: 'my-pr-links', surface: 'terminal', ...BAND });
  expect((await ui.find({ key: 'group-ticket-WEB-7' }))?.text).toMatch(/all 1 merged/);
  expect(await ui.find({ text: /\[#88\]/ })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: 'ci: add a docs build workflow' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /^merged$/ })).toBeDefined();
  expect((await ui.find({ type: 'Text', text: '👍 2' }))?.props).toMatchObject({ dimColor: true });
});

test('a mixed ticket gives its merged and closed PRs their own rows, the closed one dim', async ($, on) => {
  const { clock } = hostsFor(on);
  toolsFor(on);
  const add = (pr: GitlabMr) =>
    $.command.run({ command: 'my-pr-links', args: `add ${pr.web_url}`, ...COMPOSER });

  await createShopApiPr($);
  await add(MERGED_28);
  await add(CLOSED_7);
  await clock.settle();

  const ui = await $.ui.mount({ plugin: 'my-pr-links', surface: 'terminal', ...BAND });
  const group = await ui.find({ key: 'group-ticket-SHOP-214' });
  expect(group?.text).toMatch(/review !42/);
  expect(group?.text).toMatch(/\[!7\][\s\S]*\[!28\][\s\S]*\[!42\]/);

  const merged = await ui.find({ type: 'Text', text: /^merged$/ });
  expect(merged?.props).toMatchObject({ color: 'merged' });
  const mergedRef = await ui.find({ type: 'Markdown', text: /\[!28\]/ });
  expect(mergedRef?.props).toMatchObject({ dimColor: false });
  const mergedTitle = await ui.find({ type: 'Text', text: /^finished change 28$/ });
  expect(mergedTitle?.props).toMatchObject({ dimColor: false });

  const closed = await ui.find({ type: 'Text', text: /^closed$/ });
  expect(closed?.props).toMatchObject({ color: 'inactive' });
  expect(closed?.props.dimColor).toBeUndefined();
  const closedRef = await ui.find({ type: 'Markdown', text: /\[!7\]/ });
  expect(closedRef?.props).toMatchObject({ dimColor: true });
  const closedTitle = await ui.find({ type: 'Text', text: /^finished change 7$/ });
  expect(closedTitle?.props).toMatchObject({ dimColor: true });
  const ci = await ui.find({ type: 'Text', text: /^CI ✖$/ });
  expect(ci?.props).toMatchObject({ dimColor: true });
  expect(ci?.props.color).toBeUndefined();

  // The row note shows on the open PR only; the hover detail keeps it for every PR.
  const rowRemarks = (await ui.findAll({ type: 'Text', text: /^· / })).filter(
    (t) => t.props.color === 'warning',
  );
  expect(rowRemarks.map((t) => t.text)).toEqual(['· unresolved threads']);
  for (const iid of [7, 28]) {
    const detail = await ui.find({ key: `d-pr-ticket-SHOP-214-gitlab-shop-api-${iid}` });
    expect(detail?.text).toMatch(`finished change ${iid}`);
  }
});

test('/my-pr-links list prints the snapshot, even with the band hidden', async ($, on) => {
  const { ran, clock } = hostsFor(on);
  toolsFor(on);
  const run = (args: string) => $.command.run({ command: 'my-pr-links', args, ...COMPOSER });

  const none = await run('list');
  expect(none.text).toBe('No pull requests created or updated in this session yet.');

  await createShopApiPr($);
  await clock.settle();
  await run('');
  await clock.advance(5 * 60 * 1000);
  const fetches = ran.filter((argv) => argv[2] === `${SHOP_API}/42`).length;
  const out = await run('list');

  expect(out.text).toBe(
    [
      '**SHOP-214** · fetched 5m ago',
      `- ○ [!42](${PR_42}) shop-api — feat(SHOP-214): back off between checkout retries · in review · 👍 0/1 · unresolved threads`,
    ].join('\n'),
  );
  expect(ran.filter((argv) => argv[2] === `${SHOP_API}/42`)).toHaveLength(fetches);
});
