import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../../src/core/verdict.js';
import {
  SHA, BASE_SHA, baseline, baselineManifest, editManifest, withCaller, asCaller, deepFreeze,
  codexSummary, file, addedFile, checkRun,
} from '../support/baseline.js';

// Each row: a change from the baseline, the expected verdict, the expected
// code of the first reason, and codes that must also be among the reasons.
// `change` may mutate the input it receives.
const rows = [];
const row = (id, name, change, verdict, code, also = []) => rows.push({ id, name, change, verdict, code, also });

const halt = { number: 3, createdAt: '2026-11-01T00:00:00Z', closedAt: null };
const promotion = { number: 9, headRef: 'preview', headRepo: 'owner/repo', baseRef: 'main', createdAt: '2026-11-09T00:00:00Z', closedAt: null };
const toPreview = (input) => {
  editManifest(input, (m) => {
    m.lanes.runner.base = 'preview';
    m.lanes.runner.freeze_while_open = { head: 'preview', base: 'main' };
  });
  input.pr.baseRef = 'preview';
};
const setFiles = (input, ...files) => { input.files = files; };
const withReport = (...files) => (input) => setFiles(input, ...files, addedFile('.agent-line/reports/sim-1.md'));

row(1, 'baseline', () => {}, 'merge', null);
row(2, 'open halt issue', (i) => { i.haltIssues = [halt]; }, 'wait:halt', 'halt-issue-open');
row(3, 'halt issue plus a floor path', (i) => {
  i.haltIssues = [halt];
  i.files.push(file('.github/workflows/ci.yml'));
}, 'wait:halt', 'halt-issue-open', ['floor']);
row(4, 'promotion pull request open', (i) => { toPreview(i); i.pulls = [promotion]; }, 'wait:freeze', 'promotion-open');
row(5, 'promotion pull request closed', (i) => { toPreview(i); i.pulls = []; }, 'merge', null);
row('5b', 'a pull request with another head or base does not freeze', (i) => {
  toPreview(i);
  i.pulls = [{ ...promotion, headRef: 'other' }, { ...promotion, baseRef: 'release' }];
}, 'merge', null);
row('5c', 'the freeze ignores the head repository', (i) => {
  toPreview(i);
  i.pulls = [{ ...promotion, headRepo: 'someone/else' }];
}, 'wait:freeze', 'promotion-open');
row('6a', 'manifest missing', (i) => { i.manifestText = null; }, 'blocked:manifest', 'manifest-missing');
row('6b', 'manifest not JSON', (i) => { i.manifestText = '{ nope'; }, 'blocked:manifest', 'manifest-json');
row('6c', 'manifest with an unknown key', (i) => { editManifest(i, (m) => { m.extra = 1; }); }, 'blocked:manifest', 'manifest-invalid');
row(7, 'head repository is a fork', (i) => { i.pr.headRepo = 'someone/repo'; }, 'hold:owner', 'fork');
row('7b', 'repository names compare case-insensitively', (i) => { i.pr.headRepo = 'Owner/Repo'; }, 'merge', null);
row('7c', 'a missing head repository is a fork', (i) => { i.pr.headRepo = ''; }, 'hold:owner', 'fork');
row(8, 'pull request closed, live', (i) => { i.pr.state = 'closed'; }, 'blocked:not-open', 'not-open');
row(9, 'no files', (i) => { i.files = []; }, 'blocked:empty-diff', 'empty-diff');
row(10, 'a path with lossy decoding', (i) => { i.files.push(file('bad�.txt', { pathBytesOk: false })); }, 'blocked:input', 'path-encoding');
row(11, 'head feature/x, no caller lane', (i) => { i.pr.headRef = 'feature/x'; }, 'hold:owner', 'no-lane');
row('12a', 'head claude/item-Sim-1', (i) => { i.pr.headRef = 'claude/item-Sim-1'; }, 'hold:owner', 'no-lane');
row('12b', 'head claude/item-../x', (i) => { i.pr.headRef = 'claude/item-../x'; }, 'hold:owner', 'no-lane');
row('12c', 'head with a trailing newline', (i) => { i.pr.headRef = 'claude/item-sim-1\n'; }, 'hold:owner', 'no-lane');
row('12d', 'head claude/item-', (i) => { i.pr.headRef = 'claude/item-'; }, 'hold:owner', 'no-lane');
row(13, 'base release', (i) => { i.pr.baseRef = 'release'; }, 'hold:owner', 'base-mismatch');
row('13b', 'base differs in case', (i) => { i.pr.baseRef = 'Main'; }, 'hold:owner', 'base-mismatch');
row(14, 'caller lane not in the manifest', (i) => { i.pr.headRef = 'feature/x'; i.callerLane = 'nightly'; }, 'blocked:lane', 'unknown-lane');
row('14b', 'caller lane naming the queue lane, head not in the queue form', (i) => {
  i.pr.headRef = 'feature/x';
  i.callerLane = 'runner';
}, 'blocked:lane', 'unknown-lane');
row(15, 'queue head plus a different caller lane', (i) => { withCaller(i); i.callerLane = 'nightly'; }, 'blocked:lane', 'lane-conflict');
row('15b', 'queue head plus the queue lane as caller lane', (i) => { i.callerLane = 'runner'; }, 'merge', null);
row(16, 'caller lane that exists, head feature/x', (i) => { asCaller(i); }, 'merge', null);
row('16b', 'a caller lane has no queue item, so the report is a floor path', (i) => {
  asCaller(i);
  i.files.push(addedFile('.agent-line/reports/sim-1.md'));
}, 'hold:owner', 'floor');
row(17, 'auto_merge false', (i) => { editManifest(i, (m) => { m.lanes.runner.auto_merge = false; }); }, 'hold:owner', 'auto-merge-off');
row(18, 'queue item absent', (i) => { i.queueItemText = null; }, 'hold:owner', 'queue-item-missing');
row('18b', 'queue item not collected', (i) => { delete i.queueItemText; }, 'hold:owner', 'queue-item-missing');
row(19, 'queue item merge: owner', (i) => { i.queueItemText = '---\nmerge: owner\n---\n'; }, 'hold:owner', 'queue-merge-owner');
row(20, 'queue item without merge:', (i) => { i.queueItemText = '---\nid: sim-1\n---\n'; }, 'merge', null);
for (const [k, text] of [
  ['a', '---\nmerge: maybe\n---\n'],
  ['b', '---\nmerge: "owner"\n---\n'],
  ['c', '---\r\nmerge: runner\r\n---\r\n'],
  ['d', '---\nmerge: runner\nmerge: owner\n---\n'],
  ['e', '---\nmerge: runner\n'],
]) {
  row(`21${k}`, `unreadable queue item ${JSON.stringify(text)}`, (i) => { i.queueItemText = text; }, 'hold:owner', 'queue-item-unreadable');
}
row(22, 'draft', (i) => { i.pr.draft = true; }, 'hold:owner', 'draft');
for (const [k, title] of [['a', '[FAILED] x'], ['b', '[needs-decision] x'], ['c', 'fix: x [NEEDS-DECISION]']]) {
  row(`23${k}`, `title ${title}`, (i) => { i.pr.title = title; }, 'hold:owner', 'title-marker');
}
row('23d', 'a title mentioning failure without the marker', (i) => { i.pr.title = 'fix: failed login'; }, 'merge', null);

