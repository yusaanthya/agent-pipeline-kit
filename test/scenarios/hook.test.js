// Behaviour scenarios for the PreToolUse hook, entered through `main` with the fake world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BOT, codexSummary } from '../support/baseline.js';
import { SHAS } from '../support/fake-world.js';
import { codexCleanOn, gate, hook, mergeCall, REPO, trustManifestKey } from '../support/scenario.js';

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
  const { code, err } = await hook(nightlyCall('Tidy.\n\nAuto-Merged-By: test-nightly'), callerWorld('feat: chore(nightly): tidy'));
  assert.equal(code, 2);
  assert.match(err.join('\n'), /hold:owner \(no-lane/);
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

test('hook: review cap reached / the merge call is made with a clean or a P1 Codex review / decision unchanged', async () => {
  const manifest = JSON.stringify({
    schema: 1, kit: 'a'.repeat(40), checks: ['check'], codex_clean: 'no_blocking', hold_paths: [],
    lanes: { runner: { kind: 'queue', base: 'main', auto_merge: true, tier: { default: 'auto', strong_review: [] }, max_changed_lines: null, marker: 'Auto-Merged-By: test-runner', max_review_requests: 2 } },
  });
  const request = (id) => ({ id, user: { id: 1000 + id, login: 'owner' }, body: '@codex review', created_at: '2026-11-10T09:00:00Z' });
  const clean = codexCleanOn()[`/repos/${REPO}/issues/7/comments`];
  const finding = { id: 10, user: BOT, body: '**[P1] Fix this**', commit_id: SHAS.HEAD, original_commit_id: SHAS.HEAD, created_at: '2026-11-10T10:01:00Z' };
  const blobs = { [trustManifestKey]: manifest };
  const allowed = await hook(mergeCall(), { blobs, rest: { [`/repos/${REPO}/issues/7/comments`]: [...clean, request(1), request(2), request(3)] } });
  assert.equal(allowed.code, 0);
  assert.deepEqual(allowed.err, []);
  const flagged = codexSummary({ commit_sha: SHAS.HEAD, has_any_findings: true, has_unresolved_findings: true });
  const blocked = await hook(mergeCall(), {
    blobs,
    rest: { [`/repos/${REPO}/issues/7/comments`]: [flagged, request(1), request(2)], [`/repos/${REPO}/pulls/7/comments`]: [finding] },
  });
  assert.equal(blocked.code, 2);
  assert.match(blocked.err.join('\n'), /hold:owner \(review-cap: 2 >= 2\)/);
});

test('hook: fix-round cap reached / the call is made with a clean review, a failed check or an unreadable log / allowed, blocked, blocked', async () => {
  const manifest = JSON.stringify({
    schema: 1, kit: 'a'.repeat(40), checks: ['check'], codex_clean: 'no_blocking', hold_paths: [],
    lanes: { runner: { kind: 'queue', base: 'main', auto_merge: true, tier: { default: 'auto', strong_review: [] }, max_changed_lines: null, marker: 'Auto-Merged-By: test-runner', max_fix_rounds: 2 } },
  });
  const firstParentLog = 'fix: a\n\nReview-fix-round: 1\n\nfix: b\n\nReview-fix-round: 2\n';
  const base = { blobs: { [trustManifestKey]: manifest }, firstParentLog };
  const allowed = await hook(mergeCall(), base);
  assert.equal(allowed.code, 0);
  assert.deepEqual(allowed.err, []);
  const failed = { id: 1, name: 'check', app: { slug: 'github-actions' }, status: 'completed', conclusion: 'failure' };
  const capped = await hook(mergeCall(), { ...base, rest: { [`/repos/${REPO}/commits/${SHAS.HEAD}/check-runs?filter=all`]: { check_runs: [failed] } } });
  assert.equal(capped.code, 2);
  assert.match(capped.err.join('\n'), /hold:owner \(fix-round-cap: 2 >= 2\)/);
  const unreadable = await hook(mergeCall(), { ...base, firstParentLogCode: 128 });
  assert.equal(unreadable.code, 2);
  assert.match(unreadable.err.join('\n'), /collect-failed/);
});
