import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readCodexState, codexReason } from '../../src/core/codex.js';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const BOT = { id: 199175422, login: 'chatgpt-codex-connector[bot]' };
const SUMMARY_MARKER = '<!-- codex-pull-request-review-summary -->';
const RECEIPT_MARKER = '<!-- codex-review-receipt:v1 -->';

const summary = (review = {}, extra = {}, security) => ({
  id: 1,
  user: BOT,
  body: `${SUMMARY_MARKER}\n<!-- codex-review-state:v1 ${JSON.stringify({
    code_review: { commit_sha: SHA, status: 'completed', has_any_findings: false, has_unresolved_findings: false, ...review },
    ...(security === undefined ? {} : { security_review: security }),
  })} -->`,
  created_at: '2026-11-10T10:00:00Z',
  updated_at: '2026-11-10T10:00:00Z',
  ...extra,
});
const finding = (body, extra = {}) => ({
  id: 10,
  user: BOT,
  body,
  commit_id: SHA,
  original_commit_id: SHA,
  created_at: '2026-11-10T10:01:00Z',
  updated_at: '2026-11-10T10:01:00Z',
  ...extra,
});
const review = (body, state = 'COMMENTED', extra = {}) => ({
  id: 20,
  user: BOT,
  body,
  state,
  commit_id: SHA,
  submitted_at: '2026-11-10T10:02:00Z',
  ...extra,
});
const read = (over = {}) => readCodexState({
  headSha: SHA, comments: [summary()], reviewComments: [], reviews: [], asOf: null, ...over,
});
const flagged = { has_any_findings: true, has_unresolved_findings: true };

