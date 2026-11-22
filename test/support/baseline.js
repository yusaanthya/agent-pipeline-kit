// Shared builders for tests: a baseline GateInput that yields `merge`.
// This is a helper, not a test file; it holds no assertions.

export const SHA = 'c'.repeat(40);
export const BASE_SHA = 'd'.repeat(40);
export const BOT = { id: 199175422, login: 'chatgpt-codex-connector[bot]' };

export const codexSummary = (review = {}, security, extra = {}) => ({
  id: 1,
  user: BOT,
  body: `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 ${JSON.stringify({
    code_review: { commit_sha: SHA, status: 'completed', has_any_findings: false, has_unresolved_findings: false, ...review },
    ...(security === undefined ? {} : { security_review: security }),
  })} -->`,
  created_at: '2026-11-10T10:00:00Z',
  updated_at: '2026-11-10T10:00:00Z',
  ...extra,
});

export const baselineManifest = () => ({
  schema: 1,
  kit: 'a'.repeat(40),
  checks: ['check'],
  codex_clean: 'no_blocking',
  hold_paths: [],
  lanes: {
    runner: {
      kind: 'queue',
      base: 'main',
      auto_merge: true,
      tier: { default: 'auto', strong_review: [] },
      max_changed_lines: null,
      marker: 'Auto-Merged-By: test-runner',
    },
  },
});

export const file = (path, extra = {}) => ({
  path, pathBytesOk: true, status: 'M', baseMode: '100644', headMode: '100644', headHasNul: false, added: 1, deleted: 0, ...extra,
});

export const addedFile = (path, extra = {}) => file(path, { status: 'A', baseMode: null, ...extra });

export const checkRun = (extra = {}) => ({
  id: 100,
  name: 'check',
  app: { slug: 'github-actions' },
  status: 'completed',
  conclusion: 'success',
  started_at: '2026-11-10T09:00:00Z',
  completed_at: '2026-11-10T09:05:00Z',
  ...extra,
});

export function baseline() {
  return {
    schema: 1,
    repo: 'owner/repo',
    manifestText: JSON.stringify(baselineManifest()),
    callerLane: null,
    asOf: null,
    pr: {
      number: 7,
      state: 'open',
      merged: false,
      draft: false,
      title: 'feat: add x',
      headRepo: 'owner/repo',
      headRef: 'claude/item-sim-1',
      headSha: SHA,
      baseRef: 'main',
      mergeable: true,
    },
    files: [
      file('src/x.go', { added: 3, deleted: 1 }),
      addedFile('.agent-line/reports/sim-1.md', { added: 10 }),
    ],
    baseSha: BASE_SHA,
    baseIsAncestor: true,
    queueItemText: '---\nid: sim-1\nmerge: runner\n---\n',
    checkRuns: [checkRun()],
    codex: { comments: [codexSummary()], reviewComments: [], reviews: [] },
    haltIssues: [],
    pulls: [],
    mergeMessage: null,
    mergeCommit: null,
    limits: [],
  };
}

/** Edits the manifest of an input in place and writes it back as text. */
export function editManifest(input, fn) {
  const manifest = JSON.parse(input.manifestText);
  fn(manifest);
  input.manifestText = JSON.stringify(manifest);
  return input;
}

/** A manifest with the queue lane `runner` and a caller lane `nightly`. */
export function withCaller(input, laneExtra = {}) {
  return editManifest(input, (m) => {
    m.lanes.nightly = {
      kind: 'caller',
      base: 'main',
      auto_merge: true,
      tier: { default: 'auto', strong_review: [] },
      max_changed_lines: null,
      marker: 'Auto-Merged-By: test-nightly',
      ...laneExtra,
    };
  });
}

/** Turns a baseline into a caller-lane pull request. */
export function asCaller(input, laneExtra = {}) {
  withCaller(input, laneExtra);
  input.callerLane = 'nightly';
  input.pr.headRef = 'feature/x';
  input.files = [file('src/x.go', { added: 3, deleted: 1 })];
  delete input.queueItemText;
  return input;
}

export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}
