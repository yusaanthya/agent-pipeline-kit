// Behaviour scenarios for `check-paths`: one situation each, entered only through
// `main(argv, overrides)` with the fake world. Each asserts the result, the exit
// code and the reason codes, never an internal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../src/cli.js';
import { SHAS } from '../support/fake-world.js';
import { checkPaths, evaluateArgv, gate, REPO, trustManifestKey } from '../support/scenario.js';

const ZERO = '0'.repeat(40);
const codes = (result) => result.reasons.map((r) => r.code);
const entry = (path) => (path.startsWith('.agent-line/reports/')
  ? `:000000 100644 ${ZERO} ${SHAS.S_NEW} A\0${path}\0`
  : `:100644 100644 ${SHAS.S_OLD} ${SHAS.S_NEW} M\0${path}\0`);

const lane = (extra) => ({ base: 'main', auto_merge: true, marker: 'Auto-Merged-By: x', max_changed_lines: null, ...extra });
const manifest = JSON.stringify({
  schema: 1, kit: 'a'.repeat(40), checks: ['check'], codex_clean: 'no_blocking', hold_paths: ['vendor/**'],
  lanes: {
    runner: lane({ kind: 'queue', tier: { default: 'auto', strong_review: [] } }),
    nightly: lane({ kind: 'caller', tier: { default: 'hold', auto: ['src/**', 'docs/**'], strong_review: ['src/core/**'] } }),
  },
  content_rules: { hold_on_line_change: [{ glob: 'docs/**', pattern: '^Status:' }] },
});

// A fake world whose diff changes each path by one line, under this manifest.
const world = (paths, blobs = {}) => ({
  // latin1, so that '\xe9' is one byte that is not valid UTF-8
  diffRaw: Buffer.from(paths.map(entry).join(''), 'latin1'),
  numstat: Buffer.from(paths.map((p) => `1\t0\t${p}\0`).join(''), 'latin1'),
  blobs: { [trustManifestKey]: manifest, ...blobs },
});

test('change inside the allowlist / lane given / clear, with the base and merge base', async () => {
  const { code, result } = await checkPaths(world(['src/x.go', 'docs/a.md']), ['--lane', 'nightly']);
  assert.equal(result.result, 'clear');
  assert.equal(code, 0);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.lane, 'nightly');
  assert.deepEqual(result.base, { ref: 'main', sha: SHAS.BASE });
  assert.equal(result.mergeBase, SHAS.MB);
  assert.equal(result.head, SHAS.HEAD);
});

test('change to a CI workflow / no lane given / hold:owner on the floor path', async () => {
  const { code, result } = await checkPaths(world(['.github/workflows/ci.yml']));
  assert.equal(result.result, 'hold:owner');
  assert.equal(code, 1);
  assert.deepEqual(codes(result), ['floor']);
  assert.equal(result.lane, null);
});

test('path that is not valid UTF-8 / lane allows its directory / blocked:input, not clear', async () => {
  const { code, result } = await checkPaths(world(['docs/caf\xe9.md']), ['--lane', 'nightly']);
  assert.equal(result.result, 'blocked:input');
  assert.equal(code, 1);
  assert.deepEqual(codes(result), ['path-encoding']);
});

test('change outside the allowlist / with and without a lane / hold:owner only with the lane', async () => {
  const withLane = await checkPaths(world(['scripts/run.sh']), ['--lane', 'nightly']);
  assert.equal(withLane.result.result, 'hold:owner');
  assert.equal(withLane.code, 1);
  assert.deepEqual(codes(withLane.result), ['not-in-allowlist']);
  const without = await checkPaths(world(['scripts/run.sh']));
  assert.equal(without.result.result, 'clear');
  assert.equal(without.code, 0);
});

test('change in a strong-review path / lane given / hold:strong-review', async () => {
  const { code, result } = await checkPaths(world(['src/core/x.js']), ['--lane', 'nightly']);
  assert.equal(result.result, 'hold:strong-review');
  assert.equal(code, 1);
  assert.deepEqual(codes(result), ['strong-review-path']);
});

