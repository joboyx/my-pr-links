/**
 * Whether the band is hidden (`/my-pr-links` toggles it).
 */
export type BandVisibility = boolean;

/**
 * The URLs of the pull requests this session and its subagents created or
 * updated, in the order they were found.
 */
export type BandCreated = string[];

/**
 * One pull request as the band state holds it. Mirrors
 * `Pr` in `hooks/prs.ts` (the contract may not import it); tsc checks both
 * ways where the hooks module reads and writes the state.
 */
export type BandPr = {
  provider: 'gitlab' | 'github';
  repo: string;
  ref: string;
  url: string;
  title: string;
  rowTitle: string;
  sourceBranch: string;
  targetBranch: string;
  state: 'merged' | 'ready' | 'review' | 'failing' | 'running' | 'draft' | 'closed';
  ci?: 'pass' | 'fail' | 'run';
  approvals?: string;
  ticket?: string;
  stackedOn?: string;
  stackBase?: string;
  note?: string;
};

/**
 * The pull requests of one ticket key or shared branch, or the rest
 * (`other`), as one band group.
 */
export type BandGroup = {
  id: string;
  kind: 'ticket' | 'branch' | 'other';
  title?: string;
  prs: BandPr[];
};

/**
 * The last fetch the band draws, or `null` before the first one.
 */
export type BandSnapshot = { fetchedAt: number; groups: BandGroup[]; errors: string[] } | null;

declare module 'claude-code' {
  interface PluginState {
    'my-pr-links': {
      isHidden: BandVisibility;
      snapshot: Shaped<BandSnapshot>;
      created: BandCreated;
    };
  }
}
