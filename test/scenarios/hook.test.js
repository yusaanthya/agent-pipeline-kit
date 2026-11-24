// Behaviour scenarios for the PreToolUse hook, entered through `main` with the fake world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SHAS } from '../support/fake-world.js';
import { gate, hook, mergeCall, REPO, trustManifestKey } from '../support/scenario.js';

test('hook: merge call matches the merge verdict / head, method and marker line agree / allowed', async () => {
  const { code, err } = await hook(mergeCall());
  assert.equal(code, 0);
  assert.deepEqual(err, []);
});

test('hook: gate says wait:ci / the agent calls the merge tool / blocked with the verdict and first reason', async () => {
  const { code, err } = await hook(mergeCall(), { rest: { [`/repos/${REPO}/commits/${SHAS.HEAD}/check-runs?filter=all`]: { check_runs: [] } } });
  assert.equal(code, 2);
  assert.match(err.join('\n'), /wait:ci \(check-missing: check\)/);
});

test('hook: gate says merge / the call names another head, method or lacks the marker line / blocked', async () => {
  for (const [input, pattern] of [
    [{ expectedHeadSha: 'c'.repeat(40) }, /expectedHeadSha/],
    [{ merge_method: 'merge' }, /merge_method/],
    [{ commit_message: 'Auto-Merged-By: test-runner and more' }, /commit_message/],
  ]) {
    const { code, err } = await hook(mergeCall(input));
    assert.equal(code, 2);
    assert.match(err.join('\n'), pattern);
  }
});

test('hook: evaluation cannot finish / a git error or malformed input / blocked, never allowed', async () => {
  const forcePush = await hook(mergeCall(), { refs: { [`refs/agent-pipeline-kit/${process.pid}/head`]: 'd'.repeat(40) } });
  assert.equal(forcePush.code, 2);
  assert.match(forcePush.err.join('\n'), /blocked:input/);
  assert.equal((await hook(mergeCall({ pullNumber: '7' }))).code, 2);
  assert.equal((await hook('{not json')).code, 2);
});