test('content rule on a status line / the change edits that line / hold:owner', async () => {
  const blobs = { [SHAS.S_OLD]: 'Status: open\n', [SHAS.S_NEW]: 'Status: done\n' };
  const { code, result } = await checkPaths(world(['docs/plan.md'], blobs), ['--lane', 'nightly']);
  assert.equal(result.result, 'hold:owner');
  assert.equal(code, 1);
  assert.deepEqual(codes(result), ['rule-line-change']);
});

test('lane the manifest does not define / any change / blocked:lane, never clear', async () => {
  const { code, result } = await checkPaths(world(['src/x.go']), ['--lane', 'ghost']);
  assert.equal(result.result, 'blocked:lane');
  assert.equal(code, 1);
  assert.deepEqual(codes(result), ['unknown-lane']);
});

test('item report in the diff / with and without --item / clear only for the named item', async () => {
  const report = world(['.agent-line/reports/sim-1.md']);
  const own = await checkPaths(report, ['--lane', 'runner', '--item', 'sim-1']);
  assert.equal(own.result.result, 'clear');
  assert.equal(own.code, 0);
  const noItem = await checkPaths(report, ['--lane', 'runner']);
  assert.equal(noItem.result.result, 'hold:owner');
  assert.equal(noItem.code, 1);
  assert.deepEqual(codes(noItem.result), ['floor']);
});

test('queue lane without --item / a report named null.md / held, not exempt', async () => {
  const { code, result } = await checkPaths(world(['.agent-line/reports/null.md']), ['--lane', 'runner']);
  assert.equal(result.result, 'hold:owner');
  assert.equal(code, 1);
  assert.deepEqual(codes(result), ['floor']);
});

test('head is the merge base / nothing differs / blocked:empty-diff', async () => {
  const { code, result } = await checkPaths(world([]), ['--lane', 'nightly']);
  assert.equal(result.result, 'blocked:empty-diff');
  assert.equal(code, 1);
  assert.deepEqual(codes(result), ['empty-diff']);
});

test('head commit missing from the clone / any change / blocked:input, not an empty result', async () => {
  const { code, result } = await checkPaths({ ...world(['src/x.go']), refs: { [SHAS.HEAD]: undefined } });
  assert.equal(result.result, 'blocked:input');
  assert.equal(code, 1);
  assert.deepEqual(codes(result), ['collect-failed']);
});

test('malformed or inconsistent options / any invocation / usage error, exit 2, no result', async () => {
  const required = ['--repo', REPO, '--repo-dir', '/work/clone', '--base', 'main', '--head', SHAS.HEAD];
  const cases = [
    [...required, '--item', 'sim-1'], // --item without --lane
    [...required, '--lane', 'runner', '--item', 'Sim_1'],
    required.map((v) => (v === SHAS.HEAD ? 'abc123' : v)),
    required.map((v) => (v === 'main' ? '../x' : v)),
    required.slice(0, 6), // no --head
  ];
  for (const argv of cases) {
    const out = [];
    const err = [];
    const code = await main(['check-paths', ...argv], { out: (line) => out.push(line), err: (line) => err.push(line) });
    assert.equal(code, 2, argv.join(' '));
    assert.deepEqual(out, []);
    assert.ok(err.length > 0);
  }
  // A caller lane has no item reports; the manifest is needed to know that.
  const caller = await checkPaths(world(['src/x.go']), ['--lane', 'nightly', '--item', 'sim-1']);
  assert.equal(caller.code, 2);
  assert.deepEqual(caller.out, []);
});