const floorPaths = [
  '.github/workflows/ci.yml', '.GitHub/workflows/ci.yml', '.agent-line/queue/x.md', '.agent-line/manifest.json',
  '.claude/settings.json', 'a/b/.Claude/settings.json', '.codex/config.toml', 'x/.agents/y', 'CLAUDE.md', 'Docs/CLAUDE.local.md',
  'AGENTS.md', 'docs/agents-notes.md', '.mcp.json', 'sub/.mcp.json',
  '.vscode/settings.json', '.idea/x.xml', '.envrc', 'a/.envrc', '.husky/pre-commit', '.githooks/pre-push', 'git-hooks/x',
  '.gitattributes', 'a/.gitmodules', '.gitmodules',
  '.npmrc', '.yarnrc', '.yarnrc.yml',
  'package.json', 'web/package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml',
  'pnpm-workspace.yaml', 'bun.lock', 'bun.lockb', 'go.mod', 'go.sum', 'go.work', 'go.work.sum', 'Cargo.toml',
  'Cargo.lock', 'pyproject.toml', 'poetry.lock', 'Pipfile', 'Pipfile.lock', 'uv.lock', 'requirements.txt',
  'requirements-dev.txt', 'Gemfile', 'Gemfile.lock',
];
for (const p of floorPaths) {
  row(`24 ${p}`, `floor path ${p}`, (i) => { i.files.push(file(p)); }, 'hold:owner', 'floor');
}
row(25, 'a rename away from a protected file', (i) => {
  setFiles(i, file('CLAUDE.md', { status: 'D', headMode: null, headHasNul: null }), addedFile('docs/old.md'), addedFile('.agent-line/reports/sim-1.md'));
}, 'hold:owner', 'floor');
row('26a', 'own report deleted', (i) => {
  setFiles(i, file('src/x.go'), file('.agent-line/reports/sim-1.md', { status: 'D', headMode: null, headHasNul: null }));
}, 'hold:owner', 'floor');
row('26b', 'own report with mode 100755', (i) => {
  setFiles(i, file('src/x.go'), addedFile('.agent-line/reports/sim-1.md', { headMode: '100755', headHasNul: null }));
}, 'hold:owner', 'mode', ['floor']);
row('26c', 'report of another item', (i) => { i.files.push(addedFile('.agent-line/reports/sim-2.md')); }, 'hold:owner', 'floor');
row('26d', 'own report as a modification is exempt', (i) => {
  setFiles(i, file('src/x.go'), file('.agent-line/reports/sim-1.md'));
}, 'merge', null);
row('26e', 'own report with a different case is not exempt', (i) => {
  setFiles(i, file('src/x.go'), addedFile('.agent-line/Reports/sim-1.md'));
}, 'hold:owner', 'floor');
row('26f', 'a nested path under the report directory is not exempt', (i) => {
  setFiles(i, file('src/x.go'), addedFile('.agent-line/reports/sim-1.md/x'));
}, 'hold:owner', 'floor');
row('26g', 'own report with a type change', (i) => {
  setFiles(i, file('src/x.go'), file('.agent-line/reports/sim-1.md', { status: 'T' }));
}, 'hold:owner', 'mode', ['floor']);
for (const [k, mode] of [['a', '120000'], ['b', '160000'], ['c', '100755']]) {
  row(`27${k}`, `head mode ${mode}`, (i) => { i.files.push(addedFile('src/y', { headMode: mode, headHasNul: null })); }, 'hold:owner', 'mode');
}
row('27d', 'type change', (i) => { i.files.push(file('src/y', { status: 'T' })); }, 'hold:owner', 'mode');
row('27e', 'a deleted symlink is not a mode problem', (i) => {
  i.files.push(file('src/y', { status: 'D', baseMode: '120000', headMode: null, headHasNul: null }));
}, 'merge', null);
row(28, 'head blob has a NUL byte', (i) => { i.files.push(file('src/y.bin', { headHasNul: true })); }, 'hold:owner', 'binary');
row('28b', 'NUL check missing for a regular file', (i) => { i.files.push(file('src/y.bin', { headHasNul: null })); }, 'hold:owner', 'binary');
row(29, 'path in hold_paths', (i) => {
  editManifest(i, (m) => { m.hold_paths = ['docs/private/**']; });
  i.files.push(file('docs/private/a.md'));
}, 'hold:owner', 'hold-path');
const allowlist = (i) => editManifest(i, (m) => { m.lanes.runner.tier = { default: 'hold', auto: ['src/**'], strong_review: [] }; });
row(30, 'allowlist: docs/a.md is not listed; the report stays', (i) => {
  allowlist(i);
  setFiles(i, file('docs/a.md'), addedFile('.agent-line/reports/sim-1.md'));
}, 'hold:owner', 'not-in-allowlist');
row(31, 'allowlist: src/a/b.go is listed; the report is exempt', (i) => {
  allowlist(i);
  setFiles(i, file('src/a/b.go'), addedFile('.agent-line/reports/sim-1.md'));
}, 'merge', null);
row('31b', 'allowlist: another item report is not exempt', (i) => {
  allowlist(i);
  setFiles(i, file('src/a/b.go'), addedFile('.agent-line/reports/sim-1.md'), addedFile('.agent-line/reports/sim-2.md'));
}, 'hold:owner', 'floor', ['not-in-allowlist']);
row(32, 'path in strong_review', (i) => {
  editManifest(i, (m) => { m.lanes.runner.tier.strong_review = ['docs/**']; });
  i.files.push(file('docs/a.md'));
}, 'hold:strong-review', 'strong-review-path');
row(33, 'a floor path that is also in strong_review', (i) => {
  editManifest(i, (m) => { m.lanes.runner.tier.strong_review = ['.github/**']; });
  i.files.push(file('.github/workflows/ci.yml'));
}, 'hold:owner', 'floor', ['strong-review-path']);
row(34, 'max_changed_lines 150, 150 lines', (i) => {
  editManifest(i, (m) => { m.lanes.runner.max_changed_lines = 150; });
  setFiles(i, file('src/x.go', { added: 100, deleted: 40 }), addedFile('.agent-line/reports/sim-1.md', { added: 10 }));
}, 'merge', null);
row(35, 'max_changed_lines 150, 151 lines', (i) => {
  editManifest(i, (m) => { m.lanes.runner.max_changed_lines = 150; });
  setFiles(i, file('src/x.go', { added: 100, deleted: 40 }), addedFile('.agent-line/reports/sim-1.md', { added: 11 }));
}, 'hold:owner', 'too-large');
row('35b', 'a binary numstat entry counts as 0 lines', (i) => {
  editManifest(i, (m) => { m.lanes.runner.max_changed_lines = 5; });
  setFiles(i, file('src/x.go', { added: 2, deleted: 1 }), file('src/y.dat', { added: null, deleted: null }), addedFile('.agent-line/reports/sim-1.md', { added: 2 }));
}, 'merge', null);
row(36, 'checks none', (i) => { editManifest(i, (m) => { m.checks = 'none'; }); i.checkRuns = []; }, 'hold:owner', 'checks-none');
row('37a', 'no check run', (i) => { i.checkRuns = []; }, 'wait:ci', 'check-missing');
row('37b', 'check run from another app', (i) => { i.checkRuns = [checkRun({ app: { slug: 'other-app' } })]; }, 'wait:ci', 'check-missing');
row('37c', 'check run with another name', (i) => { i.checkRuns = [checkRun({ name: 'Check' })]; }, 'wait:ci', 'check-missing');
row('37d', 'check run without an app', (i) => { i.checkRuns = [checkRun({ app: null })]; }, 'wait:ci', 'check-missing');
row(38, 'check in progress', (i) => { i.checkRuns = [checkRun({ status: 'in_progress', conclusion: null, completed_at: null })]; }, 'wait:ci', 'check-running');
row('38b', 'check queued', (i) => { i.checkRuns = [checkRun({ status: 'queued', conclusion: null, completed_at: null })]; }, 'wait:ci', 'check-running');
row(39, 'check failure', (i) => { i.checkRuns = [checkRun({ conclusion: 'failure' })]; }, 'fix:ci', 'check-failed');
for (const c of ['cancelled', 'timed_out', 'skipped', 'neutral', 'action_required', 'stale', 'startup_failure', null]) {
  row(`40 ${c}`, `check ${c}`, (i) => { i.checkRuns = [checkRun({ conclusion: c })]; }, 'blocked:check', 'check-conclusion');
}
row('41a', 'older failure, newer success', (i) => {
  i.checkRuns = [checkRun({ id: 1, conclusion: 'failure', started_at: '2026-11-10T08:00:00Z' }), checkRun({ id: 2 })];
}, 'merge', null);
row('41b', 'older success, newer failure', (i) => {
  i.checkRuns = [checkRun({ id: 1 }), checkRun({ id: 2, conclusion: 'failure', started_at: '2026-11-10T10:00:00Z' })];
}, 'fix:ci', 'check-failed');
row('41c', 'same start time: the greater id wins', (i) => {
  i.checkRuns = [checkRun({ id: 2 }), checkRun({ id: 3, conclusion: 'failure' })];
}, 'fix:ci', 'check-failed');
row('41d', 'same start time: the greater id wins (success)', (i) => {
  i.checkRuns = [checkRun({ id: 3 }), checkRun({ id: 2, conclusion: 'failure' })];
}, 'merge', null);
row('41e', 'every listed check is required', (i) => {
  editManifest(i, (m) => { m.checks = ['check', 'lint']; });
}, 'wait:ci', 'check-missing');
row('41f', 'a check the manifest does not list is ignored', (i) => {
  i.checkRuns.push(checkRun({ id: 5, name: 'other', conclusion: 'failure' }));
}, 'merge', null);
row(42, 'Codex pending and check failure', (i) => {
  i.codex.comments = [];
  i.checkRuns = [checkRun({ conclusion: 'failure' })];
}, 'wait:codex', 'no-summary', ['check-failed']);
row(43, 'Codex blocking and check failure', (i) => {
  i.codex.comments = [codexSummary({ has_any_findings: true })];
  i.codex.reviewComments = [{ id: 5, user: { id: 199175422, login: 'chatgpt-codex-connector[bot]' }, body: '[P1] bad', commit_id: SHA, original_commit_id: SHA }];
  i.checkRuns = [checkRun({ conclusion: 'failure' })];
}, 'fix:ci', 'check-failed', ['p0-p1']);
row(44, 'base not an ancestor', (i) => { i.baseIsAncestor = false; }, 'update:base', 'base-not-ancestor');
row(45, 'base not an ancestor and check failure', (i) => {
  i.baseIsAncestor = false;
  i.checkRuns = [checkRun({ conclusion: 'failure' })];
}, 'fix:ci', 'check-failed', ['base-not-ancestor']);
row(46, 'mergeable null', (i) => { i.pr.mergeable = null; }, 'wait:mergeable', 'mergeable-unknown');
row('46b', 'mergeable missing', (i) => { delete i.pr.mergeable; }, 'wait:mergeable', 'mergeable-unknown');
row(47, 'mergeable false, base an ancestor', (i) => { i.pr.mergeable = false; }, 'blocked:not-mergeable', 'not-mergeable');
row(48, 'mergeable false, base not an ancestor', (i) => { i.pr.mergeable = false; i.baseIsAncestor = false; }, 'update:base', 'base-not-ancestor');