const rows = [
  { id: 'C1', name: 'completed review of the head', over: {}, state: 'clean', code: null },
  { id: 'C2a', name: 'no summary', over: { comments: [] }, state: 'pending', code: 'no-summary' },
  { id: 'C2b', name: 'running', over: { comments: [summary({ status: 'running' })] }, state: 'pending', code: 'review-incomplete' },
  { id: 'C2c', name: 'summary for another SHA', over: { comments: [summary({ commit_sha: OTHER })] }, state: 'pending', code: 'stale-review' },
  { id: 'C3a', name: 'marker copied by a user with another id',
    over: { comments: [{ ...summary(), user: { id: 123, login: BOT.login } }] }, state: 'pending', code: 'no-summary' },
  { id: 'C3b', name: 'right id, another login',
    over: { comments: [{ ...summary(), user: { id: BOT.id, login: 'someone-else' } }] }, state: 'pending', code: 'no-summary' },
  { id: 'C3c', name: 'no user at all', over: { comments: [{ ...summary(), user: undefined }] }, state: 'pending', code: 'no-summary' },
  { id: 'C4a', name: 'two summaries', over: { comments: [summary(), summary({}, { id: 2 })] }, state: 'error', code: 'ambiguous-summaries' },
  { id: 'C4b', name: 'summary without a state marker',
    over: { comments: [{ id: 1, user: BOT, body: `${SUMMARY_MARKER} broken` }] }, state: 'error', code: 'unsupported-format' },
  { id: 'C4c', name: 'two state markers',
    over: { comments: [{ id: 1, user: BOT, body: `${summary().body}\n${summary().body}` }] }, state: 'error', code: 'unsupported-format' },
  { id: 'C4d', name: 'state marker with invalid JSON',
    over: { comments: [{ id: 1, user: BOT, body: `${SUMMARY_MARKER}<!-- codex-review-state:v1 { -->` }] }, state: 'error', code: 'invalid-state' },
  { id: 'C4e', name: 'state JSON null',
    over: { comments: [{ id: 1, user: BOT, body: `${SUMMARY_MARKER}<!-- codex-review-state:v1 null -->` }] }, state: 'error', code: 'invalid-state' },
  { id: 'C4f', name: 'no code_review',
    over: { comments: [{ id: 1, user: BOT, body: `${SUMMARY_MARKER}<!-- codex-review-state:v1 {} -->` }] }, state: 'error', code: 'invalid-state' },
  { id: 'C4g', name: 'commit_sha not a string', over: { comments: [summary({ commit_sha: 5 })] }, state: 'error', code: 'invalid-state' },
  { id: 'C5a', name: 'has_any_findings as a string', over: { comments: [summary({ has_any_findings: 'false' })] }, state: 'error', code: 'invalid-findings-state' },
  { id: 'C5b', name: 'unresolved without any', over: { comments: [summary({ has_unresolved_findings: true })] }, state: 'error', code: 'invalid-findings-state' },
  { id: 'C5c', name: 'has_unresolved_findings missing',
    over: { comments: [summary({ has_unresolved_findings: undefined })] }, state: 'error', code: 'invalid-findings-state' },
  { id: 'C6a', name: 'P0 title', over: { comments: [summary({ has_any_findings: true })], reviewComments: [finding('**[P0] Fix this**')] }, state: 'blocking', code: 'p0-p1' },
  { id: 'C6b', name: 'P1 title', over: { comments: [summary({ has_any_findings: true })], reviewComments: [finding('**[P1] Fix this**')] }, state: 'blocking', code: 'p0-p1' },
  { id: 'C7', name: 'P2 badge and P3 label, unresolved',
    over: { comments: [summary(flagged)], reviewComments: [finding('![P2 Badge](url) Optional'), finding('[P3] Nit', { id: 11 })] }, state: 'advisory', code: null },
  { id: 'C8a', name: 'any findings but none found', over: { comments: [summary({ has_any_findings: true })] }, state: 'error', code: 'findings-unverified' },
  { id: 'C8b', name: 'finding with unknown priority',
    over: { comments: [summary({ has_any_findings: true })], reviewComments: [finding('Unknown priority')] }, state: 'error', code: 'finding-unclassified' },
  { id: 'C9', name: 'old finding remapped to the head',
    over: { reviewComments: [finding('[P1] Old issue', { original_commit_id: OTHER, commit_id: SHA })] }, state: 'clean', code: null },
  { id: 'C10a', name: 'P1 by a human', over: { reviewComments: [finding('[P1]', { user: { id: 1, login: 'x' } })] }, state: 'clean', code: null },
  { id: 'C10b', name: 'P1 as a bot reply', over: { reviewComments: [finding('[P1]', { in_reply_to_id: 1 })] }, state: 'clean', code: null },
  { id: 'C11a', name: 'P2 badge title with prose about P1',
    over: { comments: [summary(flagged)], reviewComments: [finding('**<sub><sub>![P2 Badge](https://example.test/P2)</sub></sub> Advisory**\n\nThis explains the P1 policy.')] }, state: 'advisory', code: null },
  { id: 'C11b', name: '[P3] title with P0 in the body',
    over: { comments: [summary(flagged)], reviewComments: [finding('[P3] Advisory\nP0 is discussed here.')] }, state: 'advisory', code: null },
  { id: 'C11c', name: '[P4] title',
    over: { comments: [summary(flagged)], reviewComments: [finding('[P4] Unknown\nThis mentions P2.')] }, state: 'error', code: 'finding-unclassified' },
  { id: 'C11d', name: 'unclassified title with [P2] in the body',
    over: { comments: [summary(flagged)], reviewComments: [finding('Unclassified\n[P2] Quoted explanation')] }, state: 'error', code: 'finding-unclassified' },
  { id: 'C11e', name: 'label glued to text', over: { comments: [summary(flagged)], reviewComments: [finding('[P1]foo')] }, state: 'error', code: 'finding-unclassified' },
  { id: 'C12a', name: 'review body [P1] (COMMENTED)', over: { reviews: [review('[P1] Fix')] }, state: 'blocking', code: 'p0-p1' },
  { id: 'C12b', name: 'empty body with CHANGES_REQUESTED', over: { reviews: [review('', 'CHANGES_REQUESTED')] }, state: 'blocking', code: 'changes-requested' },
  { id: 'C13', name: 'review body P2 title with prose about P1',
    over: { comments: [summary(flagged)], reviews: [review('[P2] Advisory\nThis discusses P1 blocking.')] }, state: 'advisory', code: null },
  { id: 'C14a', name: 'advisory inline plus review body [P4]',
    over: { comments: [summary({ has_any_findings: true })], reviewComments: [finding('[P2] Advisory')], reviews: [review('[P4] Unknown priority')] }, state: 'error', code: 'finding-unclassified' },
  { id: 'C14b', name: 'advisory inline plus unclassified review body',
    over: { comments: [summary({ has_any_findings: true })], reviewComments: [finding('[P2] Advisory')], reviews: [review('Unclassified finding')] }, state: 'error', code: 'finding-unclassified' },
  { id: 'C14c', name: 'advisory inline plus review body [P2] then [P4]',
    over: { comments: [summary({ has_any_findings: true })], reviewComments: [finding('[P2] Advisory')], reviews: [review('[P2] Advisory\n[P4] Unknown priority')] }, state: 'error', code: 'finding-unclassified' },
  { id: 'C15', name: 'bulleted review body P1 with an advisory inline finding',
    over: { comments: [summary({ has_any_findings: true })], reviewComments: [finding('[P2] Advisory')], reviews: [review('- [P1] Blocking finding')] }, state: 'blocking', code: 'p0-p1' },
  { id: 'C16', name: 'review body with only the receipt marker and boilerplate',
    over: { reviews: [review(`${RECEIPT_MARKER}\n### Codex Review\nReviewed commit: abc`)] }, state: 'clean', code: null },
  { id: 'C17a', name: 'status failed', over: { comments: [summary({ status: 'failed' })] }, state: 'error', code: 'review-status' },
  { id: 'C17b', name: 'status cancelled', over: { comments: [summary({ status: 'cancelled' })] }, state: 'error', code: 'review-status' },
  { id: 'C17c', name: 'status unexpected', over: { comments: [summary({ status: 'unexpected' })] }, state: 'error', code: 'review-status' },
  { id: 'C17d', name: 'status null', over: { comments: [summary({ status: null })] }, state: 'error', code: 'review-status' },
  { id: 'C18', name: 'finding on the head without original_commit_id',
    over: { reviewComments: [finding('[P2] x', { original_commit_id: undefined })] }, state: 'error', code: 'finding-missing-original-commit' },
  { id: 'C18b', name: 'a reply without original_commit_id is ignored',
    over: { reviewComments: [finding('[P2] x', { original_commit_id: undefined, in_reply_to_id: 3 })] }, state: 'clean', code: null },
  { id: 'C19a', name: 'status pending', over: { comments: [summary({ status: 'pending' })] }, state: 'pending', code: 'review-incomplete' },
  { id: 'C19b', name: 'status queued', over: { comments: [summary({ status: 'queued' })] }, state: 'pending', code: 'review-incomplete' },
  { id: 'C20a', name: 'review in state PENDING with [P1]', over: { reviews: [review('[P1] Fix', 'PENDING')] }, state: 'clean', code: null },
  { id: 'C20b', name: 'review on another commit', over: { reviews: [review('[P1] Fix', 'COMMENTED', { commit_id: OTHER })] }, state: 'clean', code: null },
  { id: 'C20c', name: 'review by a human', over: { reviews: [review('[P1] Fix', 'COMMENTED', { user: { id: 5, login: 'x' } })] }, state: 'clean', code: null },
  { id: 'C21', name: 'CHANGES_REQUESTED with no summary', over: { comments: [], reviews: [review('', 'CHANGES_REQUESTED')] }, state: 'blocking', code: 'changes-requested' },
  { id: 'C21b', name: 'CHANGES_REQUESTED over an error state',
    over: { comments: [summary({ status: 'failed' })], reviews: [review('', 'CHANGES_REQUESTED')] }, state: 'blocking', code: 'changes-requested' },
  { id: 'C21c', name: 'CHANGES_REQUESTED on another commit', over: { reviews: [review('', 'CHANGES_REQUESTED', { commit_id: OTHER })] }, state: 'clean', code: null },
  { id: 'C21d', name: 'CHANGES_REQUESTED by a human', over: { reviews: [review('', 'CHANGES_REQUESTED', { user: { id: 5, login: 'x' } })] }, state: 'clean', code: null },
  { id: 'C25a', name: 'empty review body', over: { reviews: [review('')] }, state: 'clean', code: null },
  { id: 'C25b', name: 'whitespace-only review body', over: { reviews: [review('  \t ')] }, state: 'clean', code: null },
  { id: 'C25c', name: 'newlines-only review body', over: { reviews: [review('\n\n \n')] }, state: 'clean', code: null },
  { id: 'C25d', name: 'null review body', over: { reviews: [review(null)] }, state: 'clean', code: null },
  { id: 'C26', name: 'a non-empty review body without a label is one finding',
    over: { comments: [summary({ has_any_findings: true })], reviews: [review('Looks fine to me')] }, state: 'error', code: 'finding-unclassified' },
];

