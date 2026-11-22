import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collect } from '../../src/collect/collect.js';
import { evaluate } from '../../src/core/verdict.js';
import { makeWorld, SHAS } from '../support/fake-world.js';

const opts = (extra = {}) => ({ repo: 'owner/repo', prNumber: 7, repoDir: '/work/clone', ...extra });
const deps = (world, extra = {}) => ({ run: world.run, readFile: async () => { throw new Error('no file'); }, pid: 4242, ...extra });
const gitCalls = (world) => world.calls.filter((c) => c.cmd === 'git');
const ghPaths = (world) => world.calls.filter((c) => c.cmd === 'gh').map((c) => c.args[c.args.length - 1]);

test('live: builds a GateInput that the core evaluates to merge', async () => {
  const world = makeWorld();
  const input = await collect(opts(), deps(world));
  assert.equal(input.schema, 1);
  assert.equal(input.repo, 'owner/repo');
  assert.equal(input.asOf, null);
  assert.equal(input.callerLane, null);
  assert.deepEqual(input.pr, {
    number: 7, state: 'open', merged: false, draft: false, title: 'feat: add x',
    headRepo: 'owner/repo', headRef: 'claude/item-sim-1', headSha: SHAS.HEAD, baseRef: 'main', mergeable: true,
  });
  assert.equal(input.baseSha, SHAS.BASE);
  assert.equal(input.baseIsAncestor, true);
  assert.equal(input.queueItemText, '---\nmerge: runner\n---\n');
  assert.deepEqual(input.files, [
    { path: 'src/x.go', pathBytesOk: true, status: 'M', baseMode: '100644', headMode: '100644', headHasNul: false, added: 3, deleted: 1 },
    { path: '.agent-line/reports/sim-1.md', pathBytesOk: true, status: 'A', baseMode: null, headMode: '100644', headHasNul: false, added: 10, deleted: 0 },
  ]);
  assert.deepEqual(input.limits, []);
  assert.equal(input.mergeMessage, null);
  assert.deepEqual(input.haltIssues, []);
  assert.deepEqual(input.pulls, [{ number: 9, headRef: 'preview', headRepo: 'owner/repo', baseRef: 'main', createdAt: '2026-11-01T00:00:00Z', closedAt: null }]);
  // The open promotion pull request feeds the freeze; the collector only collects.
  assert.equal(evaluate(input).verdict, 'wait:freeze');
});

test('collect 1: every call is execFile-style with an argument array', async () => {
  const world = makeWorld();
  await collect(opts(), deps(world));
  assert.ok(world.calls.length > 10);
  for (const call of world.calls) {
    assert.ok(['git', 'gh'].includes(call.cmd));
    assert.ok(Array.isArray(call.args));
    assert.ok(call.args.every((a) => typeof a === 'string'));
  }
  for (const call of gitCalls(world)) assert.deepEqual(call.args.slice(0, 2), ['-C', '/work/clone']);
  for (const call of world.calls.filter((c) => c.cmd === 'gh')) {
    assert.deepEqual(call.args.slice(0, 5), ['api', '--method', 'GET', '-H', 'Accept: application/vnd.github+json']);
  }
});

test('collect 2: the manifest is read from the trust ref, never from the head ref or the working tree', async () => {
  const world = makeWorld();
  await collect(opts(), deps(world));
  const reads = gitCalls(world).filter((c) => c.args[2] === 'cat-file').map((c) => c.args.slice(3).join(' '));
  assert.ok(reads.some((r) => r === `-e ${world.ns}/trust:.agent-line/manifest.json`));
  assert.ok(reads.some((r) => r === `blob ${world.ns}/trust:.agent-line/manifest.json`));
  assert.ok(!reads.some((r) => r.includes(`${world.ns}/head:`) || r.includes(`${world.ns}/base:.agent-line/manifest`)));
});

test('collect 2b: a manifest file given on the command line replaces the trust ref', async () => {
  const world = makeWorld();
  const input = await collect(opts({ manifestFile: '/tmp/m.json' }), deps(world, { readFile: async (p) => { assert.equal(p, '/tmp/m.json'); return '{"x":1}'; } }));
  assert.equal(input.manifestText, '{"x":1}');
  assert.ok(!gitCalls(world).some((c) => c.args.join(' ').includes('manifest.json')));
});

