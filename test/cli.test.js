import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../src/cli.js';
import { baseline, BOT, SHA, codexSummary, checkRun, editManifest } from './support/baseline.js';

const KIT = '7'.repeat(40);

function makeIo({ collect, run, readFile } = {}) {
  const out = [];
  const err = [];
  const calls = [];
  const defaultRun = async (cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === 'git' && args.includes('rev-parse')) return { stdout: Buffer.from(`${KIT}\n`), stderr: Buffer.alloc(0), code: 0 };
    return { stdout: Buffer.from('[]'), stderr: Buffer.alloc(0), code: 0 };
  };
  const io = {
    collect: collect ?? (async () => baseline()),
    run: run ?? defaultRun,
    readFile: readFile ?? (async () => ''),
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    cliDir: '/kit',
  };
  return { io, out, err, calls };
}

const evalArgs = ['evaluate', '--repo', 'owner/repo', '--pr', '7', '--repo-dir', '/clone'];
const replayArgs = ['replay', '--repo', 'owner/repo', '--pr', '7', '--repo-dir', '/clone'];
const cleanInput = () => { const i = baseline(); return i; };
const replayInput = (extra = {}) => {
  const i = baseline();
  i.asOf = '2026-11-10T12:00:00Z';
  i.pr.state = 'closed';
  i.pr.merged = true;
  i.pr.mergeable = null;
  i.mergeCommit = 'e'.repeat(40);
  i.mergeMessage = 'feat: add x (#7)\n\nAuto-Merged-By: test-runner\n';
  Object.assign(i, extra);
  return i;
};

test('cli: evaluate prints one JSON object and exits 0 on merge', async () => {
  const h = makeIo({ collect: async () => cleanInput() });
  const code = await main(evalArgs, h.io);
  assert.equal(code, 0);
  assert.equal(h.out.length, 1);
  const result = JSON.parse(h.out[0]);
  assert.equal(result.verdict, 'merge');
  assert.equal(result.kit, KIT);
  assert.equal(result.merge.method, 'squash');
});

test('cli: evaluate exits 1 on any other verdict', async () => {
  const input = cleanInput();
  input.pr.draft = true;
  const h = makeIo({ collect: async () => input });
  assert.equal(await main(evalArgs, h.io), 1);
  assert.equal(JSON.parse(h.out[0]).verdict, 'hold:owner');
});

test('cli: evaluate passes the options to the collector', async () => {
  let seen;
  const h = makeIo({ collect: async (options) => { seen = options; return cleanInput(); } });
  await main([...evalArgs, '--lane', 'nightly', '--manifest', '/tmp/m.json'], h.io);
  assert.deepEqual(seen, { repo: 'owner/repo', prNumber: 7, repoDir: '/clone', callerLane: 'nightly', replay: false, manifestFile: '/tmp/m.json' });
});

test('cli: a collection failure is blocked:input, never an empty result, exit 1', async () => {
  const h = makeIo({ collect: async () => { throw new Error('boom'); } });
  assert.equal(await main(evalArgs, h.io), 1);
  const result = JSON.parse(h.out[0]);
  assert.equal(result.verdict, 'blocked:input');
  assert.deepEqual(result.reasons, [{ verdict: 'blocked:input', code: 'collect-failed', detail: 'boom' }]);
  assert.equal(result.merge, null);
  assert.equal(result.kit, KIT);
});

test('cli: a failure inside the core is also blocked:input', async () => {
  const input = cleanInput();
  input.schema = 2;
  const h = makeIo({ collect: async () => input });
  assert.equal(await main(evalArgs, h.io), 1);
  assert.equal(JSON.parse(h.out[0]).reasons[0].code, 'collect-failed');
});

test('cli: kit is "unknown" when git cannot say', async () => {
  const h = makeIo({ run: async () => ({ stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), code: 128 }) });
  await main(evalArgs, h.io);
  assert.equal(JSON.parse(h.out[0]).kit, 'unknown');
  const thrown = makeIo({ run: async () => { throw new Error('no git'); } });
  await main(evalArgs, thrown.io);
  assert.equal(JSON.parse(thrown.out[0]).kit, 'unknown');
});

test('cli: kit is read from the directory of the CLI', async () => {
  const h = makeIo();
  await main(evalArgs, h.io);
  const call = h.calls.find((c) => c.cmd === 'git');
  assert.deepEqual(call.args, ['-C', '/kit', 'rev-parse', 'HEAD']);
});

