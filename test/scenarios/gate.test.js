// Behaviour scenarios: one real situation each, entered only through
// `main(argv, overrides)` with the fake world. Each asserts the verdict, the
// exit code and the reason codes, never an internal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHAS } from '../support/fake-world.js';
import { codexCleanOn, gate, REPO, trustManifestKey } from '../support/scenario.js';

const ZERO = '0'.repeat(40);
const rawEntry = (meta, path) => `${meta}\0${path}\0`;
const codes = (result) => result.reasons.map((r) => r.code);
const REPORT = rawEntry(`:000000 100644 ${ZERO} ${SHAS.S_NEW} A`, '.agent-line/reports/sim-1.md');
const REPORT_STAT = '10\t0\t.agent-line/reports/sim-1.md\0';

test('clean runner pull request / checks pass and Codex reviewed the head / merge', async () => {
  const { code, result } = await gate();
  assert.equal(result.verdict, 'merge');
  assert.equal(code, 0);
  assert.deepEqual(result.reasons, []);
  assert.deepEqual(result.merge, { method: 'squash', expectedHeadSha: SHAS.HEAD, commitMessage: 'Auto-Merged-By: test-runner' });
});

test('agent edits a CI workflow / owner-only path in the diff / hold:owner', async () => {
  const { code, result } = await gate({
    diffRaw: rawEntry(`:100644 100644 ${SHAS.S_OLD} ${SHAS.S_NEW} M`, '.github/workflows/ci.yml') + REPORT,
    numstat: `3\t1\t.github/workflows/ci.yml\0${REPORT_STAT}`,
  });
  assert.equal(result.verdict, 'hold:owner');
  assert.equal(code, 1);
  assert.deepEqual(codes(result), ['floor']);
  assert.equal(result.merge, null);
});

test('required check has no run yet / the head has been pushed / wait:ci', async () => {
  const { code, result } = await gate({ rest: { [`/repos/${REPO}/commits/${SHAS.HEAD}/check-runs?filter=all`]: { check_runs: [] } } });
  assert.equal(result.verdict, 'wait:ci');
  assert.equal(code, 1);
  assert.deepEqual(codes(result), ['check-missing']);
});

test('Codex reviewed an earlier commit / the head moved on / wait:codex', async () => {
  const { code, result } = await gate({ rest: codexCleanOn('c'.repeat(40)) });
  assert.equal(result.verdict, 'wait:codex');
  assert.equal(code, 1);
  assert.deepEqual(codes(result), ['stale-review']);
});

test('pull request from a fork / head repository differs from the repository / hold:owner', async () => {
  const { code, result } = await gate({ pr: { head: { sha: SHAS.HEAD, ref: 'claude/item-sim-1', repo: { full_name: 'someone/repo' } } } });
  assert.equal(result.verdict, 'hold:owner');
  assert.equal(code, 1);
  assert.deepEqual(codes(result), ['fork']);
});

test('pull request targets another branch / the lane merges into main / hold:owner', async () => {
  const { code, result } = await gate({ pr: { base: { ref: 'preview' } } });
  assert.equal(result.verdict, 'hold:owner');
  assert.equal(code, 1);
  assert.deepEqual(codes(result), ['base-mismatch']);
});

test('manifest on the default branch is not valid JSON / any pull request / blocked:manifest', async () => {
  const { code, result } = await gate({ blobs: { [trustManifestKey]: '{not json' } });
  assert.equal(result.verdict, 'blocked:manifest');
  assert.equal(code, 1);
  assert.deepEqual(codes(result), ['manifest-json']);
  assert.equal(result.merge, null);
});

test('content rule on a status line / the pull request changes that line / hold:owner', async () => {
  const OLD = '1'.repeat(40);
  const NEW = '2'.repeat(40);
  const manifest = JSON.stringify({
    schema: 1, kit: 'a'.repeat(40), checks: ['check'], codex_clean: 'no_blocking', hold_paths: [],
    lanes: { runner: { kind: 'queue', base: 'main', auto_merge: true, tier: { default: 'auto', strong_review: [] }, max_changed_lines: null, marker: 'Auto-Merged-By: test-runner' } },
    content_rules: { hold_on_line_change: [{ glob: 'docs/**', pattern: '^Status:' }] },
  });
  const { code, result } = await gate({
    diffRaw: rawEntry(`:100644 100644 ${OLD} ${NEW} M`, 'docs/plan.md') + REPORT,
    numstat: `1\t1\tdocs/plan.md\0${REPORT_STAT}`,
    blobs: { [trustManifestKey]: manifest, [OLD]: 'Status: open\n', [NEW]: 'Status: done\n' },
  });
  assert.equal(result.verdict, 'hold:owner');
  assert.equal(code, 1);
  assert.deepEqual(codes(result), ['rule-line-change']);
});

test('force-push after the API read / fetched head differs from the API head / blocked:input', async () => {
  const { code, result } = await gate({ refs: { [`refs/agent-pipeline-kit/${process.pid}/head`]: 'd'.repeat(40) } });
  assert.equal(result.verdict, 'blocked:input');
  assert.equal(code, 1);
  assert.deepEqual(codes(result), ['collect-failed']);
  assert.equal(result.merge, null);
});

test('promotion pull request is open / a runner pull request is otherwise clean / wait:freeze', async () => {
  const promotion = { number: 9, head: { ref: 'preview', repo: { full_name: REPO } }, base: { ref: 'main' }, created_at: '2026-11-01T00:00:00Z', closed_at: null };
  const { code, result } = await gate({ rest: { [`/repos/${REPO}/pulls?state=open`]: [promotion] } });
  assert.equal(result.verdict, 'wait:freeze');
  assert.equal(code, 1);
  assert.deepEqual(codes(result), ['promotion-open']);
});
