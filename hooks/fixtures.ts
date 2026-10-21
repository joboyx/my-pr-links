/**
 * `glab`, `gh` and session tool-call output in the shape the real CLIs
 * print, on made-up projects, shared by the tests. Test-only: the hooks
 * module never imports this file.
 */

import type {
  GithubPrView,
  GithubReview,
  GitlabMrApprovals,
  GitlabMrItem,
} from './prs';

/**
 * One Bash call of a session and the result text the model read.
 */
export type SessionCall = { command: string; result: string };

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
  head_pipeline: { status: 'success' },
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