for (const row of rows) {
  test(`${row.id}: ${row.name}`, () => {
    const result = read(row.over);
    assert.equal(result.state, row.state);
    assert.equal(result.code, row.code);
  });
}

test('a clean result carries the flags and the security review', () => {
  const security = { commit_sha: null, has_any_findings: null, has_unresolved_findings: null, status: null };
  const result = read({ comments: [summary({}, {}, security)] });
  assert.deepEqual(result, {
    state: 'clean',
    code: null,
    hasAnyFindings: false,
    hasUnresolvedFindings: false,
    securityReview: security,
    editedAfterAsOf: false,
  });
});

test('an error before the state is read has null flags', () => {
  const result = read({ comments: [] });
  assert.equal(result.hasAnyFindings, null);
  assert.equal(result.hasUnresolvedFindings, null);
  assert.equal(result.securityReview, null);
});

// Replay.
const AS_OF = '2026-11-10T12:00:00Z';

test('C22: a P1 finding created after asOf is ignored', () => {
  const late = finding('[P1] Fix', { created_at: '2026-11-10T13:00:00Z' });
  const result = read({ asOf: AS_OF, reviewComments: [late] });
  assert.equal(result.state, 'clean');
  const live = read({ reviewComments: [late] });
  assert.equal(live.state, 'blocking');
});

