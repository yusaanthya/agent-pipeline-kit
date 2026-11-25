// Smoke test against real git: a temporary clone with a local bare repository
// as `origin` (no network). `main(argv, { run })` sends `git` to the real
// `run` of src/collect/proc.js and answers `gh` from canned data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { main } from '../../src/cli.js';
import { run as realRun } from '../../src/collect/proc.js';
import { checkRun, codexSummary } from '../support/baseline.js';

const identity = {
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
};

// The production `run` spawns git with `process.env`, so the fixture isolates
// itself by replacing every caller GIT_* variable (GIT_DIR, GIT_INDEX_FILE,
// GIT_WORK_TREE, GIT_CONFIG_*, ...) in `process.env` for the whole file and
// restoring them afterwards.
let saved;
let root;
let work;
const sh = (...args) => execFileSync('git', args, { cwd: work, encoding: 'utf8' }).trim();
const put = (path, text) => {
  mkdirSync(dirname(join(work, path)), { recursive: true });
  writeFileSync(join(work, path), text);
};

// The default branch `trunk` holds the manifest the gate must trust. It holds
// `src/**` for the owner; the manifest on `main`, the lane base, does not.
const manifest = (holdPaths) => JSON.stringify({
  schema: 1, kit: 'a'.repeat(40), checks: ['test'], codex_clean: 'no_blocking', hold_paths: holdPaths,
  lanes: {
    nightly: {
      kind: 'caller', base: 'main', auto_merge: true,
      tier: { default: 'hold', auto: ['src/**', 'docs/**'], strong_review: [] },
      max_changed_lines: null, marker: 'Auto-Merged-By: nightly',
    },
  },
});

before(() => {
  saved = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('GIT_')));
  for (const k of Object.keys(saved)) delete process.env[k];
  Object.assign(process.env, identity);
  root = mkdtempSync(join(tmpdir(), 'kit-smoke-'));
  work = join(root, 'work');
  const origin = join(root, 'origin.git');
  mkdirSync(origin);
  execFileSync('git', ['init', '--bare', '-q', '-b', 'main'], { cwd: origin });
  mkdirSync(work);
  sh('init', '-q', '-b', 'main');
  sh('remote', 'add', 'origin', origin);
  put('.agent-line/manifest.json', manifest([]));
  put('.github/workflows/ci.yml', 'name: ci\non: push\njobs: {}\n');
  put('src/a.js', 'export const a = 1;\n');
  put('docs/a.md', 'a\n');
  sh('add', '-A');
  sh('commit', '-q', '-m', 'base');
  sh('push', '-q', 'origin', 'main');
  sh('checkout', '-q', '-b', 'trunk');
  put('.agent-line/manifest.json', manifest(['src/**']));
  sh('commit', '-q', '-am', 'trunk manifest');
  sh('push', '-q', 'origin', 'trunk');
});

after(() => {
  for (const k of Object.keys(process.env)) if (k.startsWith('GIT_')) delete process.env[k];
  Object.assign(process.env, saved);
  rmSync(root, { recursive: true, force: true });
});

// Pushes a pull request head built from `main` and returns the gate's answer.
async function evaluatePullRequest(change) {
  sh('checkout', '-q', 'main');
  sh('checkout', '-q', '-B', 'feature/x');
  change();
  sh('add', '-A');
  sh('commit', '-q', '-m', 'change');
  const head = sh('rev-parse', 'HEAD');
  sh('push', '-q', '-f', 'origin', 'feature/x:refs/pull/7/head');
  const rest = {
    '/repos/owner/repo': { default_branch: 'trunk' },
    '/repos/owner/repo/pulls/7': {
      number: 7, state: 'open', merged: false, draft: false, title: 'feat: x', mergeable: true,
      head: { sha: head, ref: 'feature/x', repo: { full_name: 'owner/repo' } }, base: { ref: 'main' },
    },
    [`/repos/owner/repo/commits/${head}/check-runs?filter=all`]: { check_runs: [checkRun({ name: 'test' })] },
    '/repos/owner/repo/issues/7/comments': [codexSummary({ commit_sha: head })],
    '/repos/owner/repo/pulls/7/comments': [],
    '/repos/owner/repo/pulls/7/reviews': [],
    '/repos/owner/repo/issues?labels=pipeline-halt&state=open': [],
    '/repos/owner/repo/pulls?state=open': [],
  };
  const run = async (cmd, args, options) => {
    if (cmd === 'git') return realRun(cmd, args, options);
    const path = args[args.length - 1].replace(/[?&]per_page=100&page=1$/, '');
    assert.ok(Object.hasOwn(rest, path), `no canned reply for ${path}`);
    return { stdout: Buffer.from(JSON.stringify(rest[path])), stderr: Buffer.alloc(0), code: 0 };
  };
  const out = [];
  const argv = ['evaluate', '--repo', 'owner/repo', '--pr', '7', '--repo-dir', work, '--lane', 'nightly'];
  const code = await main(argv, { run, out: (line) => out.push(line), err: () => {} });
  const result = JSON.parse(out[0]);
  return { code, result, codes: result.reasons.map((r) => r.code), head };
}