test('hook: tool is not the merge tool / any prefix of merge_pull_request is matched by name / others allowed without evaluation', async () => {
  const other = await hook({ tool_name: 'mcp__github__get_commit', tool_input: {} });
  assert.equal(other.code, 0);
  const prefixed = await hook({ ...mergeCall(), tool_name: 'mcp__other__merge_pull_request' }, { pr: { base: { ref: 'preview' } } });
  assert.equal(prefixed.code, 2);
  assert.match(prefixed.err.join('\n'), /hold:owner \(base-mismatch/);
});

test('example settings: every gate hook blocks on failure / the auto-merge and write tools are denied', () => {
  const settings = JSON.parse(readFileSync(new URL('../../examples/settings.json', import.meta.url), 'utf8'));
  const entries = Object.values(settings.hooks).flat().flatMap((group) => group.hooks);
  assert.ok(entries.length > 0);
  for (const entry of entries) assert.equal(entry.onFailure, 'block');
  for (const tool of ['enable_pr_auto_merge', 'push_files', 'create_or_update_file', 'delete_file']) {
    assert.ok(settings.permissions.deny.includes(`mcp__github__${tool}`), tool);
  }
  assert.ok(settings.permissions.deny.includes('Bash(gh pr merge:*)'));
});

// Caller lanes selected by the pull request title prefix.
const callerLane = (prefix, marker) => ({
  kind: 'caller', base: 'main', auto_merge: true, tier: { default: 'hold', auto: ['src/**'], strong_review: [] },
  max_changed_lines: null, marker, title_prefix: prefix,
});
const prefixManifest = JSON.stringify({
  schema: 1, kit: 'a'.repeat(40), checks: ['check'], codex_clean: 'no_blocking', hold_paths: [],
  lanes: {
    runner: { kind: 'queue', base: 'main', auto_merge: true, tier: { default: 'auto', strong_review: [] }, max_changed_lines: null, marker: 'Auto-Merged-By: test-runner' },
    nightly: callerLane('chore(nightly): ', 'Auto-Merged-By: test-nightly'),
    weekly: callerLane('chore(weekly): ', 'Auto-Merged-By: test-weekly'),
  },
});
const callerWorld = (title, headRef = 'routine/tidy') => ({
  pr: { title, head: { sha: SHAS.HEAD, ref: headRef, repo: { full_name: 'owner/repo' } } },
  blobs: { [trustManifestKey]: prefixManifest },
  diffRaw: `:100644 100644 ${SHAS.S_OLD} ${SHAS.S_NEW} M\0src/x.go\0`,
  numstat: '3\t1\tsrc/x.go\0',
});
const nightlyCall = (message) => mergeCall({ commit_message: message });

test('hook: title has a caller lane prefix / the call carries that lane marker / passes to the normal verdict', async () => {
  const { code, err } = await hook(nightlyCall('Tidy.\n\nAuto-Merged-By: test-nightly'), callerWorld('chore(nightly): tidy'));
  assert.equal(code, 0);
  assert.deepEqual(err, []);
});

test('hook: title has a caller lane prefix / the call carries another lane marker / hold lane-marker-mismatch', async () => {
  const { code, err } = await hook(nightlyCall('Tidy.\n\nAuto-Merged-By: test-weekly'), callerWorld('chore(nightly): tidy'));
  assert.equal(code, 2);
  assert.match(err.join('\n'), /hold:owner \(lane-marker-mismatch/);
});

test('hook: title has a caller lane prefix / the call carries both caller lane markers / hold lane-marker-mismatch', async () => {
  const { code, err } = await hook(nightlyCall('Tidy.\n\nAuto-Merged-By: test-nightly\nAuto-Merged-By: test-weekly'), callerWorld('chore(nightly): tidy'));
  assert.equal(code, 2);
  assert.match(err.join('\n'), /hold:owner \(lane-marker-mismatch/);
});

test('hook: title has a caller lane prefix / the call carries no marker / hold lane-marker-mismatch', async () => {
  for (const message of ['Tidy.', undefined]) {
    const { code, err } = await hook(nightlyCall(message), callerWorld('chore(nightly): tidy'));
    assert.equal(code, 2);
    assert.match(err.join('\n'), /hold:owner \(lane-marker-mismatch/);
  }
});

test('hook: title matches no prefix / a caller-lane branch / hold no-lane as before', async () => {
  const { code, err } = await hook(nightlyCall('Tidy.\n\nAuto-Merged-By: test-nightly'), callerWorld('feat: tidy'));
  assert.equal(code, 2);
  assert.match(err.join('\n'), /hold:owner \(no-lane/);
});

test('hook: title starts with an owner marker / the prefix does not match / blocked, never allowed', async () => {
  const { code, err } = await hook(nightlyCall('Tidy.\n\nAuto-Merged-By: test-nightly'), callerWorld('[FAILED] chore(nightly): tidy'));
  assert.equal(code, 2);
  assert.match(err.join('\n'), /no-lane/);
});

test('hook: queue-branch pull request whose title has a caller prefix / the title is ignored / queue lane verdict', async () => {
  const over = { pr: { title: 'chore(nightly): tidy' }, blobs: { [trustManifestKey]: prefixManifest } };
  const ok = await hook(mergeCall(), over);
  assert.equal(ok.code, 0);
  const wrong = await hook(nightlyCall('Auto-Merged-By: test-nightly'), over);
  assert.equal(wrong.code, 2);
  assert.match(wrong.err.join('\n'), /commit_message must contain the line: Auto-Merged-By: test-runner/);
});

test('evaluate: caller-lane pull request with a matching title prefix / no --lane / the title does not select a lane', async () => {
  const { result } = await gate(callerWorld('chore(nightly): tidy'));
  assert.equal(result.lane, null);
  assert.ok(result.reasons.some((r) => r.code === 'no-lane'));
});