test('C22b: a review submitted after asOf is ignored', () => {
  const late = review('', 'CHANGES_REQUESTED', { submitted_at: '2026-11-10T13:00:00Z' });
  assert.equal(read({ asOf: AS_OF, reviews: [late] }).state, 'clean');
});

test('C22c: a summary created after asOf is ignored', () => {
  const late = summary({}, { created_at: '2026-11-10T13:00:00Z', updated_at: '2026-11-10T13:00:00Z' });
  const result = read({ asOf: AS_OF, comments: [late] });
  assert.equal(result.state, 'pending');
  assert.equal(result.code, 'no-summary');
});

test('C23: a trusted summary updated after asOf sets editedAfterAsOf', () => {
  const edited = summary({}, { created_at: '2026-11-10T10:00:00Z', updated_at: '2026-11-10T13:00:00Z' });
  const result = read({ asOf: AS_OF, comments: [edited] });
  assert.equal(result.state, 'clean');
  assert.equal(result.editedAfterAsOf, true);
  assert.equal(read({ asOf: AS_OF }).editedAfterAsOf, false);
  assert.equal(read({ comments: [edited] }).editedAfterAsOf, false);
});

test('C23b: a trusted review comment edited after asOf sets editedAfterAsOf', () => {
  const edited = finding('[P2] x', { updated_at: '2026-11-10T13:00:00Z' });
  const result = read({ asOf: AS_OF, comments: [summary(flagged)], reviewComments: [edited] });
  assert.equal(result.editedAfterAsOf, true);
});

test('C23c: an untrusted comment edited after asOf does not set editedAfterAsOf', () => {
  const human = { id: 9, user: { id: 5, login: 'x' }, body: 'hi', created_at: '2026-11-10T10:00:00Z', updated_at: '2026-11-10T13:00:00Z' };
  assert.equal(read({ asOf: AS_OF, comments: [summary(), human] }).editedAfterAsOf, false);
});

test('C23d: a trusted item with an unreadable timestamp is kept and flagged in replay', () => {
  const odd = summary({}, { created_at: 'garbage', updated_at: 'garbage' });
  const result = read({ asOf: AS_OF, comments: [odd] });
  assert.equal(result.state, 'clean');
  assert.equal(result.editedAfterAsOf, true);
});