test('cli: replay adds mergeCommit, mergedAt and marker', async () => {
  let seen;
  const h = makeIo({ collect: async (options) => { seen = options; return replayInput(); } });
  assert.equal(await main(replayArgs, h.io), 0);
  const result = JSON.parse(h.out[0]);
  assert.equal(seen.replay, true);
  assert.equal(result.verdict, 'merge');
  assert.equal(result.mergeCommit, 'e'.repeat(40));
  assert.equal(result.mergedAt, '2026-11-10T12:00:00Z');
  assert.equal(result.marker, 'Auto-Merged-By: test-runner');
});

test('cli: replay marker is null without a marker line', async () => {
  const h = makeIo({ collect: async () => replayInput({ mergeMessage: 'feat: x\n\nbody\n' }) });
  await main(replayArgs, h.io);
  assert.equal(JSON.parse(h.out[0]).marker, null);
});

test('cli: replay failure carries null merge facts', async () => {
  const h = makeIo({ collect: async () => { throw new Error('not merged'); } });
  assert.equal(await main(replayArgs, h.io), 1);
  const result = JSON.parse(h.out[0]);
  assert.equal(result.verdict, 'blocked:input');
  assert.equal(result.marker, null);
  assert.equal(result.mergeCommit, null);
  assert.equal(result.mergedAt, null);
});

const usageRows = [
  { name: 'no arguments', argv: [] },
  { name: 'unknown command', argv: ['merge'] },
  { name: 'help is not a command', argv: ['--help'] },
  { name: 'unknown option', argv: [...evalArgs, '--force', 'x'] },
  { name: 'option without a value', argv: [...evalArgs, '--lane'] },
  { name: 'option whose value looks like an option', argv: ['evaluate', '--repo', '--pr', '7', '--repo-dir', '/c'] },
  { name: 'duplicate option', argv: [...evalArgs, '--pr', '8'] },
  { name: 'positional argument', argv: [...evalArgs, 'extra'] },
  { name: 'option with = form', argv: ['evaluate', '--repo=owner/repo', '--pr', '7', '--repo-dir', '/c'] },
  { name: 'missing --repo', argv: ['evaluate', '--pr', '7', '--repo-dir', '/c'] },
  { name: 'missing --pr', argv: ['evaluate', '--repo', 'owner/repo', '--repo-dir', '/c'] },
  { name: 'missing --repo-dir', argv: ['evaluate', '--repo', 'owner/repo', '--pr', '7'] },
  { name: 'malformed repo', argv: ['evaluate', '--repo', 'owner', '--pr', '7', '--repo-dir', '/c'] },
  { name: 'repo with a dot segment', argv: ['evaluate', '--repo', 'owner/..', '--pr', '7', '--repo-dir', '/c'] },
  { name: 'non-numeric pr', argv: ['evaluate', '--repo', 'owner/repo', '--pr', 'seven', '--repo-dir', '/c'] },
  { name: 'zero pr', argv: ['evaluate', '--repo', 'owner/repo', '--pr', '0', '--repo-dir', '/c'] },
  { name: 'pr with leading zero', argv: ['evaluate', '--repo', 'owner/repo', '--pr', '07', '--repo-dir', '/c'] },
  { name: 'bad lane name', argv: [...evalArgs, '--lane', 'Bad Lane'] },
  { name: '--lane on replay', argv: [...replayArgs, '--lane', 'nightly'] },
  { name: '--since on evaluate', argv: [...evalArgs, '--since', '2026-11-01T00:00:00Z'] },
  { name: 'backtest without --until', argv: ['backtest', '--repo', 'owner/repo', '--repo-dir', '/c', '--since', '2026-11-01T00:00:00Z'] },
  { name: 'backtest with a malformed date', argv: ['backtest', '--repo', 'owner/repo', '--repo-dir', '/c', '--since', 'yesterday', '--until', '2026-11-02T00:00:00Z'] },
  { name: 'backtest with since equal to until', argv: ['backtest', '--repo', 'owner/repo', '--repo-dir', '/c', '--since', '2026-11-02T00:00:00Z', '--until', '2026-11-02T00:00:00Z'] },
  { name: 'backtest with since after until', argv: ['backtest', '--repo', 'owner/repo', '--repo-dir', '/c', '--since', '2026-11-03T00:00:00Z', '--until', '2026-11-02T00:00:00Z'] },
  { name: 'backtest with a bad base', argv: ['backtest', '--repo', 'owner/repo', '--repo-dir', '/c', '--since', '2026-11-01T00:00:00Z', '--until', '2026-11-02T00:00:00Z', '--base', '-x'] },
];

