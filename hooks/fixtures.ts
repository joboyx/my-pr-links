/**
 * `glab`, `gh` and session tool-call output in the shape the real CLIs
 * print, on made-up projects, shared by the tests. Test-only: the hooks
 * module never imports this file.
 */

import type {
  GithubPrListItem,
  GithubPrView,
  GithubReview,
  GitlabMrApprovals,
  GitlabMrItem,
  GitlabMrListItem,
} from './prs';

/**
 * One Bash call of a session and the result text the model read.
 */
export type SessionCall = { command: string; result: string };

/**
 * One entry of `glab api projects/:id/merge_requests?…`: the single-MR
 * fields less the head pipeline, plus the project ids.
 */
export type GitlabMrListEntry = Omit<GitlabMrItem, 'head_pipeline'> &
  GitlabMrListItem & { id: number; project_id: number };

/**
 * `glab api projects/:id/merge_requests/41`: ready to merge, pipeline passed.
 */
export const GITLAB_MR_41: GitlabMrItem = {
  iid: 41,
  title: 'feat(SHOP-214): add retry to the checkout client',
  description: 'Retries a failed checkout call up to 3 times.',
  source_branch: 'feature/SHOP-214-checkout-retry',
  target_branch: 'main',
  draft: false,
  state: 'opened',
  detailed_merge_status: 'mergeable',
  web_url: 'https://gitlab.com/acme/platform/shop-api/-/merge_requests/41',
  references: { full: 'acme/platform/shop-api!41' },
  has_conflicts: false,
  head_pipeline: {
    status: 'success',
    web_url: 'https://gitlab.com/acme/platform/shop-api/-/pipelines/5001',
  },
};

/**
 * `glab api projects/:id/merge_requests/42`: stacked on !41, with open
 * threads and no pipeline yet.
 */
export const GITLAB_MR_42: GitlabMrItem = {
  iid: 42,
  title: 'feat(SHOP-214): back off between checkout retries',
  description: null,
  source_branch: 'feature/SHOP-214-backoff',
  target_branch: 'feature/SHOP-214-checkout-retry',
  draft: false,
  state: 'opened',
  detailed_merge_status: 'discussions_not_resolved',
  web_url: 'https://gitlab.com/acme/platform/shop-api/-/merge_requests/42',
  references: { full: 'acme/platform/shop-api!42' },
  has_conflicts: false,
  head_pipeline: null,
};

/**
 * `glab api projects/:id/merge_requests/17`: a draft in another project, on
 * a branch named like !42's.
 */
export const GITLAB_MR_17: GitlabMrItem = {
  iid: 17,
  title: 'Draft: feat(SHOP-214): show a retry notice at checkout',
  description: '',
  source_branch: 'feature/SHOP-214-backoff',
  target_branch: 'develop',
  draft: true,
  state: 'opened',
  detailed_merge_status: 'draft_status',
  web_url: 'https://gitlab.com/acme/platform/web/-/merge_requests/17',
  references: { full: 'acme/platform/web!17' },
  has_conflicts: false,
};

/**
 * `glab api projects/:id/merge_requests/12`: merged, another ticket.
 */
export const GITLAB_MR_12: GitlabMrItem = {
  iid: 12,
  title: 'feat(SHOP-198): add a size chart to the product page',
  source_branch: 'feature/SHOP-198-size-chart',
  target_branch: 'develop',
  draft: false,
  state: 'merged',
  detailed_merge_status: 'not_open',
  web_url: 'https://gitlab.com/acme/platform/web/-/merge_requests/12',
  references: { full: 'acme/platform/web!12' },
};

/**
 * `glab api projects/:id/merge_requests/41/approvals`: one rule, approved.
 */
export const GITLAB_41_APPROVALS: GitlabMrApprovals = { approvals_required: 1, approvals_left: 0 };

/**
 * `gh pr view https://github.com/octo-org/docs/pull/88 --json ...`: a draft
 * with no checks and no ticket key.
 */
