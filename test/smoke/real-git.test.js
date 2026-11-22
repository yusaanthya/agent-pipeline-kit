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