test('collect 2c: an absent manifest is null', async () => {
  const world = makeWorld({ blobs: { [`refs/agent-pipeline-kit/4242/trust:.agent-line/manifest.json`]: undefined } });
  const input = await collect(opts(), deps(world));
  assert.equal(input.manifestText, null);
});

test('collect 3: a fetched head that differs from the API head throws', async () => {
  const world = makeWorld({ refs: { [`refs/agent-pipeline-kit/4242/head`]: 'd'.repeat(40) } });
  await assert.rejects(collect(opts(), deps(world)), /head/i);
});

test('collect 4: the evaluated head SHA is the API head, even when a Codex summary names another', async () => {
  const other = 'c'.repeat(40);
  const summary = {
    id: 1, user: { id: 199175422, login: 'chatgpt-codex-connector[bot]' },
    body: `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 ${JSON.stringify({ code_review: { commit_sha: other, status: 'completed', has_any_findings: false, has_unresolved_findings: false } })} -->`,
  };
  const world = makeWorld({ rest: { '/repos/owner/repo/issues/7/comments': [summary] } });
  const input = await collect(opts(), deps(world));
  assert.equal(input.pr.headSha, SHAS.HEAD);
  assert.equal(evaluate(input).codex.code, 'stale-review');
});

test('collect 5: only pull request N comments and reviews are requested', async () => {
  const world = makeWorld();
  await collect(opts(), deps(world));
  const paths = ghPaths(world);
  for (const p of ['/repos/owner/repo/issues/7/comments', '/repos/owner/repo/pulls/7/comments', '/repos/owner/repo/pulls/7/reviews']) {
    assert.ok(paths.some((x) => x.startsWith(`${p}?per_page=100&page=1`)), p);
  }
  assert.ok(!paths.some((p) => /\/(issues|pulls)\/(?!7\b)\d+\//.test(p)));
});

test('collect 6: pagination reads a second page after 100 items and stops after a short page', async () => {
  const items = Array.from({ length: 101 }, (_, i) => ({ id: i + 1, user: { id: 5, login: 'x' }, body: 'c' }));
  const world = makeWorld({ rest: { '/repos/owner/repo/issues/7/comments': items } });
  const input = await collect(opts(), deps(world));
  assert.equal(input.codex.comments.length, 101);
  const pages = ghPaths(world).filter((p) => p.startsWith('/repos/owner/repo/issues/7/comments'));
  assert.equal(pages.length, 2);
  assert.ok(pages[1].endsWith('page=2'));
});

test('collect 6b: exactly 100 items cost one more, empty, page', async () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, user: { id: 5, login: 'x' }, body: 'c' }));
  const world = makeWorld({ rest: { '/repos/owner/repo/issues/7/comments': items } });
  const input = await collect(opts(), deps(world));
  assert.equal(input.codex.comments.length, 100);
  assert.equal(ghPaths(world).filter((p) => p.startsWith('/repos/owner/repo/issues/7/comments')).length, 2);
});

test('collect 6c: more than 100 pages throws', async () => {
  const run = async (cmd, args) => {
    if (cmd === 'gh' && args[args.length - 1].includes('/comments')) {
      return { stdout: Buffer.from(JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ id: i })))), stderr: Buffer.alloc(0), code: 0 };
    }
    return makeWorld().run(cmd, args);
  };
  await assert.rejects(collect(opts(), { run, readFile: async () => '', pid: 4242 }), /pages/);
});

test('collect 6d: check runs are read from the check_runs key, all of them', async () => {
  const runs = Array.from({ length: 150 }, (_, i) => ({ id: i + 1, name: 'check', app: { slug: 'github-actions' }, status: 'completed', conclusion: 'success' }));
  const world = makeWorld({ rest: { [`/repos/owner/repo/commits/${SHAS.HEAD}/check-runs?filter=all`]: { check_runs: runs } } });
  const input = await collect(opts(), deps(world));
  assert.equal(input.checkRuns.length, 150);
});

test('collect 7: a gh non-zero exit throws', async () => {
  const failing = makeWorld();
  const run = async (cmd, args) => (cmd === 'gh' && args[args.length - 1].startsWith('/repos/owner/repo/pulls/7/reviews')
    ? { stdout: Buffer.alloc(0), stderr: Buffer.from('HTTP 502'), code: 1 }
    : failing.run(cmd, args));
  await assert.rejects(collect(opts(), { run, readFile: async () => '', pid: 4242 }), /HTTP 502|exit 1/);
});