export const GITHUB_88_VIEW: GithubPrView = {
  baseRefName: 'main',
  body: 'Builds the docs site on every push.',
  headRefName: 'octo-user/docs-build',
  isDraft: true,
  mergeStateStatus: 'UNKNOWN',
  number: 88,
  reviewDecision: '',
  state: 'OPEN',
  statusCheckRollup: [],
  title: 'chore(ci): add a docs build workflow',
  url: 'https://github.com/octo-org/docs/pull/88',
};

/**
 * `gh auth status --json hosts --hostname github.com` on a machine logged in
 * to three accounts: the active one, an inactive one, and one whose token no
 * longer works.
 */
export const GH_AUTH_STATUS = {
  hosts: {
    'github.com': [
      {
        active: true,
        gitProtocol: 'ssh',
        host: 'github.com',
        login: 'octo-work',
        scopes: 'gist, read:org, repo, workflow',
        state: 'success',
        tokenSource: 'keyring',
      },
      {
        active: false,
        gitProtocol: 'ssh',
        host: 'github.com',
        login: 'octo-user',
        scopes: 'gist, read:org, repo, workflow',
        state: 'success',
        tokenSource: 'keyring',
      },
      {
        active: false,
        error: 'The token in keyring is invalid.',
        gitProtocol: 'https',
        host: 'github.com',
        login: 'octo-retired',
        state: 'error',
        tokenSource: 'keyring',
      },
    ],
  },
};

/**
 * `gh pr view <url> --json latestReviews`: two approvers, one commenter and
 * one reviewer asking for changes, each reviewer's latest review once.
 */
export const GITHUB_LATEST_REVIEWS: GithubReview[] = [
  { author: { login: 'reviewer-ana' }, state: 'APPROVED' },
  { author: { login: 'reviewer-ben' }, state: 'COMMENTED' },
  { author: { login: 'reviewer-cleo' }, state: 'APPROVED' },
  { author: { login: 'reviewer-dan' }, state: 'CHANGES_REQUESTED' },
];

/**
 * `glab api projects/:id/merge_requests/:iid/approvals` for a project
 * without an approval rule, approved by one user.
 */
export const GITLAB_NO_RULE_APPROVALS: GitlabMrApprovals = {
  approvals_required: 0,
  approvals_left: 0,
  approved_by: [{ user: { username: 'reviewer-ana' } }],
};

/**
 * `glab api projects/:id/merge_requests/43`: stacked on !42, CI running.
 */
export const GITLAB_MR_43: GitlabMrItem = {
  iid: 43,
  title: 'feat(SHOP-214): add jitter to the checkout backoff',
  description: '',
  source_branch: 'feature/SHOP-214-jitter',
  target_branch: 'feature/SHOP-214-backoff',
  draft: false,
  state: 'opened',
  detailed_merge_status: 'ci_still_running',
  web_url: 'https://gitlab.com/acme/platform/shop-api/-/merge_requests/43',
  references: { full: 'acme/platform/shop-api!43' },
  has_conflicts: false,
  head_pipeline: {
    status: 'running',
    web_url: 'https://gitlab.com/acme/platform/shop-api/-/pipelines/5007',
  },
};

/**
 * A list entry made from a single-MR fixture, in project 1001 unless
 * `sourceProject` names a fork.
 */
function listEntry(mr: GitlabMrItem, sourceProject = 1001): GitlabMrListEntry {
  const { head_pipeline: _pipeline, ...rest } = mr;
  return {
    ...rest,
    id: 90000 + mr.iid,
    project_id: 1001,
    source_project_id: sourceProject,
    target_project_id: 1001,
  };
}

/**
 * `glab api projects/:id/merge_requests?source_branch=feature%2FSHOP-214-checkout-retry&state=all`:
 * the open !41 and an older closed !30 from the same branch.
 */
export const GITLAB_LIST_CHECKOUT_RETRY: GitlabMrListEntry[] = [
  listEntry(GITLAB_MR_41),
  listEntry({
    ...GITLAB_MR_41,
    iid: 30,
    state: 'closed',
    title: 'feat(SHOP-214): retry checkout (first try)',
    detailed_merge_status: 'not_open',
    web_url: 'https://gitlab.com/acme/platform/shop-api/-/merge_requests/30',
    references: { full: 'acme/platform/shop-api!30' },
  }),
];