test('real git: a change in an allowed path / the default branch agrees / merge', async () => {
  const { code, result, head } = await evaluatePullRequest(() => put('docs/a.md', 'b\n'));
  assert.equal(result.verdict, 'merge');
  assert.equal(code, 0);
  assert.equal(result.merge.expectedHeadSha, head);
});

test('real git: default branch trunk differs from lane base main / the manifest on trunk holds src / hold:owner from trunk, not main', async () => {
  const { code, result, codes } = await evaluatePullRequest(() => put('src/a.js', 'export const a = 2;\n'));
  assert.equal(result.verdict, 'hold:owner');
  assert.equal(code, 1);
  assert.deepEqual(codes, ['hold-path']);
});

test('real git: CI workflow renamed out of .github / the old path is deleted / hold:owner on the protected file', async () => {
  const { code, result } = await evaluatePullRequest(() => sh('mv', '.github/workflows/ci.yml', 'docs/ci.yml'));
  assert.equal(result.verdict, 'hold:owner');
  assert.equal(code, 1);
  assert.ok(result.reasons.some((r) => r.code === 'floor' && r.detail === '.github/workflows/ci.yml'), JSON.stringify(result.reasons));
});

// A commit that exists only in the clone, on a local branch that is never pushed.
async function checkUnpushedCommit(change, base) {
  sh('checkout', '-q', 'main');
  sh('checkout', '-q', '-B', 'local/x');
  change();
  sh('add', '-A');
  sh('commit', '-q', '-m', 'unpushed');
  const head = sh('rev-parse', 'HEAD');
  const run = async (cmd, args, options) => {
    if (cmd === 'git') return realRun(cmd, args, options);
    assert.equal(args[args.length - 1], '/repos/owner/repo');
    return { stdout: Buffer.from(JSON.stringify({ default_branch: 'trunk' })), stderr: Buffer.alloc(0), code: 0 };
  };
  const out = [];
  const argv = ['check-paths', '--repo', 'owner/repo', '--repo-dir', work, '--base', base, '--head', head, '--lane', 'nightly'];
  const code = await main(argv, { run, out: (line) => out.push(line), err: () => {} });
  const result = JSON.parse(out[0]);
  return { code, result, codes: result.reasons.map((r) => r.code), head };
}

test('real git: unpushed commit checked against a base ahead of its merge base / an allowed path, then a path the default branch holds / clear, then hold:owner from trunk', async () => {
  // `stable` is one commit ahead of `main`, where the head forks, and is neither `main` nor the default branch.
  sh('checkout', '-q', 'main');
  sh('checkout', '-q', '-B', 'stable');
  put('docs/stable.md', 's\n');
  sh('add', '-A');
  sh('commit', '-q', '-m', 'stable');
  sh('push', '-q', '-f', 'origin', 'stable');
  const stableTip = sh('rev-parse', 'stable');
  const forkPoint = sh('rev-parse', 'main');
  const allowed = await checkUnpushedCommit(() => put('docs/a.md', 'c\n'), 'stable');
  assert.equal(allowed.result.result, 'clear');
  assert.equal(allowed.code, 0);
  assert.equal(allowed.result.head, allowed.head);
  assert.deepEqual(allowed.result.base, { ref: 'stable', sha: stableTip });
  assert.equal(allowed.result.mergeBase, forkPoint);
  const held = await checkUnpushedCommit(() => put('src/a.js', 'export const a = 3;\n'), 'stable');
  assert.equal(held.result.result, 'hold:owner');
  assert.equal(held.code, 1);
  assert.deepEqual(held.codes, ['hold-path']);
  assert.equal(sh('for-each-ref', 'refs/agent-pipeline-kit'), '');
});

// Fix rounds counted by real git. The pull request head holds a fix commit with a
// trailer, a merge of a side branch (not reachable from the base) whose commit
// also carries a trailer, and a commit that mentions the trailer after other text.
// Only `--first-parent` and a match at the start of a line give the count 1.
// The branch `fixbase` is the lane base; the squash-merge commit lands on it last.
let fixRounds;
function buildFixRounds() {
  fixRounds ??= (() => {
    const itemPath = '.agent-line/queue/sim-1.md';
    sh('checkout', '-q', 'main');
    sh('checkout', '-q', '-B', 'fixbase');
    put(itemPath, '---\nmerge: runner\n---\n');
    sh('add', '-A');
    sh('commit', '-q', '-m', 'queue item');
    sh('push', '-q', '-f', 'origin', 'fixbase');
    sh('checkout', '-q', '-B', 'claude/item-sim-1');
    put('docs/fix.md', 'fix\n');
    sh('add', '-A');
    sh('commit', '-q', '-m', 'fix: address review\n\nReview-fix-round: 1');
    sh('checkout', '-q', '-B', 'side', 'fixbase');
    put('docs/side.md', 'side\n');
    sh('add', '-A');
    sh('commit', '-q', '-m', 'fix: side work\n\nReview-fix-round: 2');
    sh('checkout', '-q', 'claude/item-sim-1');
    sh('merge', '-q', '--no-ff', '-m', 'Merge side', 'side');
    put('docs/note.md', 'note\n');
    sh('add', '-A');
    sh('commit', '-q', '-m', 'chore: tidy\n\nthis one is not a fix, see Review-fix-round: 3 above');
    const head = sh('rev-parse', 'HEAD');
    sh('push', '-q', '-f', 'origin', 'claude/item-sim-1:refs/pull/7/head');
    return { head, mergeCommit: null };
  })();
  return fixRounds;
}