// Replay.
const replay = (input) => {
  input.asOf = '2026-11-10T12:00:00Z';
  input.pr.state = 'closed';
  input.pr.merged = true;
  input.pr.mergeable = null;
  input.mergeMessage = 'feat: add x (#7)\n\nAuto-Merged-By: test-runner\n';
  input.mergeCommit = 'e'.repeat(40);
};
row(50, 'replay: closed and merged, mergeable null', replay, 'merge', null);
row(51, 'replay: check run started after asOf', (i) => {
  replay(i);
  i.checkRuns = [checkRun({ started_at: '2026-11-10T12:00:01Z' })];
}, 'wait:ci', 'check-missing');
row(52, 'replay: check run completed after asOf', (i) => {
  replay(i);
  i.checkRuns = [checkRun({ completed_at: '2026-11-10T12:30:00Z' })];
}, 'wait:ci', 'check-running');
row('52b', 'replay: check run with completed_at null', (i) => {
  replay(i);
  i.checkRuns = [checkRun({ completed_at: null })];
}, 'wait:ci', 'check-running');
row('52c', 'replay: a failure that started after asOf does not count', (i) => {
  replay(i);
  i.checkRuns = [checkRun({ id: 1 }), checkRun({ id: 2, conclusion: 'failure', started_at: '2026-11-10T13:00:00Z' })];
}, 'merge', null);
row(53, 'replay: no queue branch, merge message has a caller lane marker', (i) => {
  replay(i);
  asCaller(i);
  i.callerLane = null;
  i.mergeMessage = 'feat: x\n\nAuto-Merged-By: test-nightly\n';
}, 'merge', null);
row(54, 'replay: no queue branch, no matching marker', (i) => {
  replay(i);
  asCaller(i);
  i.callerLane = null;
  i.mergeMessage = 'feat: x\n\nAuto-Merged-By: someone-else\n';
}, 'hold:owner', 'no-lane');
row('54b', 'replay: the marker must be a whole line', (i) => {
  replay(i);
  asCaller(i);
  i.callerLane = null;
  i.mergeMessage = 'feat: x\n\nsee Auto-Merged-By: test-nightly here\n';
}, 'hold:owner', 'no-lane');
row('54c', 'replay: the queue lane marker is not a caller lane marker', (i) => {
  replay(i);
  asCaller(i);
  i.callerLane = null;
  i.mergeMessage = 'feat: x\n\nAuto-Merged-By: test-runner\n';
}, 'hold:owner', 'no-lane');
row('54d', 'replay: two caller lanes with one marker give no lane', (i) => {
  replay(i);
  asCaller(i);
  editManifest(i, (m) => { m.lanes.other = { ...m.lanes.nightly }; });
  i.callerLane = null;
  i.mergeMessage = 'feat: x\n\nAuto-Merged-By: test-nightly\n';
}, 'hold:owner', 'no-lane');
row('54e', 'live: the merge message is not read', (i) => {
  asCaller(i);
  i.callerLane = null;
  i.mergeMessage = 'feat: x\n\nAuto-Merged-By: test-nightly\n';
}, 'hold:owner', 'no-lane');
row(55, 'replay: halt issue closed before asOf', (i) => {
  replay(i);
  i.haltIssues = [{ number: 3, createdAt: '2026-11-01T00:00:00Z', closedAt: '2026-11-09T00:00:00Z' }];
}, 'merge', null);
row('55b', 'replay: halt issue opened after asOf', (i) => {
  replay(i);
  i.haltIssues = [{ number: 3, createdAt: '2026-11-11T00:00:00Z', closedAt: null }];
}, 'merge', null);
row('55c', 'replay: halt issue open at asOf and closed later', (i) => {
  replay(i);
  i.haltIssues = [{ number: 3, createdAt: '2026-11-01T00:00:00Z', closedAt: '2026-11-11T00:00:00Z' }];
}, 'wait:halt', 'halt-issue-open');
row('55d', 'replay: promotion open at asOf', (i) => {
  replay(i);
  toPreview(i);
  i.pulls = [{ ...promotion, createdAt: '2026-11-09T00:00:00Z', closedAt: '2026-11-11T00:00:00Z' }];
}, 'wait:freeze', 'promotion-open');
row('55e', 'replay: promotion closed before asOf', (i) => {
  replay(i);
  toPreview(i);
  i.pulls = [{ ...promotion, createdAt: '2026-11-09T00:00:00Z', closedAt: '2026-11-10T00:00:00Z' }];
}, 'merge', null);
row('55f', 'replay: a draft flag of false is taken as given', (i) => { replay(i); i.pr.draft = false; }, 'merge', null);
row('55g', 'replay: base not an ancestor still counts', (i) => { replay(i); i.baseIsAncestor = false; }, 'update:base', 'base-not-ancestor');