/**
 * `glab api projects/:id/merge_requests?target_branch=feature%2FSHOP-214-backoff&state=opened`:
 * !43 stacked on !42, and !44 from a fork on the same target.
 */
export const GITLAB_LIST_ON_BACKOFF: GitlabMrListEntry[] = [
  listEntry(GITLAB_MR_43),
  listEntry(
    {
      ...GITLAB_MR_43,
      iid: 44,
      title: 'feat(SHOP-214): tune the backoff from a fork',
      source_branch: 'octo-user/backoff-tune',
      web_url: 'https://gitlab.com/acme/platform/shop-api/-/merge_requests/44',
      references: { full: 'acme/platform/shop-api!44' },
    },
    2002,
  ),
];

/**
 * One `gh pr list -R github.com/acme/web --json …,isCrossRepository` entry,
 * open and keyless unless `over` says otherwise.
 */
function githubListEntry(over: Partial<GithubPrListItem> & { number: number }): GithubPrListItem {
  return {
    baseRefName: 'main',
    body: '',
    headRefName: `octo-user/change-${over.number}`,
    isCrossRepository: false,
    isDraft: false,
    latestReviews: [],
    mergeStateStatus: 'BLOCKED',
    reviewDecision: 'REVIEW_REQUIRED',
    state: 'OPEN',
    statusCheckRollup: [],
    title: `change ${over.number}`,
    url: `https://github.com/acme/web/pull/${over.number}`,
    ...over,
  };
}

/**
 * A three-PR stack in acme/web: #301 on `main`, #302 on #301's branch, #303
 * on #302's branch, plus #304 from a fork on #302's branch.
 */
export const GITHUB_STACK = {
  base: githubListEntry({
    number: 301,
    title: 'add the cart API',
    headRefName: 'octo-user/cart-api',
    mergeStateStatus: 'CLEAN',
  }),
  middle: githubListEntry({
    number: 302,
    title: 'add the cart page',
    headRefName: 'octo-user/cart-ui',
    baseRefName: 'octo-user/cart-api',
  }),
  top: githubListEntry({
    number: 303,
    title: 'test the cart page',
    headRefName: 'octo-user/cart-tests',
    baseRefName: 'octo-user/cart-ui',
    statusCheckRollup: [
      {
        status: 'IN_PROGRESS',
        conclusion: '',
        detailsUrl: 'https://github.com/acme/web/actions/runs/8/job/80',
      },
    ],
  }),
  fork: githubListEntry({
    number: 304,
    title: 'fix a typo on the cart page',
    headRefName: 'octo-user/cart-typo',
    baseRefName: 'octo-user/cart-ui',
    isCrossRepository: true,
  }),
};

/**
 * Two Bash calls of a session, each a `git push` then `glab mr create`, and
 * their result text: !42 in shop-api, then the draft !17 in web.
 */
export const SESSION_CREATE_CALLS: SessionCall[] = [
  {
    command:
      'git push -u origin HEAD 2>&1 | tail -1 && glab mr create --source-branch feature/SHOP-214-backoff --target-branch feature/SHOP-214-checkout-retry --title "feat(SHOP-214): back off between checkout retries" --yes',
    result:
      "branch 'feature/SHOP-214-backoff' set up to track 'origin/feature/SHOP-214-backoff'.\nhttps://gitlab.com/acme/platform/shop-api/-/merge_requests/42",
  },
  {
    command:
      'git push -u origin HEAD 2>&1 | tail -1 && glab mr create --draft --source-branch feature/SHOP-214-backoff --target-branch develop --title "feat(SHOP-214): show a retry notice at checkout" --yes',
    result:
      "branch 'feature/SHOP-214-backoff' set up to track 'origin/feature/SHOP-214-backoff'.\nhttps://gitlab.com/acme/platform/web/-/merge_requests/17",
  },
];