// Writes a manifest whose runner lane sets the cap and returns its path.
function capFile(cap) {
  const parsed = JSON.parse(manifest([]));
  parsed.lanes = {
    runner: {
      kind: 'queue', base: 'fixbase', auto_merge: true, tier: { default: 'auto', strong_review: [] },
      max_changed_lines: null, marker: 'Auto-Merged-By: runner', max_fix_rounds: cap,
    },
  };
  const file = join(root, `cap-${cap}.json`);
  writeFileSync(file, JSON.stringify(parsed));
  return file;
}

// Runs `evaluate` or `replay` for pull request 7 with a failed required check.
async function fixRoundCodes(command, cap, { head, mergeCommit }) {
  const rest = {
    '/repos/owner/repo': { default_branch: 'trunk' },
    '/repos/owner/repo/pulls/7': {
      number: 7, state: command === 'replay' ? 'closed' : 'open', merged: command === 'replay', draft: false, title: 'feat: x', mergeable: true,
      merged_at: command === 'replay' ? '2026-11-10T12:00:00Z' : null, merge_commit_sha: mergeCommit,
      head: { sha: head, ref: 'claude/item-sim-1', repo: { full_name: 'owner/repo' } }, base: { ref: 'fixbase' },
    },
    [`/repos/owner/repo/commits/${head}/check-runs?filter=all`]: { check_runs: [checkRun({ name: 'test', conclusion: 'failure' })] },
    '/repos/owner/repo/issues/7/comments': [codexSummary({ commit_sha: head })],
    '/repos/owner/repo/pulls/7/comments': [],
    '/repos/owner/repo/pulls/7/reviews': [],
    '/repos/owner/repo/issues?labels=pipeline-halt&state=open': [],
    '/repos/owner/repo/issues?labels=pipeline-halt&state=all': [],
    '/repos/owner/repo/issues/7/timeline': [],
    '/repos/owner/repo/pulls?state=open': [],
  };
  const run = async (cmd, args, options) => {
    if (cmd === 'git') return realRun(cmd, args, options);
    const path = args[args.length - 1].replace(/[?&]per_page=100&page=1$/, '');
    assert.ok(Object.hasOwn(rest, path), `no canned reply for ${path}`);
    return { stdout: Buffer.from(JSON.stringify(rest[path])), stderr: Buffer.alloc(0), code: 0 };
  };
  const out = [];
  const argv = [command, '--repo', 'owner/repo', '--pr', '7', '--repo-dir', work, '--manifest', capFile(cap)];
  await main(argv, { run, out: (line) => out.push(line), err: () => {} });
  return JSON.parse(out[0]).reasons;
}

test('real git: a fix commit, a merged side branch and a mention after other text / evaluate / only the first-parent trailer counts', async () => {
  const pull = buildFixRounds();
  const capped = await fixRoundCodes('evaluate', 1, pull);
  assert.deepEqual(capped.map((r) => r.code), ['fix-round-cap', 'check-failed']);
  assert.equal(capped[0].detail, '1 >= 1');
  assert.deepEqual((await fixRoundCodes('evaluate', 2, pull)).map((r) => r.code), ['check-failed']);
});

test('real git: the same pull request squash-merged into its base / replay / only the first-parent trailer counts', async () => {
  const pull = buildFixRounds();
  sh('checkout', '-q', 'fixbase');
  sh('merge', '-q', '--squash', 'claude/item-sim-1');
  sh('commit', '-q', '-m', 'feat: x (#7)\n\nAuto-Merged-By: runner');
  sh('push', '-q', 'origin', 'fixbase');
  const merged = { ...pull, mergeCommit: sh('rev-parse', 'HEAD') };
  const capped = await fixRoundCodes('replay', 1, merged);
  assert.deepEqual(capped.map((r) => r.code), ['fix-round-cap', 'check-failed']);
  assert.equal(capped[0].detail, '1 >= 1');
  assert.deepEqual((await fixRoundCodes('replay', 2, merged)).map((r) => r.code), ['check-failed']);
});