test('collect 7b: a git non-zero exit throws', async () => {
  const world = makeWorld({ fetchCode: 128 });
  await assert.rejects(collect(opts(), deps(world)), /fetch/);
});

test('collect 7c: invalid JSON from gh throws', async () => {
  const world = makeWorld();
  const run = async (cmd, args) => (cmd === 'gh' && args[args.length - 1] === '/repos/owner/repo'
    ? { stdout: Buffer.from('not json'), stderr: Buffer.alloc(0), code: 0 }
    : world.run(cmd, args));
  await assert.rejects(collect(opts(), { run, readFile: async () => '', pid: 4242 }));
});

test('collect 7d: merge-base --is-ancestor exit codes: 1 is false, others throw', async () => {
  const world = makeWorld({ ancestor: { [SHAS.BASE]: 1 } });
  assert.equal((await collect(opts(), deps(world))).baseIsAncestor, false);
  const broken = makeWorld({ ancestor: { [SHAS.BASE]: 128 } });
  await assert.rejects(collect(opts(), deps(broken)));
});

test('collect 8: ref names with .., a leading - or a space throw before any git call', async () => {
  for (const base of ['a/../b', '-x', 'a b', '/x', 'a;b', '']) {
    const world = makeWorld({ pr: { base: { ref: base } } });
    await assert.rejects(collect(opts(), deps(world)), /ref/i, base);
    assert.equal(gitCalls(world).length, 0, base);
  }
  const world = makeWorld({ rest: { '/repos/owner/repo': { default_branch: '--upload-pack=x' } } });
  await assert.rejects(collect(opts(), deps(world)), /ref/i);
  assert.equal(gitCalls(world).length, 0);
});

test('collect 8b: a bad head SHA from the API throws before any git call', async () => {
  const world = makeWorld({ pr: { head: { sha: 'HEAD', ref: 'x', repo: { full_name: 'owner/repo' } } } });
  await assert.rejects(collect(opts(), deps(world)), /sha/i);
  assert.equal(gitCalls(world).length, 0);
});

test('collect 8c: bad options throw before any call', async () => {
  const world = makeWorld();
  for (const bad of [{ repo: 'owner' }, { repo: 'a/b/c' }, { repo: '../x' }, { repo: 'a/..' }, { prNumber: 0 }, { prNumber: 1.5 }, { prNumber: '7' }, { repoDir: '' }, { callerLane: 'Bad Lane' }]) {
    await assert.rejects(collect(opts(bad), deps(world)), undefined, JSON.stringify(bad));
  }
  assert.equal(world.calls.length, 0);
});

test('collect 8d: the fetch uses explicit refspecs under the private namespace and never checks out', async () => {
  const world = makeWorld();
  await collect(opts(), deps(world));
  const fetch = gitCalls(world).find((c) => c.args[2] === 'fetch');
  assert.deepEqual(fetch.args.slice(2), [
    'fetch', '--no-tags', '--quiet', 'origin',
    `+refs/heads/main:${world.ns}/trust`, `+refs/heads/main:${world.ns}/base`, `+refs/pull/7/head:${world.ns}/head`,
  ]);
  for (const call of gitCalls(world)) {
    assert.ok(!['checkout', 'switch', 'merge', 'pull', 'reset', 'clone', 'worktree', 'push'].includes(call.args[2]), call.args[2]);
  }
});

test('collect 8e: the namespace refs are deleted afterwards, also after a failure', async () => {
  const world = makeWorld();
  await collect(opts(), deps(world));
  const deleted = gitCalls(world).filter((c) => c.args[2] === 'update-ref').map((c) => c.args[4]);
  assert.deepEqual(deleted.sort(), [`${world.ns}/base`, `${world.ns}/head`, `${world.ns}/trust`]);
  const failing = makeWorld({ refs: { [`refs/agent-pipeline-kit/4242/head`]: 'd'.repeat(40) } });
  await assert.rejects(collect(opts(), deps(failing)));
  assert.equal(gitCalls(failing).filter((c) => c.args[2] === 'update-ref').length, 3);
});