for (const row of usageRows) {
  test(`cli usage error (exit 2): ${row.name}`, async () => {
    const h = makeIo({ collect: async () => { throw new Error('collector must not run'); } });
    assert.equal(await main(row.argv, h.io), 2);
    assert.equal(h.out.length, 0);
    assert.ok(h.err.length >= 1);
    assert.match(h.err.join('\n'), /usage/i);
    assert.equal(h.calls.length, 0);
  });
}

// Backtest.
const listing = (n, mergedAt, extra = {}) => ({ number: n, merged_at: mergedAt, merge_commit_sha: String(n).padStart(40, '0'), updated_at: mergedAt, ...extra });

function makeBacktestIo({ prs, inputs }) {
  const seenGh = [];
  const run = async (cmd, args) => {
    if (cmd === 'gh') {
      const path = args[args.length - 1];
      seenGh.push(path);
      const page = Number(/[?&]page=(\d+)/.exec(path)?.[1] ?? 1);
      return { stdout: Buffer.from(JSON.stringify(prs.slice((page - 1) * 100, page * 100))), stderr: Buffer.alloc(0), code: 0 };
    }
    return { stdout: Buffer.from(`${KIT}\n`), stderr: Buffer.alloc(0), code: 0 };
  };
  const collected = [];
  const collect = async (options) => {
    collected.push(options);
    const made = inputs[options.prNumber];
    if (made === 'throw') throw new Error(`cannot replay ${options.prNumber}`);
    return made();
  };
  const h = makeIo({ run, collect });
  return { ...h, seenGh, collected };
}

const btArgs = ['backtest', '--repo', 'owner/repo', '--repo-dir', '/clone', '--since', '2026-11-10T00:00:00Z', '--until', '2026-11-20T00:00:00Z'];

test('cli backtest: lines in ascending merged_at order, then one summary line', async () => {
  const noMarker = (extra = {}) => replayInput({ mergeMessage: 'feat: y (#9)\n', ...extra });
  const h = makeBacktestIo({
    prs: [
      listing(12, '2026-11-15T00:00:00Z'),
      listing(13, '2026-11-09T23:59:59Z'), // before since
      listing(14, '2026-11-20T00:00:00Z'), // at until: excluded
      listing(11, '2026-11-12T00:00:00Z'),
      listing(10, null), // closed, not merged
      listing(9, '2026-11-10T00:00:00Z'), // at since: included
    ],
    inputs: {
      9: () => replayInput(),
      11: () => replayInput(),
      12: () => noMarker(),
    },
  });
  assert.equal(await main(btArgs, h.io), 0);
  const lines = h.out.map((l) => JSON.parse(l));
  assert.deepEqual(lines.slice(0, -1).map((l) => l.pr), [9, 11, 12]);
  assert.deepEqual(lines.slice(0, -1).map((l) => l.verdict), ['merge', 'merge', 'merge']);
  const first = lines[0];
  assert.deepEqual(Object.keys(first), ['repo', 'pr', 'mergedAt', 'mergeCommit', 'marker', 'verdict', 'reasons', 'limits']);
  assert.equal(first.marker, 'Auto-Merged-By: test-runner');
  const summary = lines.at(-1).summary;
  assert.equal(summary.total, 3);
  assert.deepEqual(summary.byVerdict, { merge: 3 });
  assert.deepEqual(summary.anomalies, []);
  assert.deepEqual(summary.unmarkedNotMerge, []);
  assert.equal(summary.kit, KIT);
  assert.ok(h.collected.every((o) => o.replay === true && o.callerLane === null));
});

