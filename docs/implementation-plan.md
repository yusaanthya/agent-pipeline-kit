# Implementation plan (Phase 1)

For the implementer of the gate library, its input collector and the
replay/backtest CLI. The behaviour is specified in [the design](design.md);
where this plan and the design disagree, the design wins and the disagreement
is a bug in this plan. The hook adapter, bootstrap, manifest templates and
runner procedure are **not** part of Phase 1. Sections 1 to 8 are Phase 1.
Sections 9 to 11 are the slices after it (content rules in the core, the path
check without a pull request, and the hook's reading of the same policy); each
starts after the previous one is merged, and none of them is implemented yet.

Constraints: Node.js 22, ESM, no runtime dependencies, tests with `node:test`
and `node:assert/strict`. The core (`src/core/`) is pure: no I/O, no clock, no
randomness, no environment reads. Adapters (`src/collect/`) hold no decisions.
`git` and `gh` are spawned only through one process adapter with argument
arrays and `shell: false`.

## 1. Module layout

```text
package.json             type module, engines node >=22, scripts.test "node --test", bin agent-pipeline-gate -> src/cli.js, no dependencies
src/core/constants.js    CODEX_BOT, ACTIONS_APP_SLUG, FLOOR, HALT_LABEL, QUEUE_BRANCH, REPORT_DIR, QUEUE_DIR, VERDICT_ORDER
src/core/glob.js         pattern validation and matching (design 5.4)
src/core/manifest.js     parseManifest(text)
src/core/queue.js        readMergeField(text)
src/core/codex.js        readCodexState(...), codexReason(...)
src/core/verdict.js      evaluate(input)
src/collect/proc.js      run(cmd, args, options): the only place that spawns a process
src/collect/github.js    makeGithub(run): REST GET with pagination through `gh api`
src/collect/git.js       makeGit(run, repoDir): fetch, rev-parse, merge-base, diff, cat-file
src/collect/parse.js     parseRawDiff(buffer), parseNumstat(buffer): pure parsers of git -z output
src/collect/collect.js   collect(options, deps): builds a GateInput (live or as of a merge)
src/cli.js               evaluate | replay | backtest
test/core/*.test.js      table-driven tests of the core
test/collect/*.test.js   parser tests; collector tests with fake run()
test/cli.test.js         exit codes and output shape
test/fixtures/codex/     Codex comment fixtures: synthetic, or copied from quorum-election-simulator's public pull requests (source URL in each file)
```

Constants:

- `CODEX_BOT = { id, login }`: copy both values from
  `scripts/codex-review-gate.mjs` in quorum-election-simulator. Both must
  match for an item to be trusted.
- `ACTIONS_APP_SLUG = 'github-actions'`: the `app.slug` of check runs
  created by GitHub Actions.
- `FLOOR`: the patterns of design section 5.4, lowercase.
- `HALT_LABEL = 'pipeline-halt'`.
- `QUEUE_BRANCH = /^claude\/item-([a-z0-9][a-z0-9-]*)$/`,
  `QUEUE_DIR = '.agent-line/queue'`, `REPORT_DIR = '.agent-line/reports'`.
- `VERDICT_ORDER`: the precedence list of design section 3.1.

## 2. Data shapes

JSDoc typedefs in `src/core/verdict.js`. Gate-derived facts use camelCase.
Codex items and check runs are passed as the REST objects GitHub returns, so
that the parser is a faithful port and fixtures can be real API output; only
the listed fields are read.

```js
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
 * @property {string[]} limits             facts the collector could not establish as of asOf (design section 9)
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

/** @typedef {{verdict: string, code: string, detail?: string}} Reason */
```

### 2.1 Reason codes

| Verdict | Codes |
| --- | --- |
| `wait:halt` | `halt-issue-open` (detail: issue number) |
| `wait:freeze` | `promotion-open` (detail: pull request number) |
| `blocked:manifest` | `manifest-missing`, `manifest-json`, `manifest-invalid` (detail: first error) |
| `blocked:lane` | `unknown-lane`, `lane-conflict` |
| `blocked:input` | `path-encoding`, `collect-failed` (emitted by the CLI, not the core) |
| `blocked:not-open` | `not-open` |
| `blocked:empty-diff` | `empty-diff` |
| `blocked:codex` | `ambiguous-summaries`, `unsupported-format`, `invalid-state`, `review-status`, `invalid-findings-state`, `finding-missing-original-commit`, `finding-unclassified`, `findings-unverified`, `security-review-status` |
| `blocked:check` | `check-conclusion` (detail: `name=conclusion`) |
| `blocked:not-mergeable` | `not-mergeable` |
| `hold:owner` | `fork`, `no-lane`, `base-mismatch`, `auto-merge-off`, `queue-item-missing`, `queue-merge-owner`, `queue-item-unreadable`, `draft`, `title-marker`, `mode`, `binary`, `floor`, `hold-path`, `not-in-allowlist`, `too-large`, `checks-none` (path codes carry the path as detail) |
| `hold:strong-review` | `strong-review-path` |
| `wait:ci` | `check-missing`, `check-running` |
| `wait:codex` | `no-summary`, `stale-review`, `review-incomplete`, `security-review-incomplete` |
| `wait:mergeable` | `mergeable-unknown` |
| `fix:ci` | `check-failed` |
| `fix:codex` | `p0-p1`, `changes-requested`, `finding-present`, `finding-unclassified`, `findings-unverified`, `security-findings` (the last four only under `no_findings`) |
| `update:base` | `base-not-ancestor` |

## 3. Core functions

```js
// src/core/glob.js
export function validatePattern(pattern) // -> string|null: an error message, or null when valid
export function matches(pattern, path)   // -> boolean; both lowercased; pattern must be valid

// src/core/manifest.js
export function parseManifest(text)      // text: string|null
// -> { ok: true, manifest } | { ok: false, code: 'manifest-missing'|'manifest-json'|'manifest-invalid', errors: string[] }

// src/core/queue.js
export function readMergeField(text)     // text: string
// -> { ok: true, value: 'runner'|'owner'|null } | { ok: false }

// src/core/codex.js
export function readCodexState({ headSha, comments, reviewComments, reviews, asOf })
// -> { state: 'pending'|'error'|'blocking'|'advisory'|'clean', code: string|null,
//      hasAnyFindings: boolean|null, hasUnresolvedFindings: boolean|null,
//      securityReview: object|null, editedAfterAsOf: boolean }
export function codexReason(codexState, mode) // mode: 'no_blocking'|'no_findings'
// -> Reason|null

// src/core/verdict.js
export function evaluate(input)          // input: GateInput -> Verdict
```

### 3.1 `evaluate` outline

1. Halt: every halt issue with `createdAt <= t` and (`closedAt` null or
   `closedAt > t`), where `t` is `asOf`, or every listed issue when `asOf` is
   null, adds `wait:halt`.
2. `parseManifest(input.manifestText)`. On failure, return the halt reasons and
   the manifest reason; nothing else is evaluated.
3. Resolve the lane (design 5.2). A head branch in the queue form counts only
   when the manifest declares a queue lane; otherwise it is treated as not in
   the queue form. In replay with no queue lane resolved and no caller lane,
   the lane is the caller lane whose `marker` equals a line of `mergeMessage`
   exactly; none matches: no lane.
4. With a lane that has `freeze_while_open`: any pull request with that head
   and base, `headRepo` ignored, open at `t` (as in step 1) adds
   `wait:freeze`.
5. Origin and state (5.1), lane and base (5.2), queue item (5.3), change set
   (5.4), checks (5.5), Codex (5.6), ancestry and mergeability (5.7), owner
   signals (5.9), in that order; within one verdict class, reasons keep this
   order (design 3.1). Lane-dependent conditions (base, queue,
   `auto_merge`, tier, `max_changed_lines`) are skipped when there is no lane
   or the lane is blocked; the others still run, so the owner sees every
   reason.
6. Sort reasons by `VERDICT_ORDER` (stable); the verdict is the first reason's
   verdict, or `merge` when there is none. `merge` is non-null only then, with
   the lane's `marker` as `commitMessage`.

Replay differences inside the core (`asOf` set): skip the open-state and
`mergeable` conditions; keep check runs with `started_at <= asOf`, and treat a
run with `completed_at` null or after `asOf` as not completed; keep Codex items
with `created_at` (comments) or `submitted_at` (reviews) `<= asOf`; set
`editedAfterAsOf` when a kept trusted item has `updated_at > asOf` and add the
limit `codex-edited-after-merge`.

Check selection: among check runs with `name` equal to the listed name and
`app.slug === ACTIONS_APP_SLUG`, the one with the greatest `started_at`, ties
broken by the greatest `id`.

### 3.2 `readMergeField`

The first line must be exactly `---`; front matter ends at the next line that
is exactly `---`. A `\r` anywhere in the front matter, no closing line, or more
than one line starting with `merge:` gives `{ ok: false }`. A line matching
`^merge:[ \t]*(\S+)[ \t]*$` gives its value: `runner` or `owner`; any other
value gives `{ ok: false }`. No `merge:` line gives `{ ok: true, value: null }`.

## 4. Collector

```js
// src/collect/collect.js
export async function collect({ repo, prNumber, repoDir, callerLane = null, replay = false, manifestFile = null }, { run, readFile })
// -> GateInput; throws on any failed or unexpected API or git result
```

`run` is `src/collect/proc.js`'s `run(cmd, args, { cwd, maxBuffer, timeoutMs })`,
which uses `child_process.execFile` with `shell: false`, an environment that
adds `GIT_TERMINAL_PROMPT=0`, and resolves `{ stdout: Buffer, code }`. Tests
pass a fake.

Steps, live mode:

1. `GET /repos/{repo}` for `default_branch`; `GET /repos/{repo}/pulls/{n}`.
2. Validate every ref name used in a git argument: `^[A-Za-z0-9._/-]+$`, not
   starting with `-` or `/`, no `..`. Validate SHAs: `^[0-9a-f]{40}$`. A
   failure throws.
3. `git -C <repoDir> fetch --no-tags --quiet origin
   +refs/heads/<default>:<ns>/trust +refs/heads/<baseRef>:<ns>/base
   +refs/pull/<n>/head:<ns>/head`, where `<ns>` is
   `refs/agent-pipeline-kit/<pid>`. Resolve each with
   `rev-parse --verify --quiet <ref>^{commit}`. The fetched head must equal the
   API's `head.sha`, else throw (the head moved).
4. Manifest: `manifestFile` read with `readFile` if given, else
   `git cat-file -e <ns>/trust:.agent-line/manifest.json`, then
   `git cat-file blob <ns>/trust:.agent-line/manifest.json`. Absent: `null`.
   Never read from the working tree or the pull request.
5. `git merge-base <base> <head>`; `git merge-base --is-ancestor <base> <head>`
   (exit 0 true, 1 false, anything else throws).
6. `git diff --raw -z --no-renames --no-abbrev --no-ext-diff --no-textconv <mb> <head>`
   and `git diff --numstat -z --no-renames --no-ext-diff --no-textconv <mb> <head>`,
   parsed by `parse.js` and joined by path. For each entry with head mode
   `100644`: `git cat-file blob <dst sha>` and set `headHasNul`.
7. If `headRef` matches `QUEUE_BRANCH`: `queueItemText` from
   `<baseSha>:.agent-line/queue/<id>.md` (absent: `null`).
8. REST, every page (`per_page=100&page=N` until a page has fewer than 100
   items; more than 100 pages throws):
   `/repos/{repo}/commits/{headSha}/check-runs?filter=all` (items under
   `check_runs`), `/repos/{repo}/issues/{n}/comments`,
   `/repos/{repo}/pulls/{n}/comments`, `/repos/{repo}/pulls/{n}/reviews`,
   `/repos/{repo}/issues?labels=pipeline-halt&state=open`,
   `/repos/{repo}/pulls?state=open`.
9. Delete the `<ns>` refs (best effort).

`gh` invocation: `gh api --method GET -H 'Accept: application/vnd.github+json' <path>`.
REST through `gh api` is the path documented to work in cloud sessions; GraphQL
is not used.

Replay mode (`replay: true`), differences:

- The pull request must be merged, else throw. `asOf` is `merged_at`.
- After fetching, `baseSha` is `git rev-parse <merge_commit_sha>^1`, and the
  merge commit must be reachable from `<ns>/base`, else throw.
  `mergeMessage` is `git log -1 --format=%B <merge_commit_sha>`. This assumes
  squash or merge-commit merges. Rebase merges are unsupported: the first
  parent of a rebased commit is not the base tip at merge time, and the
  collector does not detect or flag such a merge.
- Manifest, without `manifestFile`: the blob at
  `git rev-list -1 --first-parent --before=<asOf> <ns>/trust`; add the limit
  `manifest-by-commit-date`.
- Title: start from the current title; if the timeline
  (`/repos/{repo}/issues/{n}/timeline`) has `renamed` events after `asOf`,
  the title is the `rename.from` of the earliest such event.
- `draft` is `false`.
- Halt: `/repos/{repo}/issues?labels=pipeline-halt&state=all`; add the limit
  `halt-label-timing`.
- Freeze: for each lane with `freeze_while_open`,
  `/repos/{repo}/pulls?state=all&base=<base>`, keeping the pull requests whose
  head branch is `<head>` from any repository (the live rule ignores
  `headRepo`; the API head filter needs an owner, so the head is matched
  locally); add the limit `freeze-retarget-unknown`.
- Reopen history: only the latest `closed_at` is read, so an issue or pull
  request closed and reopened before the merge can look open at the merge
  time. When any halt issue or freeze candidate was collected, add the limit
  `reopen-history-unknown`. The error only adds a stop, never enables a merge.

## 5. CLI contract

```text
agent-pipeline-gate evaluate --repo OWNER/NAME --pr N --repo-dir DIR [--lane NAME] [--manifest FILE]
agent-pipeline-gate replay   --repo OWNER/NAME --pr N --repo-dir DIR [--manifest FILE]
agent-pipeline-gate backtest --repo OWNER/NAME --repo-dir DIR --since ISO --until ISO [--base BRANCH] [--manifest FILE]
```

- `--repo-dir` is a local clone whose `origin` is the repository. The CLI
  fetches into it under `refs/agent-pipeline-kit/`; it never checks out.
- `evaluate` and `replay` print one JSON object (the `Verdict`, plus
  `kit`: the CLI's own commit from `git rev-parse HEAD` in its directory, or
  `"unknown"`; replay also adds `mergeCommit`, `mergedAt` and `marker`: the
  `Auto-Merged-By:` line of the merge message or null). Exit 0 when the
  verdict is `merge`, 1 for any other verdict.
- When collection throws, `evaluate` and `replay` print
  `{"verdict": "blocked:input", "reasons": [{"verdict": "blocked:input", "code": "collect-failed", "detail": "<message>"}], ...}`
  and exit 1. A failure is never an empty result.
- `backtest` lists pull requests with `GET /repos/{repo}/pulls?state=closed&sort=updated&direction=desc`
  (optionally `&base=`), keeps those with `merged_at` in `[since, until)`,
  replays each in ascending `merged_at` order, and prints one JSON line per
  pull request (`repo`, `pr`, `mergedAt`, `mergeCommit`, `marker`, `verdict`,
  `reasons`, `limits`), then one line
  `{"summary": {"total", "byVerdict", "anomalies", "unmarkedNotMerge", "kit"}}`.
  `anomalies` lists pull requests with a marker whose verdict is not `merge`;
  `unmarkedNotMerge` lists those without a marker whose verdict is not
  `merge`. A pull request whose replay throws gets a line with
  `blocked:input` and counts in both lists by its marker. Exit 0 when the
  run completed.
- Usage errors (unknown command or option, missing or malformed value,
  `--since` not before `--until`) print a usage line to stderr and exit 2.

The desk calls `backtest --since <its last successful run>` and prints the
output verbatim.

## 6. Tests

Write each core test before the code it tests. Tests are table-driven: one
array of `{ name, input or change, expected }` per file, one `test()` per row.

### 6.1 Verdict function (`test/core/verdict.test.js`)

Baseline input that yields `merge`: a queue-lane manifest (`checks:
["check"]`, `codex_clean: "no_blocking"`, lane `runner` of kind `queue`,
base `main`, `auto_merge: true`, `tier.default: "auto"`, marker
`Auto-Merged-By: test-runner`); pull request open, not draft, title
`feat: add x`, head repository equal to the repository, head
`claude/item-sim-1`, base `main`, mergeable; files: one modified
`src/x.go` (`100644`, no NUL, 3 added, 1 deleted) and the added report
`.agent-line/reports/sim-1.md`; base is an ancestor; queue item
`---\nid: sim-1\nmerge: runner\n---\n`; one `check` run from
`github-actions`, completed, success; one clean trusted Codex summary for the
head; no halt issues; no other pull requests.

| # | Change from baseline | Expected verdict | Code |
| --- | --- | --- | --- |
| 1 | none | `merge` | merge params: squash, head SHA, marker |
| 2 | open halt issue | `wait:halt` | `halt-issue-open` |
| 3 | halt issue plus a floor path | `wait:halt`, `hold:owner` also in reasons | |
| 4 | lane with `freeze_while_open {head: preview, base: main}`, base `preview`, an open pull request `preview` -> `main` | `wait:freeze` | `promotion-open` |
| 5 | as 4, the promotion pull request closed | `merge` | |
| 6 | manifest text null / not JSON / unknown key | `blocked:manifest` | `manifest-missing` / `manifest-json` / `manifest-invalid` |
| 7 | head repository is a fork | `hold:owner` | `fork` |
| 8 | pull request closed, live | `blocked:not-open` | |
| 9 | no files | `blocked:empty-diff` | |
| 10 | a path with `pathBytesOk: false` | `blocked:input` | `path-encoding` |
| 11 | head `feature/x`, no caller lane | `hold:owner` | `no-lane` |
| 12 | head `claude/item-Sim-1` and `claude/item-../x` | `hold:owner` | `no-lane` |
| 13 | base `release` | `hold:owner` | `base-mismatch` |
| 14 | caller lane `nightly` not in manifest | `blocked:lane` | `unknown-lane` |
| 15 | queue head plus a different caller lane | `blocked:lane` | `lane-conflict` |
| 16 | caller lane that exists, head `feature/x`, base matches | `merge` | |
| 17 | `auto_merge: false` | `hold:owner` | `auto-merge-off` |
| 18 | queue item absent | `hold:owner` | `queue-item-missing` |
| 19 | queue item `merge: owner` | `hold:owner` | `queue-merge-owner` |
| 20 | queue item without `merge:` | `merge` | |
| 21 | queue item `merge: maybe`, `merge: "owner"`, CRLF front matter, two `merge:` lines, no closing `---` | `hold:owner` | `queue-item-unreadable` |
| 22 | draft | `hold:owner` | `draft` |
| 23 | titles `[FAILED] x`, `[needs-decision] x`, `fix: x [NEEDS-DECISION]` | `hold:owner` | `title-marker` |
| 24 | each floor category, one path each, including `.GitHub/workflows/ci.yml`, `Docs/CLAUDE.local.md`, `a/b/.Claude/settings.json`, `web/package.json`, `requirements-dev.txt`, `.husky/pre-commit` | `hold:owner` | `floor` |
| 25 | deleted `CLAUDE.md` plus added `docs/old.md` (a rename under `--no-renames`) | `hold:owner` | `floor` (path `claude.md`) |
| 26 | own report deleted; own report mode `100755`; report of `sim-2`; own report in a caller lane | `hold:owner` | `floor` or `mode` |
| 27 | head mode `120000`, `160000`, `100755`; status `T` | `hold:owner` | `mode` |
| 28 | `headHasNul: true` | `hold:owner` | `binary` |
| 29 | path in `hold_paths` | `hold:owner` | `hold-path` |
| 30 | `tier.default: "hold"`, `tier.auto: ["src/**"]`; the baseline's modified file replaced by `docs/a.md`; the added report `.agent-line/reports/sim-1.md` stays | `hold:owner` | `not-in-allowlist` (path `docs/a.md` only, not the report) |
| 31 | as 30 with the modified file `src/a/b.go`; the report stays and is not in `tier.auto` | `merge` | the report is exempt from the allowlist |
| 32 | path in `tier.strong_review` | `hold:strong-review` | `strong-review-path` |
| 33 | a floor path that is also in `tier.strong_review` | `hold:owner` first, `hold:strong-review` also in reasons | |
| 34 | `max_changed_lines: 150`, 150 lines | `merge` | |
| 35 | `max_changed_lines: 150`, 151 lines | `hold:owner` | `too-large` |
| 36 | `checks: "none"` | `hold:owner` | `checks-none` |
| 37 | no `check` run; a `check` run from another app | `wait:ci` | `check-missing` |
| 38 | `check` in progress | `wait:ci` | `check-running` |
| 39 | `check` failure | `fix:ci` | `check-failed` |
| 40 | `check` cancelled, timed_out, skipped, neutral, action_required, stale, startup_failure | `blocked:check` | `check-conclusion` |
| 41 | two `check` runs: older failure, newer success; and the reverse | `merge`; `fix:ci` | |
| 42 | Codex pending (no summary) and `check` failure | `wait:codex` | both reasons present |
| 43 | Codex blocking and `check` failure | `fix:ci` | both reasons present |
| 44 | base not an ancestor | `update:base` | `base-not-ancestor` |
| 45 | base not an ancestor and `check` failure | `fix:ci` | |
| 46 | `mergeable: null` | `wait:mergeable` | |
| 47 | `mergeable: false`, base an ancestor | `blocked:not-mergeable` | |
| 48 | `mergeable: false`, base not an ancestor | `update:base` | |
| 49 | Codex states x `codex_clean` modes: every cell of the design's mapping table | as the table | |
| 50 | replay: pull request closed and merged, `mergeable: null` | `merge` | |
| 51 | replay: `check` run started after `asOf` | `wait:ci` | `check-missing` |
| 52 | replay: `check` run completed after `asOf` | `wait:ci` | `check-running` |
| 53 | replay: no queue branch, `mergeMessage` contains a caller lane's marker | lane resolved, `merge` | |
| 54 | replay: no queue branch, no matching marker | `hold:owner` | `no-lane` |
| 55 | replay: halt issue closed before `asOf`; opened after `asOf` | `merge` | |
| 56 | any input: `evaluate` does not mutate it, and two calls give deep-equal results | | |
| 57 | `merge` is null for every non-merge verdict in this table | | |
| 58 | manifest with no queue lane and a caller lane `nightly`; head `claude/item-sim-1`; no caller lane passed | `hold:owner` | `no-lane` |
| 59 | as 58 with the caller lane `nightly` passed, base matches | `merge` | the queue form is ignored |
| 60 | as 58 with another caller lane name passed | `blocked:lane` | `unknown-lane` |
| 61 | replay: as 58, `mergeMessage` contains `nightly`'s marker | lane resolved, `merge` | |
| 62 | queue lane with `tier.strong_review: ["**/*.md"]`; the added report `.agent-line/reports/sim-1.md` | `merge` | the report is exempt from `strong_review` |
| 63 | as 62 with `hold_paths: [".agent-line/reports/**"]` | `hold:owner` | `hold-path` (the exemption covers floor, allowlist and strong review only) |
| 64 | as 62 with a second modified file `docs/a.md` | `hold:strong-review` | `strong-review-path` (path `docs/a.md` only) |

### 6.2 Codex parser (`test/core/codex.test.js`)

Ported from both consumer scripts' tests. The scripts' `run()` tests that
exercise review bodies are ported as parser tests, because the kit moves
review-body parsing into the core.

| # | Case | Expected state (code) | Source |
| --- | --- | --- | --- |
| C1 | completed review of the head | `clean` | both |
| C2 | no summary; `running`; summary for another SHA | `pending` (`no-summary`, `review-incomplete`, `stale-review`) | both |
| C3 | marker copied by a user with another id; with the right id and another login | `pending` (`no-summary`) | both (login case added) |
| C4 | two summaries; summary without state marker; state marker with invalid JSON | `error` (`ambiguous-summaries`, `unsupported-format`, `invalid-state`) | both |
| C5 | `has_any_findings: "false"`; `has_unresolved_findings: true` with `has_any_findings: false` | `error` (`invalid-findings-state`) | both |
| C6 | `**[P0] Fix this**`, `**[P1] Fix this**` on the head | `blocking` (`p0-p1`) | both |
| C7 | `![P2 Badge](url) Optional` and `[P3] Nit`, unresolved | `advisory` | both |
| C8 | `has_any_findings: true` with no finding; a finding `Unknown priority` | `error` (`findings-unverified`; `finding-unclassified`) | both |
| C9 | `[P1] Old issue` with `original_commit_id` of another commit and `commit_id` of the head | `clean` | both |
| C10 | `[P1]` by a human; `[P1]` as a bot reply (`in_reply_to_id` set) | `clean` | both |
| C11 | P2 badge title with prose mentioning P1; `[P3]` with P0 in the body; `[P4]` title; unclassified title with `[P2]` in the body | `advisory`; `advisory`; `error`; `error` | both |
| C12 | review body `[P1] Fix` (COMMENTED); empty body with `CHANGES_REQUESTED` | `blocking` (`p0-p1`; `changes-requested`) | both |
| C13 | review body `[P2] Advisory\nThis discusses P1 blocking.` | `advisory` | both |
| C14 | advisory inline finding plus review body `[P4] Unknown priority`, `Unclassified finding`, `[P2] Advisory\n[P4] Unknown priority` | `error` (`finding-unclassified`) | both |
| C15 | review body `- [P1] Blocking finding` plus an advisory inline finding | `blocking` | both |
| C16 | review body with only the receipt marker and boilerplate | `clean` | both |
| C17 | status `failed`, `cancelled`, `unexpected`, null | `error` (`review-status`) | hardened variant; the public variant returns pending |
| C18 | finding with `commit_id` of the head and no `original_commit_id` | `error` (`finding-missing-original-commit`) | hardened variant; the public variant ignores it |
| C19 | status `pending`, `queued` | `pending` (`review-incomplete`) | hardened variant |
| C20 | bot review in state `PENDING` with `[P1]` body; bot review on another `commit_id` | ignored, `clean` | both (implicit) |
| C21 | `CHANGES_REQUESTED` with no summary at all | `blocking` (`changes-requested`) | both (the override runs after evaluation) |
| C22 | replay: a P1 finding created after `asOf` | ignored | kit |
| C23 | replay: trusted summary with `updated_at` after `asOf` | `editedAfterAsOf: true` | kit |
| C24 | fixtures from quorum-election-simulator's public pull requests: one clean, one with P2/P3 only, one with P0 or P1 | `clean`, `advisory`, `blocking` | real output |
| C25 | trusted `COMMENTED` review of the head whose body is empty, whitespace-only, or newlines only | `clean` (no finding) | both (`if (!body) return []`; the whitespace-only case follows the scripts' `trim()`) |

`codexReason` tests: every cell of the design's mapping table, including the
security review rows under `no_findings` (absent, `status` null, `running`,
`failed`, completed with findings, completed without) and their absence of
effect under `no_blocking`.

### 6.3 Behavioural differences between the two Codex gate script variants

The two variants differ in nine behaviours (rows 1 to 9). Row 10 is not a
difference between the variants: both treat P2 and P3 as advisory, and it
records the stricter no-findings rule of another consumer. The kit's choice for
each:

| # | Behaviour | Public variant | Hardened variant | Kit | Why | Test |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Bases handled | `main` only | `main` and the preview branch | lane bases from the manifest | one base per lane, declared per consumer | verdict 13 |
| 2 | Pull request event types | opened, synchronize, reopened, ready | adds edited, closed; all bases | not applicable | the kit is called per merge and reads fresh state; it is not event-driven | none |
| 3 | Review-event relay | none (late review findings are missed until the next summary update) | permission-free listener plus `workflow_run` | not applicable; reviews and review comments are read on every call | same | C12, C14, C15 |
| 4 | Resolve job | none | resolves the head SHA from the payload, including the summary's `commit_sha` | not adopted: head SHA from the pull request, checked against the fetched ref; never from comment text | an agent-writable or bot-written text never selects the evaluated commit | collector 4 |
| 5 | Shared-SHA siblings | none | worst verdict over every open pull request at the SHA | not adopted | the status context is shared per SHA; the kit writes no status and decides per pull request | collector 5 |
| 6 | Failed or unknown review status | pending | error | error -> `blocked:codex` | an abandoned review must not sit pending unseen; the routine's procedure parks these too | C17 |
| 7 | Finding without `original_commit_id` | ignored | error | error -> `blocked:codex` | fail closed on data the parser cannot place | C18 |
| 8 | Concurrency key | per pull request | per SHA | not applicable | no state is written; the merge call carries the expected head SHA | verdict 1 |
| 9 | Unsupported base | silent return | success marked "Not applicable" | `hold:owner` (`base-mismatch`) | a pull request outside its lane's base is the owner's | verdict 13 |
| 10 | Strictness (not a difference between the variants) | P2/P3 advisory | P2/P3 advisory | `codex_clean` per manifest | another consumer, the multi-repo routine, requires no findings | 6.2 and `codexReason` tests |

### 6.4 Checks of the multi-repo routine's bash gate script

Each check of the script, what the kit does with it, and where it is tested.
"Content rule" means it becomes a `content_rules` entry of that consumer's
manifest (slice 2, section 9). "Consumer" means it has no declarative form: it
stays with that consumer, as the first candidate for the recorded `extra_check`
contract or for a further rule type (open question 18); its existing tests move
with it and are not part of Phase 1.

| # | Script check | Kit | Test |
| --- | --- | --- | --- |
| G1 | usage errors exit 2 | CLI usage errors exit 2 | cli |
| G2 | `--kind nightly\|triage` | caller lane, validated against the manifest | verdict 14, 16 |
| G3 | `--merged-by` names the running routine in the marker | marker is per lane; behaviour change, open question 13 | verdict 1, 53 |
| G4 | no parsable state | no summary: `wait:codex`; malformed: `blocked:codex` | C2, C4 |
| G5 | head is not a fetched commit | collector throws; `blocked:input` | collector 3 |
| G6 | reviewed SHA is not the head | `wait:codex` (`stale-review`) | C2 |
| G7 | code review status not `completed` | `wait:codex` for running, pending, queued; `blocked:codex` otherwise. The script fails all of them; the routine's six-hour park rule stays in the runner procedure | C17, C19 |
| G8 | `has_any_findings` not false | `fix:codex` under `no_findings` | `codexReason` |
| G9 | `has_unresolved_findings` not false | `fix:codex` under `no_findings`; contradictory pair `blocked:codex` | C5, `codexReason` |
| G10 | security review, if present, completed without findings | same, under `no_findings` | `codexReason` |
| G11 | base is an ancestor of the head | `update:base` | verdict 44 |
| G12 | path allowlist | `tier.default: "hold"` plus `tier.auto`. A bash `case` pattern `dir/*.md` also matches `dir/a/b.md`; the kit's `*` stops at `/`, so a ported pattern is written `dir/**/*.md` | verdict 30, 31; glob |
| G13 | triage lane may change only the backlog file | a caller lane whose `tier.auto` is that one path | verdict 30 (pattern) |
| G14 | head mode not `100644` | `hold:owner` (`mode`) | verdict 27 |
| G15 | empty or unreadable diff | `blocked:empty-diff`; unreadable: collector throws | verdict 9; collector |
| G16 | rename away from a protected file | `--no-renames` deletion is checked | verdict 25 |
| G17 | non-ASCII path read unquoted | `-z` parsing | parse 2 |
| G18 | binary file in numstat | NUL check, `hold:owner` (`binary`); binary numstat lines count as 0 | verdict 28; parse 3 |
| G19 | symlink | `hold:owner` (`mode`) | verdict 27 |
| G20 | a JSON manifest may change only its version field | content rule `keys_only` | slice 2, K-rows |
| G21 | non-Markdown file outside the allowlist | allowlist | verdict 30 |
| G22 | front matter identical except one key (list-form values, quoted keys, CRLF opener, trailing-space opener, BOM, form-feed opener, language-tag opener; a description-only change passes) | content rule `front_matter_only`; a leading BOM makes the file unreadable and holds | slice 2, F-rows |
| G23 | CR line endings and byte-order marks in Markdown | a leading BOM is covered by readability for every matched file and the front-matter part by `front_matter_only`; carriage returns outside the front matter are a follow-up (design section 11) | slice 2, F-rows and B-rows |
| G24 | 150-line budget | `max_changed_lines` | verdict 34, 35 |
| G25 | triage edits only two sections of the backlog; no heading or preamble change | consumer (the first candidate for `extra_check` or a fifth rule type) | none |
| G26 | backlog file turned into a symlink | status `T`, `hold:owner` (`mode`) | verdict 27 |
| G27 | the merge message is printed only on PASS | `merge` params only on `merge` | verdict 57 |
| G28 | run the base branch's copy, never the pull request's | manifest from the trust ref; kit pinned (bootstrap, later) | collector 2 |

Not in the script but in that routine's procedure: every reported check run
must succeed (kit: named checks only, open question 14) and the pull request
must be mergeable (verdict 46, 47).

### 6.5 Other core tests

- `glob.test.js`: `**/claude*.md` matches `CLAUDE.md`, `docs/Claude.local.md`;
  `.github/**` matches `.github/a` and `.github/a/b`, not `x/.github/a`;
  `**/.claude/**` matches `.claude/s.json` and `a/.claude/s.json`; `src/*.go`
  does not match `src/a/b.go`; `src/**/*.go` matches `src/b.go` and
  `src/a/b.go`; patterns with `? [ ] { } ! \`, a leading `/` or empty are
  rejected; matching is case-insensitive.
- `manifest.test.js`: the schema example of the design is valid; each rule of
  the field table rejects a violating value (wrong `schema`, short or
  uppercase `kit`, empty `checks`, unknown `codex_clean`, invalid pattern, two
  queue lanes, bad lane name, `tier.auto` with `default: "auto"`, missing
  `tier.auto` with `default: "hold"`, non-positive `max_changed_lines`,
  `marker` without the prefix or with a newline, branch names with `..` or a
  leading `-`, unknown keys at every level).
- `queue.test.js`: the cases of verdict row 21, and the valid forms.

### 6.6 Collector, parser and CLI tests

- `parse.test.js`: (1) raw `-z` output with A, M, D, T entries and modes;
  (2) a path with non-ASCII UTF-8 bytes and a path with a newline;
  (3) numstat `-\t-\t` for a binary; (4) an unknown status letter throws;
  (5) invalid UTF-8 bytes give `pathBytesOk: false`.
- `collect.test.js` with a fake `run` that records calls and returns canned
  output: (1) every call is `execFile`-style with an argument array; (2) the
  manifest is read from the trust ref, never from the head ref or a file in
  the working tree, unless `manifestFile` is given; (3) a fetched head that
  differs from the API head throws; (4) the evaluated head SHA is the API's,
  even when a Codex summary names another; (5) only pull request N's comments
  and reviews are requested; (6) pagination reads a second page after 100
  items and stops after a short page; (7) a `gh` or `git` non-zero exit
  throws; (8) ref names with `..`, a leading `-` or a space throw before any
  git call; (9) replay: `baseSha` is the merge commit's first parent, the
  title is reconstructed from `renamed` events, and the limits listed in
  section 4 are added.
- `cli.test.js`: exit 0 for `merge`, 1 for other verdicts and for
  `collect-failed`, 2 for usage errors; output is one JSON object (one per
  line for `backtest`, ending with the summary line); `anomalies` and
  `unmarkedNotMerge` are computed from markers and verdicts as specified.

## 7. Order of work

1. `package.json`, constants, `glob.js` with its tests.
2. `manifest.js`, `queue.js` with tests.
3. `codex.js`: port the parser with tests C1 to C25.
4. `verdict.js` with the table of 6.1.
5. `parse.js`, `proc.js`, `github.js`, `git.js`, `collect.js` with tests.
6. `cli.js` with tests.
7. Backtest each consumer over the last month with a manifest written for the
   backtest (kept outside this repository for private consumers) and record
   the results where open question 10 decides.

## 8. Out of Phase 1

Hook adapter and bootstrap; `extra_check` (its contract is recorded, not
built); interactive lane (not built); the on-disk manifest templates and
`rules.md` templates; the runner procedure; desk changes; detection of commits
that belong to no pull request. The content rules, the path check and the
hook's policy reading are specified in sections 9 to 11. See the design's
follow-ups.

## 9. Slice 2: content rules in the core

Behaviour: [design 5.4.1](design.md#541-content-rules-later-slice) and section
6. Same constraints as Phase 1: the core is pure (no I/O, no clock, no
randomness), no dependencies, tests with `node:test`, each test written before
the code it tests. The schema stays version 1: `content_rules` is an optional
key, and a manifest without it behaves as before. Validation and evaluation of
`content_rules` land in the same pull request: a build in which the manifest
parser accepts the key but nothing evaluates it would be less strict than a
manifest that omits the rules. If the work is split, the parser keeps
rejecting the key until evaluation exists.

### 9.1 Module layout

```text
src/core/constants.js    adds CONTENT_MAX_BYTES = 1048576
src/core/content.js      pure: splitLines, matchLine, changedLines, parseStrictJson, readFrontMatter,
                         evaluateContentRules(manifest, files, contents), contentTargets(manifest, files)
src/core/manifest.js     validates content_rules (below)
src/core/verdict.js      step 5 (change set): calls evaluateContentRules; adds the reason codes below
src/collect/collect.js   reads the blobs that contentTargets names and adds `contents` to the input
test/core/content.test.js, test/core/manifest.test.js, test/core/verdict.test.js, test/collect/collect.test.js
```

### 9.2 Data shapes

```js
/**
 * GateInput gains:
 * @property {Record<string, {base: ContentSide, head: ContentSide}>} contents
 *           keyed by the diff path; present exactly for the paths contentTargets(manifest, files) returns
 *
 * @typedef {{state: 'absent'} | {state: 'present', size: number, bytes: Uint8Array|null}} ContentSide
 *           bytes is null when size > CONTENT_MAX_BYTES: the collector reads the size with
 *           `git cat-file -s` and does not read the blob
 */
```

`contentTargets(manifest, files)` returns the paths of entries that match a
glob of `hold_on_line_change`, `keys_only` or `front_matter_only`, excluding,
as two independent conditions, every entry of status `T` and every entry whose
head mode exists and is not `100644`; both already hold on mode. Neither
condition implies the other: a symlink turned into a regular file is status `T`
with head mode `100644`, and an added executable is status `A` with head mode
`100755`. A deleted entry has no head mode and is a target. Type 1 needs no contents. The collector reads, for each
target, the blob at the merge base (state `absent` when the status is `A`) and
at the head (state `absent` when the status is `D`). The core, not the
collector, decides readability: size over the cap (`bytes: null`), invalid
UTF-8, a NUL byte or a leading U+FEFF is unreadable. Decoding uses
`new TextDecoder('utf-8', {fatal: true, ignoreBOM: true})`: with the default
`ignoreBOM: false` the decoder would silently drop a leading byte-order mark,
and the readability check must see it. A target path missing from `contents`,
a side given as `absent` where the status says it exists (base of `M` and `D`,
head of `A` and `M`), or a side given as `present` where the status says it is
absent, gives `blocked:input` (`content-missing`).

New reason codes, added to the table of section 2.1:

| Verdict | Codes |
| --- | --- |
| `hold:owner` | `rule-add-delete`, `rule-line-change`, `rule-keys`, `rule-front-matter`; detail is `<path>: <word>`, the word one of `added`, `deleted`, `line-changed`, `key-changed`, `front-matter-invalid`, `front-matter-changed`, `unreadable` |
| `blocked:input` | `content-missing` |

No reason carries text from a file. Order inside `hold:owner`, so that
deep-equal tests are determinate: reasons are added in the per-entry loop in
diff order; for one entry, after its mode, binary, floor, hold-path and
not-in-allowlist reasons, content reasons in the order of the types (`rule-add-delete`,
`rule-line-change`, `rule-keys`, `rule-front-matter`) and within a type in the
order of the rules in the manifest array; the per-pull-request `too-large`
follows all entries.

### 9.3 Functions

```js
export function splitLines(text)            // -> string[]: split at \n, drop one trailing \r per line, no phantom final line
export function matchLine(pattern, line)    // -> boolean; pattern valid: literal, optional leading ^, optional trailing $
export function changedLines(pattern, baseText|null, headText|null) // -> boolean: a matching line text with differing counts
export function parseStrictJson(text)       // -> {ok: true, value} | {ok: false}: object top level, no BOM, no duplicate key at any depth
export function readFrontMatter(text|null)  // -> {ok: true, blocks: Map<string,string>} | {ok: false}; null or no `---` first line gives empty blocks
export function evaluateContentRules(manifest, files, contents) // -> Reason[]
export function contentTargets(manifest, files)                 // -> string[]
```

`parseStrictJson` is a small tokenizer around `JSON.parse`: it scans for object
keys to detect duplicates and leaves value parsing to `JSON.parse`.

### 9.4 Tests

Manifest (`manifest.test.js`):

| # | Case | Expected |
| --- | --- | --- |
| M1 | no `content_rules` | valid; the parsed manifest has none |
| M2 | one valid entry of each type; all four; empty arrays | valid |
| M3 | `content_rules` not an object; unknown key in it; a type whose value is not an array | invalid |
| M4 | an entry that is not an object, lacks `glob`, `pattern` or `keys`, or has an unknown key | invalid |
| M5 | `hold_on_add_delete` entry that is not a string; any glob invalid under section 5.4 | invalid |
| M6 | pattern empty, `^`, `$`, `^$`, not a string | invalid |
| M7 | `keys` empty, with a duplicate, with an empty string, with a non-string | invalid |
| M8 | the `content_rules` fragment of the design merged into the example block | valid |

Line helpers (`content.test.js`):

| # | Case | Expected |
| --- | --- | --- |
| L1 | `splitLines`: `a\nb`, `a\nb\n`, empty string, `a\r\nb`, a lone `\r` in the middle, blank lines | as design 5.4.1 (empty gives no lines; one trailing `\r` dropped) |
| L2 | `matchLine`: `Status:` anywhere; `^Status:` at the start only; `x$` at the end only; `^x$` whole line; case difference; `.` and `*` and `\` literal | as the syntax |
| L3 | `changedLines`: a matching line added; removed; edited (one removed, one added); moved only; duplicated 1 to 2; 2 to 1; no matching line; identical files | true, true, true, false, true, true, false, false |
| L4 | `changedLines`: base absent (all head lines added); head absent (all base lines removed) | per matching line present |

Rules (`content.test.js`, through `evaluateContentRules`):

| # | Rule | Case | Expected |
| --- | --- | --- | --- |
| A1 | `hold_on_add_delete` | status `A` under the glob; status `D`; status `M`; outside the glob; glob matched in a different case | `rule-add-delete` (added); (deleted); none; none; `rule-add-delete` |
| A2 | `hold_on_add_delete` | a rename of a file inside the glob (D plus A) to a path inside it; to a path outside it; from outside to inside | two reasons; one (deleted); one (added) |
| A3 | `hold_on_add_delete` | status `T` | none (the mode condition holds it) |
| N1 | `hold_on_line_change` | the cases of L3 through a manifest; two rules over one file | `rule-line-change` where changed; reasons per rule |
| N2 | `hold_on_line_change` | blob over the cap (`bytes: null`); invalid UTF-8; NUL byte | `rule-line-change` (unreadable) |
| K1 | `keys_only` | only a named key changed; a named key added; a named key removed; reformatted only; key order changed | none |
| K2 | `keys_only` | an unnamed key changed; added; removed; a nested value of an unnamed key changed; array order changed | `rule-keys` (key-changed) |
| K3 | `keys_only` | numbers `1` and `1.0`; objects equal with different key order | equal: none |
| K4 | `keys_only` | status `A`; status `D` | `rule-keys` (added; deleted) |
| K5 | `keys_only` | base or head: not JSON; top level an array; a BOM; a duplicate key at depth 1 and depth 3; unreadable | `rule-keys` (unreadable) |
| F1 | `front_matter_only` | only a named key's block changed; a named key added; removed | none |
| F2 | `front_matter_only` | an unnamed key's value changed; its list-form continuation lines changed; a key added; a key removed | `rule-front-matter` (front-matter-changed) |
| F3 | `front_matter_only` | body edited only, front matter identical; neither side has front matter | none |
| F4 | `front_matter_only` | head opener `--- `, `---yaml`, `----`; CRLF opener; no closing `---`; a `\r` inside; a comment line at column 0; a quoted key; a repeated key; a stray line before the first key | `rule-front-matter` (front-matter-invalid) |
| F5 | `front_matter_only` | a leading form feed in the head where the base has front matter with an unnamed key | `rule-front-matter` (front-matter-changed): the keys vanished |
| F6 | `front_matter_only` | base ill-formed, head identical | `rule-front-matter` (front-matter-invalid) |
| F7 | `front_matter_only` | added file with only named keys; added file with another key; deleted file with another key | none; `front-matter-changed`; `front-matter-changed` |
| B1 | `front_matter_only`, keys `["description"]` | an added file whose head is U+FEFF, `---\nname: x\n---\n` | `rule-front-matter` (unreadable) |
| B2 | `front_matter_only` | a modified file whose head gains a leading U+FEFF before an otherwise identical front matter | `rule-front-matter` (unreadable) |
| B3 | `hold_on_line_change`, pattern `^Status:` | a head whose first line is U+FEFF followed by `Status: x`; the same on the base side only | `rule-line-change` (unreadable) |
| B4 | `keys_only` | a head that begins with U+FEFF | `rule-keys` (unreadable) |
| B5 | all | a U+FEFF that is not at the start of the file | readable: evaluated as text |
| F8 | `front_matter_only` | unreadable blob | `rule-front-matter` (unreadable) |
| X1 | all | `contentTargets`: paths of statuses A, M, D matching a type 2 to 4 glob; status `T` with head mode `100644` (a symlink turned into a regular file); status `T` with head mode `120000`; head mode `100755`, `120000` or `160000` with status `A` or `M`; a type 1 glob only; no rules | the matching paths; excluded; excluded; excluded; empty; empty |
| X2 | all | a target path missing from `contents`; a side `absent` for status `M`; the head side `absent` for status `A`; the base side `present` for status `A`; the head side `present` for status `D` | `blocked:input` (`content-missing`) |
| X3 | all | no reason contains any text of any file, for every row above | holds |

Verdict (`verdict.test.js`, continuing the numbering of 6.1; the baseline gains
no `content_rules`):

| # | Change from baseline | Expected verdict | Code |
| --- | --- | --- | --- |
| 65 | `hold_on_add_delete: ["docs/**"]`; one added `docs/x.md`; the allowlist includes `docs/**` | `hold:owner` | `rule-add-delete` (the allowlist does not override it) |
| 66 | a content-rule path that is also in `hold_paths` | `hold:owner` | both `hold-path` and the rule's code |
| 67 | a content-rule path that is a floor path | `hold:owner` | `floor` and the rule's code |
| 68 | the item's own report matched by a content rule it violates | `hold:owner` | the rule's code (the report exemption does not cover content rules) |
| 69 | a file under `keys_only` with only the named key changed, in the allowlist | `merge` | |
| 70 | as 69 but outside the allowlist | `hold:owner` | `not-in-allowlist` (a content rule never grants) |
| 71 | `contents` missing for a target | `blocked:input` | `content-missing` |
| 72 | replay: the same input with `asOf` set later than every check-run and reviewer timestamp in the baseline (otherwise replay legitimately differs) | the same verdict and reasons as live | |
| 74 | two content reasons on one entry and one on another; `too-large` also exceeded | reasons in the order of 9.2 (deep-equal) | |
| 73 | two evaluations of one input deep-equal; the input is not mutated | | |

Collector (`collect.test.js`):

| # | Case | Expected |
| --- | --- | --- |
| C1 | `contentTargets` is empty | no blob command is run |
| C2 | a target with status `M`, `A`, `D` | blobs read at the merge base and the head; `absent` for the missing side |
| C3 | a blob larger than the cap | `git cat-file -s` only; `bytes: null` |
| C4 | blobs come from the merge base and the head, never from the base tip or the working tree | the fake `run` sees only those object names |
| C5 | replay | the same objects as live |

### 9.5 Order of work

1. `constants.js`; write the manifest rows M1 to M8, but keep the parser
   rejecting `content_rules` until step 3 is done (the key is accepted only
   when evaluation exists).
2. `content.js` helpers with L1 to L4, then the four rule types with A, N, K,
   F, B and X rows.
3. `verdict.js` integration with rows 65 to 74, and in the same pull request
   the parser change that accepts the key.
4. `collect.js` with rows C1 to C5.
5. Add the `content_rules` fragment to the design's example block, so that the
   existing example test covers it.

## 10. Slice 3: the path check without a pull request

Behaviour: [design 8.6](design.md#86-path-check-without-a-pull-request-later-slice).
It reuses the core's change-set evaluation, so the gate and the check cannot
disagree.

### 10.1 Module layout

```text
src/core/constants.js    FLOOR becomes [{id, patterns: [{pattern, classes}], writeTimeDeny: [pattern]}], ids as in design 5.4;
                         writeTimeDeny is a subset of the category's patterns (possibly empty); classes is a list per pattern
src/core/changes.js      classifyChanges({manifest, laneName, itemId, files, contents}) -> {paths, reasons}
src/core/verdict.js      step 5 (change set) calls classifyChanges; behaviour unchanged
src/collect/collect-paths.js  collectPaths({repo, repoDir, base, head, lane, item, manifestFile}, deps) -> PathInput
src/cli.js               adds check-paths
test/core/changes.test.js, test/collect/collect-paths.test.js, test/cli.test.js
```

The first step is a refactor with no behaviour change: the existing verdict
tests (6.1) must pass unmodified before `check-paths` is added.

### 10.2 Contract

```text
agent-pipeline-gate check-paths --repo OWNER/NAME --repo-dir DIR --base BRANCH --head SHA [--lane NAME] [--item ID] [--manifest FILE]
```

- `--head` is a full 40-hex commit SHA that must exist in the clone;
  `--base` is a branch name that passes the ref-name validation of section 4,
  fetched fresh from `origin` into the private namespace. The diff is
  `merge-base..head`, read with the commands of 4, step 6; blobs for
  `contentTargets` as in 9. Nothing is checked out.
- The manifest is read as in section 4, step 4. `--manifest FILE` is accepted;
  the output records `manifest.source` (`trust-ref` or `file`) and the blob id
  read.
- A `--lane` that is not a lane of the manifest gives `blocked:lane`
  (`unknown-lane`), exit 1, never `clear`.
- `--item` must match `^[a-z0-9][a-z0-9-]*$` and requires `--lane`; with a lane
  that is not a queue lane it is also a usage error (exit 2).
- `--base` is supplied by the caller and is not validated against the lane's
  base branch (design 8.6); the report is for the base given.
- `classifyChanges` returns, per path, `classes` in the order of the design's
  table and the reasons that `evaluate` would give for the change-set
  conditions. With no lane, the lane-dependent conditions (allowlist, strong
  review, line budget, own-report exemption) are skipped and no path gets
  `not-in-allowlist`, `strong-review` or `own-report`.
- Output: one JSON object with `repo`, `kit`, `base` (`ref`, `sha`),
  `mergeBase`, `head`, `lane`, `manifest`, `result`, `reasons`, `paths`
  (`path`, `status`, `classes`), as design 8.6. Exit 0 for `clear`, 1 for any
  other result including `collect-failed`, 2 for a usage error.

### 10.3 Tests

`changes.test.js` (table-driven, one row per `classes` outcome):

| # | Case | Expected |
| --- | --- | --- |
| P1 | a modified file inside the allowlist, lane given | `allowed`; `result: clear` |
| P2 | one path per floor category id, including the cases of 6.1 row 24 | `floor:<id>`; `hold:owner` |
| P3 | `hold_paths` entry | `hold-path` |
| P4 | a path outside the allowlist; the same path with no lane | `not-in-allowlist`; `allowed` |
| P5 | `tier.strong_review` path | `strong-review`; `hold:strong-review` |
| P6 | one path per content rule type violated | `content:add-delete`, `content:line-change`, `content:keys`, `content:front-matter` |
| P7 | mode `100755`; a NUL byte | `mode`; `binary` |
| P8 | a path that is a floor path, a hold path and a content-rule violation | all three classes, in the table's order |
| P9 | the own report with `--item`; without `--item`; another item's report | `own-report`; `floor:ci-pipeline`; `floor:ci-pipeline` |
| P10 | the own report violating a content rule | the content class (exemption limited to floor, allowlist, strong review) |
| P11 | `max_changed_lines` exceeded, lane given | `result: hold:owner`, reason `too-large` |
| P12 | agreement: for every verdict row of 6.1 and 9.4 whose expected verdict has change-set reasons, `classifyChanges` returns the same reasons that `evaluate` returns | equal |
| P13 | no reason carries file text | holds |
| P14 | `--lane` names no lane of the manifest (with and without content rules) | `blocked:lane` (`unknown-lane`), exit 1, no `paths` marked clear |
| P15 | `--item` `A_b`, `-x`, empty, `x/y`; `--item` without `--lane`; `--item` with a caller lane | usage error, exit 2 |
| P16 | `--base` a branch other than the lane's base | the report for that base; no error |

`collect-paths.test.js` (fake `run`): the manifest is read from the trust ref
unless `manifestFile` is given, and the output says which; `--head` that is not
in the clone throws `collect-failed`; `..`, a leading `-` or a space in `--base`
throws before any git call; every call is an argument array; the namespace refs
are deleted.

`cli.test.js`: exit 0 for `clear`, 1 for a hold and for `collect-failed`, 2 for
a usage error (missing `--head`, a head that is not 40 hex, `--item` without a
queue lane); output is one JSON object; `blocked:manifest` for a missing
manifest; `blocked:empty-diff` when head equals the merge base.

### 10.4 Order of work

1. `FLOOR` as categories; update the glob and floor tests; the verdict tests
   pass unmodified.
2. `changes.js` extracted from `verdict.js`; P12 as the safety net.
3. `collect-paths.js`, then the CLI command.

## 11. Slice 4: the hook reads the same policy

Starts after the Phase 0 checks of design 8.5 have been run, because their
results decide whether the hook or the procedure call carries the enforcement
(the probe kit is in `probes/phase0/`). The policy part is specified here so
that the hook cannot grow a list of its own.

```text
src/core/writeguard.js   writeDecision({manifest, laneName, itemId, path, op}) -> {decision: 'deny', reason} | {decision: 'none'}
test/core/writeguard.test.js
```

`writeDecision` denies when `laneName` is set (the hook passes the value of
`PIPELINE_LANE`; a set, non-empty value is runner mode whether or not it names
a queue lane of the manifest, because the write-time patterns come from the
floor and need no lane) and `path` matches one of the `writeTimeDeny` patterns of
a floor category (design 5.4), never merely a pattern of the category, except `.agent-line/reports/<itemId>.md`
for `op: 'write'` and `op: 'create'`. Any other path, and an interactive
session (`laneName` undefined or empty), give `none`. The own-report exemption
applies only when `laneName` names a queue lane of the manifest and `itemId`
is in the queue-id form; otherwise the report path is denied like the rest of
`.agent-line/**`. It reads no list of its own.

| # | Case | Expected |
| --- | --- | --- |
| W1 | `.github/workflows/ci.yml`, `.github/x`, `.GitHub/x` | deny |
| W2 | `.agent-line/queue/a.md`, `.agent-line/manifest.json`, `.agent-line/reports/other.md` | deny |
| W3 | `.agent-line/reports/<itemId>.md` write and create; delete | none; deny |
| W4 | `.claude/settings.json`, `a/.claude/hooks/x` | deny |
| W5 | `package.json`, `CLAUDE.md`, `docs/agents-notes.md`, `.codex/config`, `.husky/pre-commit` (floor patterns that are not write-time) | none |
| W6 | a `hold_paths` entry; a path outside the allowlist | none |
| W7 | no lane (undefined or empty) | none |
| W7a | a lane name the manifest does not have, a caller-kind lane name, or a manifest that failed to parse: W1, W2 and W4 paths; the item's own report | deny; deny |
| W8 | the set of write-time patterns equals the write-time column of the design's table (a test reads the table), and each is one of its category's `patterns` | equal; subset |
| W9 | every floor category's `classes` lists are non-empty and each pattern has at least one of authority, execution, oracle | holds |

The hook adapter itself (settings entry, matcher, exit codes, `onFailure`) is
specified in design 8.1 and is tested when it is built. That slice also closes
review findings R2 and R3 of the open questions: the collector fetches by
explicit URL with hooks disabled, and `evaluate` stops accepting `--manifest`
(it stays on `replay` and `backtest`; `check-paths` accepts it and records the
source in its output). The hook never passes it.

Push-time enumeration is a requirement of the hook adapter, not of
`writeDecision`: the adapter must obtain the paths a call writes. For a push or
any call that updates a remote ref it takes the raw diff of the pushed range
against the remote ref, passes every path to `writeDecision`, and denies when
the range cannot be determined (design 8.1, open question 32). Bash can write
files and push with no per-path tool call, so a file-write matcher alone is
not enough.