// Added rows 58 to 64 (queue form without a queue lane; report exemptions).
const callerOnly = (i) => {
  editManifest(i, (m) => { delete m.lanes.runner; });
  withCaller(i);
  i.files = [file('src/x.go')];
};
row(58, 'queue-form head, manifest without a queue lane, no caller lane', (i) => { callerOnly(i); }, 'hold:owner', 'no-lane');
row(59, 'queue-form head, no queue lane, caller lane passed', (i) => { callerOnly(i); i.callerLane = 'nightly'; }, 'merge', null);
row(60, 'queue-form head, no queue lane, another caller lane passed', (i) => { callerOnly(i); i.callerLane = 'weekly'; }, 'blocked:lane', 'unknown-lane');
row(61, 'replay: queue-form head, no queue lane, marker in the merge message', (i) => {
  replay(i);
  callerOnly(i);
  i.mergeMessage = 'feat: x\n\nAuto-Merged-By: test-nightly\n';
}, 'merge', null);
row(62, 'strong_review pattern does not catch the own report', (i) => {
  editManifest(i, (m) => { m.lanes.runner.tier.strong_review = ['**/*.md']; });
}, 'merge', null);
row(63, 'hold_paths still applies to the own report', (i) => {
  editManifest(i, (m) => { m.hold_paths = ['.agent-line/reports/**']; });
}, 'hold:owner', 'hold-path');
row(64, 'strong_review still catches another file', (i) => {
  editManifest(i, (m) => { m.lanes.runner.tier.strong_review = ['**/*.md']; });
  i.files.push(file('docs/a.md'));
}, 'hold:strong-review', 'strong-review-path');
row('64b', 'allowlist does not hold the own report, but holds docs/a.md only', (i) => {
  allowlist(i);
  i.files.push(file('docs/a.md'));
}, 'hold:owner', 'not-in-allowlist');