test('cli backtest: anomalies and unmarkedNotMerge come from markers and verdicts', async () => {
  const marked = (extra = {}) => replayInput(extra);
  const unmarked = (extra = {}) => replayInput({ mergeMessage: 'feat: other\n', ...extra });
  const failing = () => { const i = replayInput(); i.checkRuns = [checkRun({ conclusion: 'failure' })]; return i; };
  const unmarkedFailing = () => { const i = unmarked(); i.pr.draft = true; return i; };
  const h = makeBacktestIo({
    prs: [
      listing(1, '2026-11-11T00:00:00Z'),
      listing(2, '2026-11-12T00:00:00Z'),
      listing(3, '2026-11-13T00:00:00Z'),
      listing(4, '2026-11-14T00:00:00Z'),
      listing(5, '2026-11-15T00:00:00Z'),
    ],
    inputs: {
      1: () => marked(),
      2: failing, // marker, not merge: anomaly
      3: () => unmarked(), // unmarked and merge: in neither list
      4: unmarkedFailing, // unmarked, not merge
      5: 'throw', // replay throws: marker unknown
    },
  });
  assert.equal(await main(btArgs, h.io), 0);
  const lines = h.out.map((l) => JSON.parse(l));
  const summary = lines.at(-1).summary;
  assert.equal(summary.total, 5);
  assert.deepEqual(summary.byVerdict, { merge: 2, 'fix:ci': 1, 'hold:owner': 1, 'blocked:input': 1 });
  assert.deepEqual(summary.anomalies, [2, 5]);
  assert.deepEqual(summary.unmarkedNotMerge, [4, 5]);
  const thrown = lines.find((l) => l.pr === 5);
  assert.equal(thrown.verdict, 'blocked:input');
  assert.equal(thrown.reasons[0].code, 'collect-failed');
  assert.equal(thrown.marker, null);
  assert.deepEqual(thrown.limits, []);
  assert.equal(thrown.mergeCommit, '5'.padStart(40, '0'));
});

test('cli backtest: --base and --manifest are passed on', async () => {
  const h = makeBacktestIo({ prs: [listing(1, '2026-11-11T00:00:00Z')], inputs: { 1: () => replayInput() } });
  await main([...btArgs, '--base', 'preview/main', '--manifest', '/tmp/m.json'], h.io);
  assert.ok(h.seenGh[0].startsWith('/repos/owner/repo/pulls?state=closed&sort=updated&direction=desc&base=preview%2Fmain&per_page=100&page=1'));
  assert.equal(h.collected[0].manifestFile, '/tmp/m.json');
});

test('cli backtest: the listing path without --base', async () => {
  const h = makeBacktestIo({ prs: [], inputs: {} });
  assert.equal(await main(btArgs, h.io), 0);
  assert.ok(h.seenGh[0].startsWith('/repos/owner/repo/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=1'));
  const lines = h.out.map((l) => JSON.parse(l));
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].summary, { total: 0, byVerdict: {}, anomalies: [], unmarkedNotMerge: [], kit: KIT });
});

test('cli backtest: a failed listing is reported and exits 1', async () => {
  const run = async (cmd) => (cmd === 'gh'
    ? { stdout: Buffer.alloc(0), stderr: Buffer.from('HTTP 500'), code: 1 }
    : { stdout: Buffer.from(`${KIT}\n`), stderr: Buffer.alloc(0), code: 0 });
  const h = makeIo({ run });
  assert.equal(await main(btArgs, h.io), 1);
  const result = JSON.parse(h.out[0]);
  assert.equal(result.error, 'collect-failed');
  assert.match(result.detail, /HTTP 500/);
  assert.equal(h.out.length, 1);
});

test('cli backtest: a replay that merges with a limit keeps its limits', async () => {
  const h = makeBacktestIo({
    prs: [listing(1, '2026-11-11T00:00:00Z')],
    inputs: { 1: () => { const i = replayInput(); i.limits = ['halt-label-timing']; i.codex.comments = [codexSummary({}, undefined, { updated_at: '2026-11-12T00:00:00Z' })]; return i; } },
  });
  await main(btArgs, h.io);
  assert.deepEqual(JSON.parse(h.out[0]).limits, ['halt-label-timing', 'codex-edited-after-merge']);
});

test('cli replay: review requests after asOf / cap 2 with one request before and one after / the later one does not count', async () => {
  const request = (id, created_at) => ({ id, user: { id: 5, login: 'owner' }, body: '@codex review', created_at });
  const finding = { id: 10, user: BOT, body: '**[P1] Fix this**', commit_id: SHA, original_commit_id: SHA, created_at: '2026-11-10T10:01:00Z', updated_at: '2026-11-10T10:01:00Z' };
  const input = (second) => {
    const i = replayInput();
    editManifest(i, (m) => { m.lanes.runner.max_review_requests = 2; });
    i.codex = {
      comments: [codexSummary({ has_any_findings: true, has_unresolved_findings: true }), request(2, '2026-11-10T09:00:00Z'), second],
      reviewComments: [finding],
      reviews: [],
    };
    return i;
  };
  const codes = async (second) => {
    const h = makeIo({ collect: async () => input(second) });
    await main(replayArgs, h.io);
    return JSON.parse(h.out[0]).reasons.map((r) => r.code);
  };
  assert.deepEqual(await codes(request(3, '2026-11-10T13:00:00Z')), ['p0-p1']);
  assert.deepEqual(await codes(request(3, 'not a time')), ['review-cap', 'p0-p1']);
});
