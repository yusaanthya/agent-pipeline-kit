// Behaviour scenarios for the PreToolUse hook, entered through `main` with the fake world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SHAS } from '../support/fake-world.js';
import { hook, mergeCall, REPO } from '../support/scenario.js';

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