// Content rules. The baseline has no content_rules.
const bytesOf = (text) => new TextEncoder().encode(text);
const blob = (text) => ({ state: 'present', size: bytesOf(text).length, bytes: bytesOf(text) });
const rules = (content) => (input) => editManifest(input, (m) => { m.content_rules = content; });
const setContents = (input, path, base, head) => { input.contents = { ...(input.contents ?? {}), [path]: { base: blob(base), head: blob(head) } }; };
const allow = (...patterns) => (input) => editManifest(input, (m) => { m.lanes.runner.tier = { default: 'hold', auto: patterns, strong_review: [] }; });
const KEYS = { keys_only: [{ glob: 'tools/*/config.json', keys: ['version'] }] };
const versionOnly = (input) => {
  rules(KEYS)(input);
  input.files.push(file('tools/a/config.json'));
  setContents(input, 'tools/a/config.json', '{"version":1,"x":1}', '{"version":2,"x":1}');
};

row(65, 'hold_on_add_delete holds an added file that the allowlist allows', (i) => {
  allow('src/**', 'docs/**')(i);
  rules({ hold_on_add_delete: ['docs/**'] })(i);
  i.files.push(addedFile('docs/x.md'));
}, 'hold:owner', 'rule-add-delete');
row('65b', 'a modified file under hold_on_add_delete is not held', (i) => {
  rules({ hold_on_add_delete: ['docs/**'] })(i);
  i.files.push(file('docs/x.md'));
}, 'merge', null);
row(66, 'a content-rule path that is also in hold_paths', (i) => {
  editManifest(i, (m) => { m.hold_paths = ['docs/private/**']; });
  rules({ hold_on_add_delete: ['docs/private/**'] })(i);
  i.files.push(addedFile('docs/private/a.md'));
}, 'hold:owner', 'hold-path', ['rule-add-delete']);
row(67, 'a content-rule path that is a floor path', (i) => {
  rules({ hold_on_add_delete: ['.github/**'] })(i);
  i.files.push(addedFile('.github/ci.yml'));
}, 'hold:owner', 'floor', ['rule-add-delete']);
row(68, 'the own report matched by a content rule it violates', (i) => {
  rules({ hold_on_add_delete: ['.agent-line/reports/**'] })(i);
}, 'hold:owner', 'rule-add-delete');
row(69, 'keys_only with only the named key changed, in the allowlist', (i) => {
  allow('src/**', 'tools/**')(i);
  versionOnly(i);
}, 'merge', null);
row(70, 'keys_only with only the named key changed, outside the allowlist', (i) => {
  allow('src/**')(i);
  versionOnly(i);
}, 'hold:owner', 'not-in-allowlist');
row('70b', 'keys_only with an unnamed key changed, in the allowlist', (i) => {
  allow('src/**', 'tools/**')(i);
  versionOnly(i);
  setContents(i, 'tools/a/config.json', '{"version":1,"x":1}', '{"version":1,"x":2}');
}, 'hold:owner', 'rule-keys');
row(71, 'contents missing for a target', (i) => {
  versionOnly(i);
  delete i.contents;
}, 'blocked:input', 'content-missing');
row('71b', 'a target whose base side is absent although the status is M', (i) => {
  versionOnly(i);
  i.contents['tools/a/config.json'].base = { state: 'absent' };
}, 'blocked:input', 'content-missing');
row('71c', 'a missing target with a hold: blocked comes first', (i) => {
  rules({ ...KEYS, hold_on_add_delete: ['docs/**'] })(i);
  i.files.push(file('tools/a/config.json'), addedFile('docs/x.md'));
}, 'blocked:input', 'content-missing', ['rule-add-delete']);
row('71d', 'contents given for a path that no rule targets are ignored', (i) => {
  setContents(i, 'src/x.go', 'a', 'b');
}, 'merge', null);
row('71e', 'no rule matches: no contents are needed', (i) => {
  rules(KEYS)(i);
}, 'merge', null);
row('75', 'content rules apply in a caller lane', (i) => {
  asCaller(i);
  rules({ hold_on_add_delete: ['src/**'] })(i);
  i.files = [addedFile('src/new.go')];
}, 'hold:owner', 'rule-add-delete');
row('76', 'content rules apply when no lane resolves', (i) => {
  i.pr.headRef = 'feature/x';
  rules({ hold_on_add_delete: ['src/**'] })(i);
  i.files = [addedFile('src/new.go')];
}, 'hold:owner', 'no-lane', ['rule-add-delete']);
row('77', 'a file under hold_on_line_change with a changed Status line', (i) => {
  rules({ hold_on_line_change: [{ glob: 'docs/specs/**', pattern: '^Status:' }] })(i);
  i.files.push(file('docs/specs/a.md'));
  setContents(i, 'docs/specs/a.md', 'Status: draft\nbody\n', 'Status: final\nbody\n');
}, 'hold:owner', 'rule-line-change');
row('77b', 'a file under hold_on_line_change whose body changes only', (i) => {
  rules({ hold_on_line_change: [{ glob: 'docs/specs/**', pattern: '^Status:' }] })(i);
  i.files.push(file('docs/specs/a.md'));
  setContents(i, 'docs/specs/a.md', 'Status: draft\nbody\n', 'Status: draft\nnew body\n');
}, 'merge', null);
row('78', 'a file under front_matter_only whose description changes only', (i) => {
  rules({ front_matter_only: [{ glob: 'docs/guides/**/*.md', keys: ['description'] }] })(i);
  i.files.push(file('docs/guides/a.md'));
  setContents(i, 'docs/guides/a.md', '---\nname: x\ndescription: a\n---\nbody\n', '---\nname: x\ndescription: b\n---\nbody\n');
}, 'merge', null);
row('78b', 'a file under front_matter_only with a malformed front matter', (i) => {
  rules({ front_matter_only: [{ glob: 'docs/guides/**/*.md', keys: ['description'] }] })(i);
  i.files.push(file('docs/guides/a.md'));
  setContents(i, 'docs/guides/a.md', '---\nname: x\n---\nbody\n', '--- \nname: x\n---\nbody\n');
}, 'hold:owner', 'rule-front-matter');