test('collect 8f: the diff is taken from the merge base to the head with the plan flags', async () => {
  const world = makeWorld();
  await collect(opts(), deps(world));
  const diffs = gitCalls(world).filter((c) => c.args[2] === 'diff').map((c) => c.args.slice(2));
  assert.deepEqual(diffs[0].slice(0, 7), ['diff', '--raw', '-z', '--no-renames', '--no-abbrev', '--no-ext-diff', '--no-textconv']);
  assert.deepEqual(diffs[1].slice(0, 6), ['diff', '--numstat', '-z', '--no-renames', '--no-ext-diff', '--no-textconv']);
  for (const d of diffs) assert.deepEqual(d.slice(-3), [SHAS.MB, SHAS.HEAD, '--']);
});

test('collect 8g: a NUL byte in a head blob sets headHasNul', async () => {
  const world = makeWorld({ blobs: { [SHAS.S_NEW]: 'a\0b' } });
  const input = await collect(opts(), deps(world));
  assert.equal(input.files[0].headHasNul, true);
});

test('collect 8h: a numstat entry missing for a raw entry throws', async () => {
  const world = makeWorld({ numstat: '3\t1\tsrc/x.go\0' });
  await assert.rejects(collect(opts(), deps(world)), /numstat/);
});

test('collect 8i: a non-queue head has no queue item and no queue read', async () => {
  const world = makeWorld({ pr: { head: { sha: SHAS.HEAD, ref: 'feature/x', repo: { full_name: 'owner/repo' } } } });
  const input = await collect(opts(), deps(world));
  assert.equal('queueItemText' in input, false);
  assert.ok(!gitCalls(world).some((c) => c.args.join(' ').includes('.agent-line/queue')));
});

test('collect 8j: an absent queue item is null', async () => {
  const world = makeWorld({ blobs: { [`${SHAS.BASE}:.agent-line/queue/sim-1.md`]: undefined } });
  assert.equal((await collect(opts(), deps(world))).queueItemText, null);
});

test('collect 8k: a pull request whose head repository was deleted has an empty head repository', async () => {
  const world = makeWorld({ pr: { head: { sha: SHAS.HEAD, ref: 'x', repo: null } } });
  assert.equal((await collect(opts(), deps(world))).pr.headRepo, '');
});

test('collect 8l: the caller lane is passed through', async () => {
  const world = makeWorld();
  assert.equal((await collect(opts({ callerLane: 'nightly' }), deps(world))).callerLane, 'nightly');
});

test('collect 8m: halt issues and open pull requests are mapped', async () => {
  const world = makeWorld({
    rest: {
      '/repos/owner/repo/issues?labels=pipeline-halt&state=open': [{ number: 3, created_at: '2026-11-02T00:00:00Z', closed_at: null }],
    },
  });
  const input = await collect(opts(), deps(world));
  assert.deepEqual(input.haltIssues, [{ number: 3, createdAt: '2026-11-02T00:00:00Z', closedAt: null }]);
});

// Replay.
const mergedPr = (extra = {}) => ({
  state: 'closed', merged: true, mergeable: null, merged_at: '2026-11-10T12:00:00Z', merge_commit_sha: SHAS.MERGE_COMMIT, ...extra,
});