test('agreement / the same change set through check-paths and evaluate / the same change-set reasons', async () => {
  const blobs = { [SHAS.S_OLD]: 'Status: open\n', [SHAS.S_NEW]: 'Status: done\n' };
  const sets = [
    ['src/x.go'],
    ['vendor/x.js'],
    ['docs/caf\xe9.md'],
    ['src/core/a.js', '.github/workflows/ci.yml', 'docs/plan.md', 'scripts/run.sh'],
  ];
  const pr = { head: { sha: SHAS.HEAD, ref: 'feature/x', repo: { full_name: REPO } } };
  const seen = new Set();
  for (const paths of sets) {
    const over = world(paths, blobs);
    const evaluated = await gate({ ...over, pr }, [...evaluateArgv, '--lane', 'nightly']);
    const checked = await checkPaths(over, ['--lane', 'nightly']);
    assert.deepEqual(checked.result.reasons, evaluated.result.reasons, paths.join(' '));
    assert.equal(checked.result.result === 'clear', evaluated.result.verdict === 'merge');
    seen.add(checked.result.result);
  }
  assert.deepEqual([...seen].sort(), ['blocked:input', 'clear', 'hold:owner']);
});

// The sections_only rule, through the content blobs the collector fetches.
const sectionsManifest = JSON.stringify({
  ...JSON.parse(manifest),
  content_rules: { sections_only: [{ glob: 'docs/backlog.md', sections: ['## Ready'] }] },
});
const sectionsWorld = (paths, blobs) => ({ ...world(paths, blobs), blobs: { [trustManifestKey]: sectionsManifest, ...blobs } });
const backlogOld = 'Intro\n\n## Ready\nr1\n\n## Decisions\nd1\n';

test('sections_only / only the body of a listed section changes / clear', async () => {
  const blobs = { [SHAS.S_OLD]: backlogOld, [SHAS.S_NEW]: backlogOld.replace('r1', 'r2') };
  const { code, result } = await checkPaths(sectionsWorld(['docs/backlog.md'], blobs), ['--lane', 'nightly']);
  assert.equal(result.result, 'clear');
  assert.equal(code, 0);
  assert.deepEqual(result.reasons, []);
});

test('sections_only / the body of an unlisted section changes / hold:owner naming the rule and the path', async () => {
  const blobs = { [SHAS.S_OLD]: backlogOld, [SHAS.S_NEW]: backlogOld.replace('d1', 'd2') };
  const { code, result } = await checkPaths(sectionsWorld(['docs/backlog.md'], blobs), ['--lane', 'nightly']);
  assert.equal(result.result, 'hold:owner');
  assert.equal(code, 1);
  assert.deepEqual(result.reasons.map((r) => [r.code, r.detail]), [['rule-sections', 'docs/backlog.md: section-changed']]);
});

test('sections_only / a carriage return in the head / hold:owner as unreadable', async () => {
  const blobs = { [SHAS.S_OLD]: backlogOld, [SHAS.S_NEW]: backlogOld.replace('r1', 'r2\r') };
  const { code, result } = await checkPaths(sectionsWorld(['docs/backlog.md'], blobs), ['--lane', 'nightly']);
  assert.equal(result.result, 'hold:owner');
  assert.equal(code, 1);
  assert.deepEqual(result.reasons.map((r) => [r.code, r.detail]), [['rule-sections', 'docs/backlog.md: unreadable']]);
});

test('sections_only / a path the rule does not match / no blob is needed and the result is clear', async () => {
  const { code, result } = await checkPaths(sectionsWorld(['docs/other.md'], {}), ['--lane', 'nightly']);
  assert.equal(result.result, 'clear');
  assert.equal(code, 0);
});

test('max_review_requests / zero, negative, fractional or string on a lane / blocked:manifest', async () => {
  for (const bad of [0, -1, 1.5, '5']) {
    const bounded = JSON.stringify({ ...JSON.parse(manifest), lanes: { nightly: { ...JSON.parse(manifest).lanes.nightly, max_review_requests: bad } } });
    const { code, result } = await checkPaths({ ...world(['src/x.go']), blobs: { [trustManifestKey]: bounded } }, ['--lane', 'nightly']);
    assert.equal(result.result, 'blocked:manifest', JSON.stringify(bad));
    assert.equal(code, 1);
    assert.deepEqual(codes(result), ['manifest-invalid']);
  }
});
