# Implementation plan

What the code and tests do not say: the command-line contract, the mapping from
the legacy gate scripts to the kit, and the slices that are not built yet. The
behaviour is specified in [the design](design.md); where this plan and the
design disagree, the design wins and the disagreement is a bug in this plan.
Phase 1 (the gate library, its collector and the replay/backtest CLI) and slice
2 (content rules) are built: their module layout, data shapes, functions and
tests are in `src/` and `test/`, not here. Sections 10 and 11 are slices that
are not implemented.

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

## 6. Legacy scripts and the kit

The tests are in `test/`. The two tables below record how the behaviour of the
legacy gate scripts maps onto the kit; the test column names rows of those
test files.

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
| 10 | Strictness (not a difference between the variants) | P2/P3 advisory | P2/P3 advisory | `codex_clean` per manifest | another consumer, the multi-repo routine, requires no findings | `test/core/codex.test.js` |

### 6.4 Checks of the multi-repo routine's bash gate script

Each check of the script, what the kit does with it, and where it is tested.
"Content rule" means it becomes a `content_rules` entry of that consumer's
manifest (slice 2, design 5.4.1). "Consumer" means it has no declarative form: it
stays with that consumer, as the first candidate for the recorded `extra_check`
contract or for a further rule type (open question 18); its existing tests move
with it and are not part of Phase 1.

| # | Script check | Kit | Test |
| --- | --- | --- | --- |
| G1 | usage errors exit 2 | CLI usage errors exit 2 | cli |
| G2 | `--kind nightly\|triage` | caller lane, validated against the manifest | verdict 14, 16 |
| G3 | `--merged-by` names the running routine in the marker | marker is per lane; behaviour change, open question 13 | verdict 1, 53 |
| G4 | no parsable state | no summary: `wait:codex`; malformed: `blocked:codex` | codex C2, C4 |
| G5 | head is not a fetched commit | collector throws; `blocked:input` | collector 3 |
| G6 | reviewed SHA is not the head | `wait:codex` (`stale-review`) | codex C2 |
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
| G22 | front matter may change only its description | content rule `front_matter_only` | slice 2 |
| G23 | CR line endings and byte-order marks in Markdown | see [content-rule readability and front matter](design.md#541-content-rules) and the whole-file rule follow-up (design section 11) | slice 2 |
| G24 | 150-line budget | `max_changed_lines` | verdict 34, 35 |
| G25 | triage edits only two sections of the backlog; no heading or preamble change | consumer (the first candidate for `extra_check` or a fifth rule type) | none |
| G26 | backlog file turned into a symlink | status `T`, `hold:owner` (`mode`) | verdict 27 |
| G27 | the merge message is printed only on PASS | `merge` params only on `merge` | verdict 57 |
| G28 | run the base branch's copy, never the pull request's | manifest from the trust ref; kit pinned (bootstrap, later) | collector 2 |

Not in the script but in that routine's procedure: every reported check run
must succeed (kit: named checks only, open question 14) and the pull request
must be mergeable (verdict 46, 47).

## 8. Out of Phase 1

Hook adapter and bootstrap; `extra_check` (its contract is recorded, not
built); interactive lane (not built); the on-disk manifest templates and
`rules.md` templates; the runner procedure; desk changes; detection of commits
that belong to no pull request. The content rules, the path check and the
hook's policy reading are specified in the design and, for the later slices, in
sections 10 and 11 below. See the design's follow-ups.

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
tests (`test/core/verdict.test.js`) must pass unmodified before `check-paths` is added.

### 10.2 Contract

```text
agent-pipeline-gate check-paths --repo OWNER/NAME --repo-dir DIR --base BRANCH --head SHA [--lane NAME] [--item ID] [--manifest FILE]
```

- `--head` is a full 40-hex commit SHA that must exist in the clone;
  `--base` is a branch name that passes the ref-name validation of `src/collect/git.js`,
  fetched fresh from `origin` into the private namespace. The diff is
  `merge-base..head`, read with the commands of `src/collect/collect.js`; blobs for
  `contentTargets` as there. Nothing is checked out.
- The manifest is read as in `src/collect/collect.js`. `--manifest FILE` is accepted;
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
| P2 | one path per floor category id, including the cases of verdict row 24 in `test/core/verdict.test.js` | `floor:<id>`; `hold:owner` |
| P3 | `hold_paths` entry | `hold-path` |
| P4 | a path outside the allowlist; the same path with no lane | `not-in-allowlist`; `allowed` |
| P5 | `tier.strong_review` path | `strong-review`; `hold:strong-review` |
| P6 | one path per content rule type violated | `content:add-delete`, `content:line-change`, `content:keys`, `content:front-matter` |
| P7 | mode `100755`; a NUL byte | `mode`; `binary` |
| P8 | a path that is a floor path, a hold path and a content-rule violation | all three classes, in the table's order |
| P9 | the own report with `--item`; without `--item`; another item's report | `own-report`; `floor:ci-pipeline`; `floor:ci-pipeline` |
| P10 | the own report violating a content rule | the content class (exemption limited to floor, allowlist, strong review) |
| P11 | `max_changed_lines` exceeded, lane given | `result: hold:owner`, reason `too-large` |
| P12 | agreement: for every verdict row of `test/core/verdict.test.js` whose expected verdict has change-set reasons, `classifyChanges` returns the same reasons that `evaluate` returns | equal |
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
not enough. The baseline is the one design 8.1 names, and the adapter's tests
include these cases, all in runner mode with a queue lane whose base is read
from a fake remote:

| # | Case | Expected |
| --- | --- | --- |
| H1 | push to an existing remote ref; the range changes `src/a.js` only | no decision |
| H2 | first push of a new topic branch (no remote ref); its commits on top of the lane base change `src/a.js` only | no decision; the baseline is the merge base with the lane base read from the remote, not a local ref |
| H3 | as H2, one commit also changes `.github/workflows/ci.yml` | deny |
| H4 | as H2, a local remote-tracking ref of the lane base moved to the pushed commit | as H2 and H3: the local ref is not read |
| H5 | first push; no merge base with the lane base; the lane base cannot be fetched; the remote cannot be read; `PIPELINE_LANE` names no queue lane | deny (range indeterminate) |