test('collect 9: replay uses the first parent of the merge commit as the base and reconstructs the title', async () => {
  const world = makeWorld({
    pr: mergedPr({ title: 'feat: renamed later' }),
    rest: {
      '/repos/owner/repo/issues/7/timeline': [
        { event: 'labeled', created_at: '2026-11-10T11:00:00Z' },
        { event: 'renamed', created_at: '2026-11-10T11:59:00Z', rename: { from: 'a', to: 'b' } },
        { event: 'renamed', created_at: '2026-11-10T13:00:00Z', rename: { from: 'feat: original', to: 'feat: mid' } },
        { event: 'renamed', created_at: '2026-11-10T14:00:00Z', rename: { from: 'feat: mid', to: 'feat: renamed later' } },
      ],
      '/repos/owner/repo/issues?labels=pipeline-halt&state=all': [{ number: 3, created_at: '2026-11-02T00:00:00Z', closed_at: '2026-11-03T00:00:00Z' }],
      '/repos/owner/repo/pulls?state=all&head=owner:preview&base=main': [{ number: 9, head: { ref: 'preview', repo: { full_name: 'owner/repo' } }, base: { ref: 'main' }, created_at: '2026-11-01T00:00:00Z', closed_at: '2026-11-11T00:00:00Z' }],
    },
  });
  const input = await collect(opts({ replay: true }), deps(world));
  assert.equal(input.asOf, '2026-11-10T12:00:00Z');
  assert.equal(input.baseSha, SHAS.PARENT);
  assert.equal(input.mergeMessage, 'feat: add x (#7)\n\nAuto-Merged-By: test-runner\n');
  assert.equal(input.mergeCommit, SHAS.MERGE_COMMIT);
  assert.equal(input.pr.title, 'feat: original');
  assert.equal(input.pr.draft, false);
  assert.equal(input.pr.mergeable, null);
  assert.equal(input.pr.merged, true);
  assert.deepEqual(input.limits, ['manifest-by-commit-date', 'halt-label-timing', 'freeze-retarget-unknown']);
  assert.deepEqual(input.haltIssues, [{ number: 3, createdAt: '2026-11-02T00:00:00Z', closedAt: '2026-11-03T00:00:00Z' }]);
  assert.deepEqual(input.pulls, [{ number: 9, headRef: 'preview', headRepo: 'owner/repo', baseRef: 'main', createdAt: '2026-11-01T00:00:00Z', closedAt: '2026-11-11T00:00:00Z' }]);
  // The queue item is read at the first parent, the manifest at the dated commit.
  const reads = gitCalls(world).filter((c) => c.args[2] === 'cat-file').map((c) => c.args[4]);
  assert.ok(reads.includes(`${SHAS.PARENT}:.agent-line/queue/sim-1.md`));
  assert.ok(reads.includes(`${SHAS.TRUST}:.agent-line/manifest.json`));
  const revList = gitCalls(world).find((c) => c.args[2] === 'rev-list');
  assert.deepEqual(revList.args.slice(2), ['rev-list', '-1', '--first-parent', '--before=2026-11-10T12:00:00Z', `${world.ns}/trust`]);
  // The diff and ancestry use the replayed base tip.
  const mb = gitCalls(world).find((c) => c.args[2] === 'merge-base' && c.args[3] !== '--is-ancestor');
  assert.deepEqual(mb.args.slice(3), [SHAS.PARENT, SHAS.HEAD]);
});

test('collect 9b: replay with a manifest file adds no manifest-by-commit-date limit', async () => {
  const world = makeWorld({ pr: mergedPr() });
  const input = await collect(opts({ replay: true, manifestFile: '/tmp/m.json' }), deps(world, { readFile: async () => JSON.stringify({ schema: 1 }) }));
  assert.ok(!input.limits.includes('manifest-by-commit-date'));
  assert.ok(!gitCalls(world).some((c) => c.args[2] === 'rev-list'));
  // An invalid manifest means no freeze lookup, no freeze limit.
  assert.ok(!input.limits.includes('freeze-retarget-unknown'));
});

test('collect 9c: replay of a pull request that is not merged throws', async () => {
  const world = makeWorld({ pr: { state: 'closed', merged: false } });
  await assert.rejects(collect(opts({ replay: true }), deps(world)), /merged/);
});

test('collect 9d: replay where the merge commit is not reachable from the base throws', async () => {
  const world = makeWorld({ pr: mergedPr(), ancestor: { [SHAS.MERGE_COMMIT]: 1 } });
  await assert.rejects(collect(opts({ replay: true }), deps(world)), /reachable/);
});

test('collect 9e: replay with a bad merge commit SHA throws before any git call', async () => {
  const world = makeWorld({ pr: mergedPr({ merge_commit_sha: null }) });
  await assert.rejects(collect(opts({ replay: true }), deps(world)), /merge/i);
  assert.equal(gitCalls(world).length, 0);
});

test('collect 9f: replay without a manifest commit before the merge has a null manifest', async () => {
  const world = makeWorld({ pr: mergedPr(), revList: '' });
  assert.equal((await collect(opts({ replay: true }), deps(world))).manifestText, null);
});

test('collect 9g: replay does not request open-state halt issues or open pull requests', async () => {
  const world = makeWorld({ pr: mergedPr() });
  await collect(opts({ replay: true }), deps(world));
  const paths = ghPaths(world);
  assert.ok(!paths.some((p) => p.includes('state=open')));
  assert.ok(paths.some((p) => p.includes('/issues?labels=pipeline-halt&state=all')));
});

test('collect 9h: a rebase merge is not detected or flagged', async () => {
  const world = makeWorld({ pr: mergedPr() });
  const input = await collect(opts({ replay: true }), deps(world));
  assert.ok(!input.limits.some((l) => l.includes('rebase')));
});