// C24: fixtures shaped after real output.
const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/codex/${name}.json`, import.meta.url), 'utf8'));
for (const row of [
  { name: 'clean', state: 'clean' },
  { name: 'advisory', state: 'advisory' },
  { name: 'blocking', state: 'blocking' },
]) {
  test(`C24: fixture ${row.name}`, () => {
    const f = fixture(row.name);
    const result = readCodexState({
      headSha: f.headSha, comments: f.comments, reviewComments: f.reviewComments, reviews: f.reviews, asOf: null,
    });
    assert.equal(result.state, row.state);
  });
}

// codexReason: every cell of the design's mapping table.
const st = (state, code = null, extra = {}) => ({
  state, code, hasAnyFindings: null, hasUnresolvedFindings: null, securityReview: null, editedAfterAsOf: false, ...extra,
});

const reasonRows = [
  { name: 'pending no-summary', s: st('pending', 'no-summary'), nb: ['wait:codex', 'no-summary'], nf: ['wait:codex', 'no-summary'] },
  { name: 'pending stale-review', s: st('pending', 'stale-review'), nb: ['wait:codex', 'stale-review'], nf: ['wait:codex', 'stale-review'] },
  { name: 'pending review-incomplete', s: st('pending', 'review-incomplete'), nb: ['wait:codex', 'review-incomplete'], nf: ['wait:codex', 'review-incomplete'] },
  { name: 'error ambiguous-summaries', s: st('error', 'ambiguous-summaries'), nb: ['blocked:codex', 'ambiguous-summaries'], nf: ['blocked:codex', 'ambiguous-summaries'] },
  { name: 'error unsupported-format', s: st('error', 'unsupported-format'), nb: ['blocked:codex', 'unsupported-format'], nf: ['blocked:codex', 'unsupported-format'] },
  { name: 'error invalid-state', s: st('error', 'invalid-state'), nb: ['blocked:codex', 'invalid-state'], nf: ['blocked:codex', 'invalid-state'] },
  { name: 'error review-status', s: st('error', 'review-status'), nb: ['blocked:codex', 'review-status'], nf: ['blocked:codex', 'review-status'] },
  { name: 'error invalid-findings-state', s: st('error', 'invalid-findings-state'), nb: ['blocked:codex', 'invalid-findings-state'], nf: ['blocked:codex', 'invalid-findings-state'] },
  { name: 'error finding-missing-original-commit', s: st('error', 'finding-missing-original-commit'), nb: ['blocked:codex', 'finding-missing-original-commit'], nf: ['blocked:codex', 'finding-missing-original-commit'] },
  { name: 'error finding-unclassified', s: st('error', 'finding-unclassified'), nb: ['blocked:codex', 'finding-unclassified'], nf: ['fix:codex', 'finding-unclassified'] },
  { name: 'error findings-unverified', s: st('error', 'findings-unverified'), nb: ['blocked:codex', 'findings-unverified'], nf: ['fix:codex', 'findings-unverified'] },
  { name: 'blocking p0-p1', s: st('blocking', 'p0-p1'), nb: ['fix:codex', 'p0-p1'], nf: ['fix:codex', 'p0-p1'] },
  { name: 'blocking changes-requested', s: st('blocking', 'changes-requested'), nb: ['fix:codex', 'changes-requested'], nf: ['fix:codex', 'changes-requested'] },
  { name: 'advisory', s: st('advisory'), nb: null, nf: ['fix:codex', 'finding-present'] },
  { name: 'clean', s: st('clean'), nb: null, nf: null },
];

for (const row of reasonRows) {
  for (const [mode, key] of [['no_blocking', 'nb'], ['no_findings', 'nf']]) {
    test(`codexReason ${row.name} under ${mode}`, () => {
      const reason = codexReason(row.s, mode);
      if (row[key] === null) {
        assert.equal(reason, null);
      } else {
        assert.equal(reason.verdict, row[key][0]);
        assert.equal(reason.code, row[key][1]);
      }
    });
  }
}

const doneNoFindings = { status: 'completed', has_any_findings: false };
const securityRows = [
  { name: 'absent', sec: null, nf: null },
  { name: 'undefined', sec: undefined, nf: null },
  { name: 'status null', sec: { status: null, has_any_findings: null }, nf: null },
  { name: 'running', sec: { status: 'running' }, nf: ['wait:codex', 'security-review-incomplete'] },
  { name: 'pending', sec: { status: 'pending' }, nf: ['wait:codex', 'security-review-incomplete'] },
  { name: 'queued', sec: { status: 'queued' }, nf: ['wait:codex', 'security-review-incomplete'] },
  { name: 'failed', sec: { status: 'failed' }, nf: ['blocked:codex', 'security-review-status'] },
  { name: 'completed with findings', sec: { status: 'completed', has_any_findings: true }, nf: ['fix:codex', 'security-findings'] },
  { name: 'completed, findings flag null', sec: { status: 'completed', has_any_findings: null }, nf: ['fix:codex', 'security-findings'] },
  { name: 'completed, findings flag missing', sec: { status: 'completed' }, nf: ['fix:codex', 'security-findings'] },
  { name: 'completed, findings flag a string', sec: { status: 'completed', has_any_findings: 'false' }, nf: ['fix:codex', 'security-findings'] },
  { name: 'completed without findings', sec: doneNoFindings, nf: null },
  { name: 'a non-object value', sec: 'completed', nf: ['blocked:codex', 'security-review-status'] },
  { name: 'a numeric status', sec: { status: 5 }, nf: ['blocked:codex', 'security-review-status'] },
];

for (const row of securityRows) {
  test(`codexReason security review ${row.name}: no_findings`, () => {
    const reason = codexReason(st('clean', null, { securityReview: row.sec }), 'no_findings');
    if (row.nf === null) assert.equal(reason, null);
    else assert.deepEqual([reason.verdict, reason.code], row.nf);
  });
  test(`codexReason security review ${row.name}: ignored under no_blocking`, () => {
    assert.equal(codexReason(st('clean', null, { securityReview: row.sec }), 'no_blocking'), null);
  });
}

test('codexReason rejects an unknown mode', () => {
  assert.throws(() => codexReason(st('clean'), 'strict'));
});
