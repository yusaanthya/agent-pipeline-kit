// Codex review state: a port of the consumers' Codex review gate
// script, with the review-body parsing moved into the core. Pure: the caller
// passes the REST objects GitHub returns.
import { CODEX_BOT } from './constants.js';

const SUMMARY_MARKER = '<!-- codex-pull-request-review-summary -->';
const RECEIPT_MARKER = '<!-- codex-review-receipt:v1 -->';
const STATE_MARKER = /<!-- codex-review-state:v1 ([\s\S]*?) -->/g;

const trusted = (item) => item?.user?.id === CODEX_BOT.id && item?.user?.login === CODEX_BOT.login;

function titleOf(body) {
  return (body || '').trim().split('\n')[0].replace(/<[^>]*>/g, '').replace(/^[\s#*_>-]+/, '').replace(/^\d+[.)]\s+/, '');
}

// Only the finding title's explicit label is authoritative, never prose.
function priority(body) {
  const match = titleOf(body).match(/^(?:\[P([0-3])\](?=\s|$)|!\[P([0-3]) Badge\]\([^)]*\))/);
  return match ? Number(match[1] ?? match[2]) : null;
}

// One finding per labelled line of a review body; an unlabelled non-empty body
// is itself one finding (an unknown label must not turn into approval), unless
// it is the receipt boilerplate. An empty or whitespace-only body has none.
function reviewBodyFindings(review) {
  const body = (review.body || '').trim();
  if (!body) return [];
  const labelled = body.split('\n').filter((line) => /^(?:!\[P|\[P)/.test(titleOf(line)));
  const entries = labelled.length ? labelled : body.includes(RECEIPT_MARKER) ? [] : [body];
  return entries.map((entry) => ({ body: entry }));
}

function filterItems(items, createdKey, asOfMs, flags) {
  return (items || []).filter(trusted).filter((item) => {
    if (asOfMs === null) return true;
    const created = Date.parse(item[createdKey]);
    if (Number.isNaN(created)) {
      flags.edited = true; // cannot place the item in time: keep it and report it
      return true;
    }
    if (created > asOfMs) return false;
    if (item.updated_at !== undefined) {
      const updated = Date.parse(item.updated_at);
      if (Number.isNaN(updated) || updated > asOfMs) flags.edited = true;
    }
    return true;
  });
}

function stateOf(headSha, comments, reviewComments, reviews) {
  const none = { hasAny: null, hasUnresolved: null, security: null };
  const result = (state, code, extra = none) => ({ state, code, ...extra });

  // 1. exactly one trusted summary
  const summaries = comments.filter((c) => typeof c.body === 'string' && c.body.includes(SUMMARY_MARKER));
  if (summaries.length === 0) return result('pending', 'no-summary');
  if (summaries.length > 1) return result('error', 'ambiguous-summaries');

  // 2. exactly one state marker holding valid JSON with code_review.commit_sha
  const markers = [...summaries[0].body.matchAll(STATE_MARKER)];
  if (markers.length !== 1) return result('error', 'unsupported-format');
  let parsed;
  try {
    parsed = JSON.parse(markers[0][1]);
  } catch {
    return result('error', 'invalid-state');
  }
  const review = parsed?.code_review;
  if (!review || typeof review.commit_sha !== 'string') return result('error', 'invalid-state');
  const extra = {
    hasAny: typeof review.has_any_findings === 'boolean' ? review.has_any_findings : null,
    hasUnresolved: typeof review.has_unresolved_findings === 'boolean' ? review.has_unresolved_findings : null,
    security: parsed.security_review ?? null,
  };

  // 3. a review of another commit
  if (review.commit_sha !== headSha) return result('pending', 'stale-review', extra);

  // 4. review status
  if (['running', 'pending', 'queued'].includes(review.status)) return result('pending', 'review-incomplete', extra);
  if (review.status !== 'completed') return result('error', 'review-status', extra);

  // 5. consistent findings flags
  if (typeof review.has_any_findings !== 'boolean' || typeof review.has_unresolved_findings !== 'boolean' ||
      (!review.has_any_findings && review.has_unresolved_findings)) {
    return result('error', 'invalid-findings-state', extra);
  }

  // 6. a finding the parser cannot place on a commit
  const inline = reviewComments.filter((c) => !c.in_reply_to_id);
  if (inline.some((c) => c.commit_id === headSha && !c.original_commit_id)) {
    return result('error', 'finding-missing-original-commit', extra);
  }

  // 7. current findings: original_commit_id, never commit_id (GitHub remaps it)
  const current = [
    ...inline.filter((c) => c.original_commit_id === headSha),
    ...reviews.filter((r) => r.state !== 'PENDING' && r.commit_id === headSha).flatMap(reviewBodyFindings),
  ];

  // 8. priorities, read from titles only
  const priorities = current.map((f) => priority(f.body));
  if (priorities.some((p) => p !== null && p <= 1)) return result('blocking', 'p0-p1', extra);
  if (priorities.some((p) => p === null)) return result('error', 'finding-unclassified', extra);
  if (review.has_any_findings && current.length === 0) return result('error', 'findings-unverified', extra);

  // 9. advisory or clean
  return current.length > 0 ? result('advisory', null, extra) : result('clean', null, extra);
}

/**
 * @returns {{state: 'pending'|'error'|'blocking'|'advisory'|'clean', code: string|null,
 *   hasAnyFindings: boolean|null, hasUnresolvedFindings: boolean|null,
 *   securityReview: object|null, editedAfterAsOf: boolean}}
 */
export function readCodexState({ headSha, comments, reviewComments, reviews, asOf = null }) {
  let asOfMs = null;
  if (asOf !== null) {
    asOfMs = Date.parse(asOf);
    if (Number.isNaN(asOfMs)) throw new Error(`asOf is not a timestamp: ${asOf}`);
  }
  const flags = { edited: false };
  const kept = {
    comments: filterItems(comments, 'created_at', asOfMs, flags),
    reviewComments: filterItems(reviewComments, 'created_at', asOfMs, flags),
    reviews: filterItems(reviews, 'submitted_at', asOfMs, flags),
  };
  let outcome = stateOf(headSha, kept.comments, kept.reviewComments, kept.reviews);
  // 10. Override: changes requested on the head, whatever the steps above gave.
  if (kept.reviews.some((r) => r.state === 'CHANGES_REQUESTED' && r.commit_id === headSha)) {
    outcome = { ...outcome, state: 'blocking', code: 'changes-requested' };
  }
  return {
    state: outcome.state,
    code: outcome.code,
    hasAnyFindings: outcome.hasAny,
    hasUnresolvedFindings: outcome.hasUnresolved,
    securityReview: outcome.security,
    editedAfterAsOf: flags.edited,
  };
}

const reason = (verdict, code, detail) => (detail === undefined ? { verdict, code } : { verdict, code, detail });

function securityReason(security) {
  if (security === null || security === undefined) return null;
  if (typeof security !== 'object' || Array.isArray(security)) return reason('blocked:codex', 'security-review-status');
  if (security.status === null || security.status === undefined) return null;
  if (['running', 'pending', 'queued'].includes(security.status)) return reason('wait:codex', 'security-review-incomplete');
  if (security.status !== 'completed') return reason('blocked:codex', 'security-review-status');
  return security.has_any_findings === false ? null : reason('fix:codex', 'security-findings');
}

/**
 * Maps a Codex state to a reason by the manifest's `codex_clean`.
 * @param {'no_blocking'|'no_findings'} mode
 * @returns {{verdict: string, code: string, detail?: string}|null}
 */
export function codexReason(codexState, mode) {
  if (mode !== 'no_blocking' && mode !== 'no_findings') throw new Error(`unknown codex_clean mode: ${mode}`);
  const strict = mode === 'no_findings';
  switch (codexState.state) {
    case 'pending':
      return reason('wait:codex', codexState.code);
    case 'error':
      if (strict && (codexState.code === 'finding-unclassified' || codexState.code === 'findings-unverified')) {
        return reason('fix:codex', codexState.code);
      }
      return reason('blocked:codex', codexState.code);
    case 'blocking':
      return reason('fix:codex', codexState.code);
    case 'advisory':
      return strict ? reason('fix:codex', 'finding-present') : null;
    case 'clean':
      return strict ? securityReason(codexState.securityReview) : null;
    default:
      throw new Error(`unknown codex state: ${codexState.state}`);
  }
}