for (const r of rows) {
  test(`verdict ${r.id}: ${r.name}`, () => {
    const input = baseline();
    r.change(input);
    const result = evaluate(input);
    assert.equal(result.verdict, r.verdict);
    if (r.code !== null) {
      assert.equal(result.reasons[0].code, r.code);
      assert.equal(result.reasons[0].verdict, r.verdict);
    } else {
      assert.deepEqual(result.reasons, []);
    }
    const codes = result.reasons.map((x) => x.code);
    for (const c of r.also) assert.ok(codes.includes(c), `${c} is among ${codes.join(',')}`);
    assert.equal(result.headSha, SHA);
    if (r.verdict === 'merge') {
      assert.equal(result.merge.method, 'squash');
      assert.equal(result.merge.expectedHeadSha, SHA);
      assert.match(result.merge.commitMessage, /^Auto-Merged-By: test-(runner|nightly)$/);
      assert.notEqual(result.lane, null);
    } else {
      // 57: merge is null for every non-merge verdict
      assert.equal(result.merge, null);
    }
  });
}

test('verdict 1: merge parameters of the baseline', () => {
  const result = evaluate(baseline());
  assert.deepEqual(result.merge, { method: 'squash', expectedHeadSha: SHA, commitMessage: 'Auto-Merged-By: test-runner' });
  assert.equal(result.lane, 'runner');
  assert.deepEqual(result.codex, { state: 'clean', code: null });
  assert.deepEqual(result.limits, []);
});

test('verdict 16: a caller lane merges with its own marker', () => {
  const result = evaluate(asCaller(baseline()));
  assert.equal(result.lane, 'nightly');
  assert.equal(result.merge.commitMessage, 'Auto-Merged-By: test-nightly');
});

test('verdict 3: the halt reason comes first and every reason is listed', () => {
  const input = baseline();
  input.haltIssues = [halt];
  input.files.push(file('.github/workflows/ci.yml'));
  const result = evaluate(input);
  assert.deepEqual(result.reasons.map((r) => r.verdict), ['wait:halt', 'hold:owner']);
  assert.equal(result.reasons[0].detail, '3');
  assert.equal(result.reasons[1].detail, '.github/workflows/ci.yml');
});

test('verdict 25: the floor reason carries the lowercased path', () => {
  const input = baseline();
  setFiles(input, file('CLAUDE.md', { status: 'D', headMode: null, headHasNul: null }), addedFile('docs/old.md'), addedFile('.agent-line/reports/sim-1.md'));
  assert.equal(evaluate(input).reasons[0].detail, 'claude.md');
});

test('manifest failure returns the halt reasons and the manifest reason only', () => {
  const input = baseline();
  input.manifestText = null;
  input.haltIssues = [halt];
  input.files = [];
  const result = evaluate(input);
  assert.equal(result.verdict, 'wait:halt');
  assert.deepEqual(result.reasons.map((r) => r.code), ['halt-issue-open', 'manifest-missing']);
  assert.equal(result.lane, null);
  assert.deepEqual(result.codex, { state: 'not-evaluated', code: null });
});

test('reasons are sorted by precedence, stable within a class', () => {
  const input = baseline();
  input.pr.draft = true;
  input.pr.mergeable = null;
  input.baseIsAncestor = false;
  input.codex.comments = [];
  input.checkRuns = [checkRun({ conclusion: 'failure' })];
  input.files.push(file('.github/a.yml'));
  input.pr.title = '[FAILED] x';
  const result = evaluate(input);
  assert.deepEqual(result.reasons.map((r) => r.code), [
    'floor', 'draft', 'title-marker', 'no-summary', 'mergeable-unknown', 'check-failed', 'base-not-ancestor',
  ]);
  assert.equal(result.verdict, 'hold:owner');
});

test('wait reasons keep the order ci, codex, mergeable', () => {
  const input = baseline();
  input.pr.mergeable = null;
  input.codex.comments = [];
  input.checkRuns = [];
  const result = evaluate(input);
  assert.deepEqual(result.reasons.map((r) => r.code), ['check-missing', 'no-summary', 'mergeable-unknown']);
  assert.equal(result.verdict, 'wait:ci');
});

