// The verdict function (design sections 3 to 5).
// Pure: no I/O, no clock, no randomness, no environment reads. It never
// mutates its input.
import {
  ACTIONS_APP_SLUG, FLOOR, QUEUE_BRANCH, REPORT_DIR, VERDICT_ORDER,
} from './constants.js';
import { matches } from './glob.js';
import { evaluateContentRules } from './content.js';
import { parseManifest } from './manifest.js';
import { readMergeField } from './queue.js';
import { readCodexState, codexReason } from './codex.js';

/**
 * @typedef {object} GateInput
 * @property {1} schema
 * @property {string} repo                 'owner/name'; compared case-insensitively
 * @property {string|null} manifestText    raw manifest text; null if the file does not exist
 * @property {string|null} callerLane      lane passed by a procedure call; null otherwise
 * @property {string|null} asOf            ISO 8601 UTC merge time for replay; null for live
 * @property {PullFacts} pr
 * @property {FileChange[]} files          merge-base..head, from git
 * @property {string} baseSha              live: tip of pr.baseRef; replay: first parent of the merge commit
 * @property {boolean} baseIsAncestor
 * @property {string|null} [queueItemText] present only when headRef matches QUEUE_BRANCH; null if the file is absent at baseSha; the core reads it only when the lane is the queue lane
 * @property {Record<string, {base: ContentSide, head: ContentSide}>} [contents]
 *           keyed by the diff path; present exactly for the paths contentTargets(manifest, files) returns (design 5.4.1)
 * @property {object[]} checkRuns          REST check runs on headSha: id, name, app.slug, status, conclusion, started_at, completed_at
 * @property {{comments: object[], reviewComments: object[], reviews: object[]}} codex
 *           REST issue comments (id, user.id, user.login, body, created_at, updated_at),
 *           review comments (+ commit_id, original_commit_id, in_reply_to_id),
 *           reviews (id, user, body, state, commit_id, submitted_at)
 * @property {{number: number, createdAt: string, closedAt: string|null}[]} haltIssues
 *           live: the open issues carrying HALT_LABEL; replay: those carrying it now, any state
 * @property {{number: number, headRef: string, headRepo: string, baseRef: string, createdAt: string, closedAt: string|null}[]} pulls
 *           live: open pull requests; replay: candidates for the freeze, any state
 * @property {string|null} mergeMessage    replay only: the merge commit's message; null for live
 * @property {string|null} [mergeCommit]   replay only: the merge commit's SHA, for the CLI output; the core does not read it
 * @property {string[]} limits             facts the collector could not establish as of asOf (design section 9)
 */

/**
 * @typedef {{state: 'absent'} | {state: 'present', size: number, bytes: Uint8Array|null}} ContentSide
 *           bytes is null when size exceeds CONTENT_MAX_BYTES: the collector does not read the blob
 */

/**
 * @typedef {object} PullFacts
 * @property {number} number
 * @property {'open'|'closed'} state
 * @property {boolean} merged
 * @property {boolean} draft
 * @property {string} title                replay: the title as of asOf
 * @property {string} headRepo             'owner/name'
 * @property {string} headRef
 * @property {string} headSha              40 lowercase hex, equal to the fetched head ref
 * @property {string} baseRef
 * @property {boolean|null} mergeable
 */

/**
 * @typedef {object} FileChange
 * @property {string} path                 decoded UTF-8
 * @property {boolean} pathBytesOk         false if decoding was lossy
 * @property {'A'|'M'|'D'|'T'} status
 * @property {string|null} baseMode        null when status is 'A'
 * @property {string|null} headMode        null when status is 'D'
 * @property {boolean|null} headHasNul     null unless headMode is '100644'
 * @property {number|null} added           null for a binary numstat entry
 * @property {number|null} deleted
 */

/** @typedef {{verdict: string, code: string, detail?: string}} Reason */

/**
 * @typedef {object} Verdict
 * @property {string} verdict              'merge', 'hold:owner', 'hold:strong-review', 'fix:ci', 'fix:codex',
 *                                         'update:base', 'wait:<what>' or 'blocked:<why>'
 * @property {string|null} lane
 * @property {string} headSha
 * @property {Reason[]} reasons            every failed condition, sorted by VERDICT_ORDER, stable within a class
 * @property {{method: 'squash', expectedHeadSha: string, commitMessage: string}|null} merge
 *                                         non-null only when verdict is 'merge'
 * @property {{state: string, code: string|null}} codex
 * @property {string[]} limits             input.limits plus the core's own (for example 'codex-edited-after-merge')
 */

const rank = (verdict) => {
  let cls = verdict;
  if (verdict.startsWith('blocked:')) cls = 'blocked';
  else if (verdict.startsWith('wait:') && verdict !== 'wait:halt' && verdict !== 'wait:freeze') cls = 'wait';
  const index = VERDICT_ORDER.indexOf(cls);
  if (index === -1) throw new Error(`verdict outside the precedence list: ${verdict}`);
  return index;
};

const timeOf = (value) => (value === null || value === undefined ? NaN : Date.parse(value));