test('blocked reasons keep the section order', () => {
  const input = baseline();
  input.pr.state = 'closed';
  input.files.push(file('x�', { pathBytesOk: false }));
  input.codex.comments = [codexSummary({ status: 'failed' })];
  input.checkRuns = [checkRun({ conclusion: 'cancelled' })];
  const result = evaluate(input);
  assert.deepEqual(result.reasons.map((r) => r.code), ['not-open', 'path-encoding', 'check-conclusion', 'review-status']);
  assert.equal(result.verdict, 'blocked:not-open');
});

test('lane-dependent conditions are skipped when there is no lane, the others still run', () => {
  const input = baseline();
  input.pr.headRef = 'feature/x';
  input.pr.baseRef = 'release';
  input.pr.draft = true;
  setFiles(input, file('src/x.go'), file('.github/a.yml'));
  const result = evaluate(input);
  assert.deepEqual(result.reasons.map((r) => r.code), ['no-lane', 'floor', 'draft']);
  assert.equal(result.lane, null);
});

test('a blocked lane skips the lane-dependent conditions', () => {
  const input = baseline();
  input.pr.headRef = 'feature/x';
  input.callerLane = 'nightly';
  input.pr.baseRef = 'release';
  setFiles(input, file('src/x.go'));
  const result = evaluate(input);
  assert.deepEqual(result.reasons.map((r) => r.code), ['unknown-lane']);
  assert.equal(result.lane, null);
});

test('the freeze applies only to the lane that declares it', () => {
  const input = baseline();
  input.pulls = [promotion];
  assert.equal(evaluate(input).verdict, 'merge');
});

test('title markers work anywhere in the title, in any case', () => {
  const input = baseline();
  input.pr.title = 'a [Needs-Decision] b';
  assert.equal(evaluate(input).reasons[0].code, 'title-marker');
});

test('verdict 49: every Codex state under both modes', () => {
  const comment = { id: 5, user: { id: 199175422, login: 'chatgpt-codex-connector[bot]' }, commit_id: SHA, original_commit_id: SHA };
  const cases = [
    { name: 'no summary', set: (i) => { i.codex.comments = []; }, nb: 'wait:codex', nf: 'wait:codex' },
    { name: 'stale', set: (i) => { i.codex.comments = [codexSummary({ commit_sha: 'f'.repeat(40) })]; }, nb: 'wait:codex', nf: 'wait:codex' },
    { name: 'running', set: (i) => { i.codex.comments = [codexSummary({ status: 'running' })]; }, nb: 'wait:codex', nf: 'wait:codex' },
    { name: 'error', set: (i) => { i.codex.comments = [codexSummary({ status: 'failed' })]; }, nb: 'blocked:codex', nf: 'blocked:codex' },
    { name: 'unclassified', set: (i) => {
      i.codex.comments = [codexSummary({ has_any_findings: true })];
      i.codex.reviewComments = [{ ...comment, body: 'Unknown' }];
    }, nb: 'blocked:codex', nf: 'fix:codex' },
    { name: 'unverified', set: (i) => { i.codex.comments = [codexSummary({ has_any_findings: true })]; }, nb: 'blocked:codex', nf: 'fix:codex' },
    { name: 'blocking', set: (i) => {
      i.codex.comments = [codexSummary({ has_any_findings: true })];
      i.codex.reviewComments = [{ ...comment, body: '[P0] x' }];
    }, nb: 'fix:codex', nf: 'fix:codex' },
    { name: 'advisory', set: (i) => {
      i.codex.comments = [codexSummary({ has_any_findings: true, has_unresolved_findings: true })];
      i.codex.reviewComments = [{ ...comment, body: '[P2] x' }];
    }, nb: 'merge', nf: 'fix:codex' },
    { name: 'clean', set: () => {}, nb: 'merge', nf: 'merge' },
    { name: 'clean, security review running', set: (i) => { i.codex.comments = [codexSummary({}, { status: 'running' })]; }, nb: 'merge', nf: 'wait:codex' },
    { name: 'clean, security review with findings', set: (i) => {
      i.codex.comments = [codexSummary({}, { status: 'completed', has_any_findings: true })];
    }, nb: 'merge', nf: 'fix:codex' },
    { name: 'clean, security review completed', set: (i) => {
      i.codex.comments = [codexSummary({}, { status: 'completed', has_any_findings: false })];
    }, nb: 'merge', nf: 'merge' },
    { name: 'changes requested', set: (i) => {
      i.codex.reviews = [{ id: 8, user: { id: 199175422, login: 'chatgpt-codex-connector[bot]' }, state: 'CHANGES_REQUESTED', body: '', commit_id: SHA }];
    }, nb: 'fix:codex', nf: 'fix:codex' },
  ];
  for (const c of cases) {
    for (const [mode, key] of [['no_blocking', 'nb'], ['no_findings', 'nf']]) {
      const input = baseline();
      editManifest(input, (m) => { m.codex_clean = mode; });
      c.set(input);
      assert.equal(evaluate(input).verdict, c[key], `${c.name} under ${mode}`);
    }
  }
});

test('Codex state is reported in the verdict', () => {
  const input = baseline();
  input.codex.comments = [];
  assert.deepEqual(evaluate(input).codex, { state: 'pending', code: 'no-summary' });
});

test('replay: an edited Codex summary adds a limit', () => {
  const input = baseline();
  replay(input);
  input.codex.comments = [codexSummary({}, undefined, { updated_at: '2026-11-11T00:00:00Z' })];
  input.limits = ['halt-label-timing'];
  const result = evaluate(input);
  assert.equal(result.verdict, 'merge');
  assert.deepEqual(result.limits, ['halt-label-timing', 'codex-edited-after-merge']);
});

test('replay: a Codex finding created after asOf is ignored', () => {
  const input = baseline();
  replay(input);
  input.codex.comments = [codexSummary({ has_any_findings: true })];
  input.codex.reviewComments = [{ id: 5, user: { id: 199175422, login: 'chatgpt-codex-connector[bot]' }, body: '[P1] x', commit_id: SHA, original_commit_id: SHA, created_at: '2026-11-10T13:00:00Z' }];
  // The summary says findings exist, none are visible as of asOf.
  assert.equal(evaluate(input).reasons[0].code, 'findings-unverified');
});

test('verdict 56: evaluate does not mutate its input and is deterministic', () => {
  for (const make of [baseline, () => { const i = baseline(); replay(i); return i; }, () => asCaller(baseline())]) {
    const input = deepFreeze(make());
    const copy = structuredClone(input);
    const first = evaluate(input);
    const second = evaluate(input);
    assert.deepEqual(first, second);
    assert.deepEqual(input, copy);
  }
});

test('an input with another schema is rejected', () => {
  const input = baseline();
  input.schema = 2;
  assert.throws(() => evaluate(input));
});

test('the baseline files and manifest are valid for the documented baseline', () => {
  const input = baseline();
  assert.equal(JSON.parse(input.manifestText).lanes.runner.marker, 'Auto-Merged-By: test-runner');
  assert.equal(input.baseSha, BASE_SHA);
  assert.deepEqual(baselineManifest().hold_paths, []);
});

test('verdict 72: replay with content rules gives the same verdict and reasons as live', () => {
  const scenarios = [
    (i) => { allow('src/**', 'tools/**')(i); versionOnly(i); },
    (i) => { allow('src/**', 'tools/**')(i); versionOnly(i); setContents(i, 'tools/a/config.json', '{"version":1,"x":1}', '{"version":1,"x":9}'); },
    (i) => { rules({ hold_on_add_delete: ['docs/**'] })(i); i.files.push(addedFile('docs/x.md')); },
    (i) => { versionOnly(i); delete i.contents; },
  ];
  for (const make of scenarios) {
    const live = baseline();
    make(live);
    const replayed = structuredClone(live);
    replay(replayed);
    replayed.asOf = '2026-11-10T12:00:00Z';
    const a = evaluate(live);
    const b = evaluate(replayed);
    assert.equal(b.verdict, a.verdict);
    assert.deepEqual(b.reasons, a.reasons);
  }
});

test('verdict 74: content reasons follow other reasons for each entry, and too-large follows all entries', () => {
  const input = baseline();
  editManifest(input, (m) => {
    m.hold_paths = ['docs/b.md'];
    m.lanes.runner.tier = { default: 'hold', auto: ['src/**'], strong_review: [] };
    m.lanes.runner.max_changed_lines = 3;
    m.content_rules = {
      hold_on_add_delete: ['docs/**'],
      hold_on_line_change: [{ glob: 'docs/**', pattern: '^Status:' }],
    };
  });
  input.files = [
    addedFile('docs/a.md', { added: 5 }),
    file('docs/b.md', { status: 'D', headMode: null, headHasNul: null, added: 0, deleted: 2 }),
    addedFile('.agent-line/reports/sim-1.md', { added: 1 }),
  ];
  input.contents = {
    'docs/a.md': { base: { state: 'absent' }, head: blob('Status: new\n') },
    'docs/b.md': { base: blob('plain\n'), head: { state: 'absent' } },
  };
  const result = evaluate(input);
  assert.deepEqual(result.reasons, [
    { verdict: 'hold:owner', code: 'not-in-allowlist', detail: 'docs/a.md' },
    { verdict: 'hold:owner', code: 'rule-add-delete', detail: 'docs/a.md: added' },
    { verdict: 'hold:owner', code: 'rule-line-change', detail: 'docs/a.md: line-changed' },
    { verdict: 'hold:owner', code: 'hold-path', detail: 'docs/b.md' },
    { verdict: 'hold:owner', code: 'not-in-allowlist', detail: 'docs/b.md' },
    { verdict: 'hold:owner', code: 'rule-add-delete', detail: 'docs/b.md: deleted' },
    { verdict: 'hold:owner', code: 'too-large', detail: '8 > 3' },
  ]);
});

test('verdict 73: with content rules, evaluate does not mutate its input and is deterministic', () => {
  const make = () => {
    const i = baseline();
    allow('src/**', 'tools/**', 'docs/**')(i);
    rules({ ...KEYS, hold_on_add_delete: ['docs/**'], hold_on_line_change: [{ glob: 'docs/**', pattern: '^Status:' }] })(i);
    i.files.push(file('tools/a/config.json'), file('docs/s.md'));
    setContents(i, 'tools/a/config.json', '{"version":1,"x":1}', '{"version":2,"x":2}');
    setContents(i, 'docs/s.md', 'Status: a\n', 'Status: b\n');
    return i;
  };
  for (const input of [deepFreeze(make()), (() => { const i = make(); replay(i); return deepFreeze(i); })()]) {
    const copy = structuredClone(input);
    const first = evaluate(input);
    const second = evaluate(input);
    assert.deepEqual(first, second);
    assert.deepEqual(input, copy);
    assert.deepEqual(first.reasons.map((r) => r.code), ['rule-keys', 'rule-line-change']);
  }
});

test('no reason of a content rule carries file text', () => {
  const input = baseline();
  rules({ hold_on_line_change: [{ glob: 'docs/**', pattern: 'SECRET-TEXT' }], keys_only: [{ glob: 'docs/*.json', keys: ['v'] }] })(input);
  input.files.push(file('docs/a.md'), file('docs/b.json'));
  setContents(input, 'docs/a.md', 'SECRET-TEXT one\n', 'SECRET-TEXT two\n');
  setContents(input, 'docs/b.json', '{"SECRET-TEXT":1}', '{"SECRET-TEXT":2}');
  const result = evaluate(input);
  assert.deepEqual(result.reasons.map((r) => r.code), ['rule-line-change', 'rule-line-change', 'rule-keys']);
  assert.ok(!JSON.stringify(result).includes('SECRET-TEXT'));
});