// Whether an issue or pull request was open at `tMs`; null means live, where
// every listed item counts. An unreadable timestamp counts as open: it can
// only stop a merge, never enable one.
function openAt(item, tMs) {
  if (tMs === null) return true;
  const created = timeOf(item.createdAt);
  if (!Number.isNaN(created) && created > tMs) return false;
  if (item.closedAt === null || item.closedAt === undefined) return true;
  const closed = timeOf(item.closedAt);
  if (Number.isNaN(closed)) return true;
  return closed > tMs;
}

// The latest run by start time, then by id.
function latestRun(runs) {
  let best = null;
  for (const run of runs) {
    if (best === null) { best = run; continue; }
    const a = timeOf(run.started_at);
    const b = timeOf(best.started_at);
    const aKey = Number.isNaN(a) ? -Infinity : a;
    const bKey = Number.isNaN(b) ? -Infinity : b;
    if (aKey > bKey || (aKey === bKey && run.id > best.id)) best = run;
  }
  return best;
}

/**
 * @param {GateInput} input
 * @returns {Verdict}
 */
export function evaluate(input) {
  if (input?.schema !== 1) throw new Error('GateInput.schema must be 1');
  const replay = input.asOf !== null && input.asOf !== undefined;
  const tMs = replay ? Date.parse(input.asOf) : null;
  if (replay && Number.isNaN(tMs)) throw new Error(`asOf is not a timestamp: ${input.asOf}`);
  const pr = input.pr;
  const limits = [...(input.limits ?? [])];
  const reasons = [];
  const add = (verdict, code, detail) => reasons.push(detail === undefined ? { verdict, code } : { verdict, code, detail });

  const finish = (lane, manifest, codexState) => {
    const sorted = reasons
      .map((reason, index) => ({ reason, index, rank: rank(reason.verdict) }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map((entry) => entry.reason);
    const verdict = sorted.length > 0 ? sorted[0].verdict : 'merge';
    return {
      verdict,
      lane,
      headSha: pr.headSha,
      reasons: sorted,
      merge: verdict === 'merge'
        ? { method: 'squash', expectedHeadSha: pr.headSha, commitMessage: manifest.lanes[lane].marker }
        : null,
      codex: codexState ? { state: codexState.state, code: codexState.code } : { state: 'not-evaluated', code: null },
      limits,
    };
  };

  // 1. Halt.
  for (const issue of input.haltIssues ?? []) {
    if (openAt(issue, tMs)) add('wait:halt', 'halt-issue-open', String(issue.number));
  }

  // 2. Manifest.
  const parsed = parseManifest(input.manifestText);
  if (!parsed.ok) {
    add('blocked:manifest', parsed.code, parsed.errors[0]);
    return finish(null, null, null);
  }
  const { manifest } = parsed;

  // 3. Lane (design 5.2). A queue-form head counts only when the manifest
  // declares a queue lane.
  const laneNames = Object.keys(manifest.lanes);
  const queueName = laneNames.find((name) => manifest.lanes[name].kind === 'queue') ?? null;
  const queueMatch = QUEUE_BRANCH.exec(pr.headRef);
  const laneReasons = [];
  let laneName = null;
  let laneBlocked = false;
  if (queueMatch !== null && queueName !== null) {
    laneName = queueName;
    if (input.callerLane !== null && input.callerLane !== undefined && input.callerLane !== queueName) {
      laneReasons.push(['blocked:lane', 'lane-conflict', String(input.callerLane)]);
      laneBlocked = true;
    }
  } else if (input.callerLane !== null && input.callerLane !== undefined) {
    if (Object.hasOwn(manifest.lanes, input.callerLane) && manifest.lanes[input.callerLane].kind === 'caller') {
      laneName = input.callerLane;
    } else {
      laneReasons.push(['blocked:lane', 'unknown-lane', String(input.callerLane)]);
      laneBlocked = true;
    }
  } else if (replay && typeof input.mergeMessage === 'string') {
    // Replay has no caller: the merge commit's marker line names the lane. A
    // marker that does not name exactly one caller lane gives no lane.
    const lines = input.mergeMessage.split('\n');
    const hits = laneNames.filter((name) => manifest.lanes[name].kind === 'caller' && lines.includes(manifest.lanes[name].marker));
    if (hits.length === 1) laneName = hits[0];
  }
  if (laneBlocked) laneName = null;
  const lane = laneName === null ? null : manifest.lanes[laneName];
  const isQueue = lane !== null && lane.kind === 'queue';
  const reportId = isQueue ? queueMatch[1] : null;

  // 4. Freeze.
  if (lane !== null && lane.freeze_while_open) {
    const { head, base } = lane.freeze_while_open;
    for (const p of input.pulls ?? []) {
      if (p.headRef === head && p.baseRef === base && openAt(p, tMs)) add('wait:freeze', 'promotion-open', String(p.number));
    }
  }

  // 5.1 Origin and state.
  if (typeof pr.headRepo !== 'string' || pr.headRepo.toLowerCase() !== String(input.repo).toLowerCase()) {
    add('hold:owner', 'fork');
  }
  if (!replay && pr.state !== 'open') add('blocked:not-open', 'not-open');
  if (input.files.length === 0) add('blocked:empty-diff', 'empty-diff');
  for (const f of input.files) {
    if (!f.pathBytesOk) add('blocked:input', 'path-encoding', f.path);
  }

  // 5.2 Lane and base.
  for (const [verdict, code, detail] of laneReasons) add(verdict, code, detail);
  if (laneName === null && !laneBlocked) add('hold:owner', 'no-lane');
  if (lane !== null) {
    if (pr.baseRef !== lane.base) add('hold:owner', 'base-mismatch', `${pr.baseRef} != ${lane.base}`);
    if (!lane.auto_merge) add('hold:owner', 'auto-merge-off');
  }

  // 5.3 Queue item.
  if (isQueue) {
    if (typeof input.queueItemText !== 'string') {
      add('hold:owner', 'queue-item-missing');
    } else {
      const merge = readMergeField(input.queueItemText);
      if (!merge.ok) add('hold:owner', 'queue-item-unreadable');
      else if (merge.value === 'owner') add('hold:owner', 'queue-merge-owner');
    }
  }

  // 5.4 Change set.
  let changed = 0;
  for (const f of input.files) {
    const lower = f.path.toLowerCase();
    if (f.headMode !== null && f.headMode !== '100644') add('hold:owner', 'mode', f.path);
    else if (f.status === 'T') add('hold:owner', 'mode', f.path);
    if (f.headMode === '100644' && f.headHasNul !== false) add('hold:owner', 'binary', f.path);
    // The item's own report is not a floor path and is exempt from the lane's
    // tier checks. Compared exactly, not case-insensitively.
    const ownReport = isQueue && f.path === `${REPORT_DIR}/${reportId}.md` &&
      (f.status === 'A' || f.status === 'M') && f.headMode === '100644';
    if (!ownReport && FLOOR.some((pattern) => matches(pattern, f.path))) add('hold:owner', 'floor', lower);
    if (manifest.hold_paths.some((pattern) => matches(pattern, f.path))) add('hold:owner', 'hold-path', lower);
    if (lane !== null && !ownReport) {
      if (lane.tier.strong_review.some((pattern) => matches(pattern, f.path))) add('hold:strong-review', 'strong-review-path', lower);
      if (lane.tier.default === 'hold' && !lane.tier.auto.some((pattern) => matches(pattern, f.path))) {
        add('hold:owner', 'not-in-allowlist', lower);
      }
    }
    // Content rules (design 5.4.1) apply to every lane and to the own report,
    // and come after the entry's other reasons. They only add reasons.
    for (const reason of evaluateContentRules(manifest, [f], input.contents)) add(reason.verdict, reason.code, reason.detail);
    changed += (f.added ?? 0) + (f.deleted ?? 0);
  }
  if (lane !== null && lane.max_changed_lines !== null && changed > lane.max_changed_lines) {
    add('hold:owner', 'too-large', `${changed} > ${lane.max_changed_lines}`);
  }

  // 5.5 Checks.
  if (manifest.checks === 'none') {
    add('hold:owner', 'checks-none');
  } else {
    for (const name of manifest.checks) {
      const runs = (input.checkRuns ?? []).filter((run) => run.name === name && run.app?.slug === ACTIONS_APP_SLUG &&
        (!replay || timeOf(run.started_at) <= tMs));
      const run = latestRun(runs);
      if (run === null) {
        add('wait:ci', 'check-missing', name);
        continue;
      }
      const completedAt = timeOf(run.completed_at);
      const done = run.status === 'completed' && (!replay || (!Number.isNaN(completedAt) && completedAt <= tMs));
      if (!done) add('wait:ci', 'check-running', name);
      else if (run.conclusion === 'success') continue;
      else if (run.conclusion === 'failure') add('fix:ci', 'check-failed', name);
      else add('blocked:check', 'check-conclusion', `${name}=${run.conclusion}`);
    }
  }

  // 5.6 Codex.
  const codexState = readCodexState({
    headSha: pr.headSha,
    comments: input.codex.comments,
    reviewComments: input.codex.reviewComments,
    reviews: input.codex.reviews,
    asOf: replay ? input.asOf : null,
  });
  if (codexState.editedAfterAsOf) limits.push('codex-edited-after-merge');
  const codex = codexReason(codexState, manifest.codex_clean);
  if (codex !== null) add(codex.verdict, codex.code, codex.detail);

  // 5.7 Ancestry and mergeability.
  if (!input.baseIsAncestor) add('update:base', 'base-not-ancestor');
  if (!replay) {
    if (pr.mergeable === false && input.baseIsAncestor) add('blocked:not-mergeable', 'not-mergeable');
    else if (pr.mergeable !== true && pr.mergeable !== false) add('wait:mergeable', 'mergeable-unknown');
  }

  // 5.9 Owner signals.
  if (pr.draft !== false) add('hold:owner', 'draft');
  const title = typeof pr.title === 'string' ? pr.title.toLowerCase() : null;
  if (title === null || title.includes('[failed]') || title.includes('[needs-decision]')) {
    add('hold:owner', 'title-marker');
  }

  return finish(laneName, manifest, codexState);
}
