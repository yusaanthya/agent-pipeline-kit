# Open questions

Unsettled items. Each is marked **kit-level** (decided once, in this
repository) or **per-repo** (decided when that consumer migrates, before its
overlay step, with backtest data). "Recommendation" is the current proposal
where one exists; "not reviewed" means no critic has examined it.

Items 1 to 11 were left open when the design-level review closed. Items 12 and
later were found while writing this repository's specification.

## Left open by the design review

**1. Where the game consumer reads its manifest, kit pin and hook from.**
Per-repo (the game consumer). Its sessions work on the preview branch.
Reading from `main` means every manifest change needs a promotion first;
reading from the preview branch matches how its runner reads its
specification today and relies on the floor to protect the file.
Recommendation: the preview branch. Not reviewed. If adopted, the design's
trust root (default branch) needs a per-consumer trust branch.

**2. Scope of the runner-lane write restriction in the hook.** Kit-level
mechanism, per-repo lists. Settled so far: it must not block files that a queue
item explicitly allows the runner to change; it blocks only `.github/`,
`.agent-line/` (except the item's own report) and `.claude/`. The rest is open.

**3. quorum-election-simulator: keep its sensitive-path list or move to an
allowlist.** Per-repo. A security critic recommended an allowlist because a
merge there deploys production; a continuity critic pointed out it is a
behaviour change. A trial allowlist (`internal/**`, `cmd/**`, `web/src/**`, the
test scripts, `readme.md`) passed all 10 sampled runner pull requests.
Recommendation: keep the current list at the switch; evaluate the allowlist in
a separate pull request so the migration carries no behaviour change. Not
reviewed.

**4. Interactive behaviour on `fix`, `update`, `wait` and `blocked`.**
Kit-level, decided once when the kit is built (that is, now). Deny is safer;
ask keeps every consumer's current rule that the owner may merge anything by
saying so. Recommendation: ask; the runner is denied in every case either way.
Not reviewed. Not decided.

**5. Which paths need strong-model review.** Per-repo. No recommendation.
Until decided, `tier.strong_review` is empty and `hold:strong-review` is never
produced.

**6. The full list of calls the hook intercepts.** Kit-level. Beyond the merge
tools: the endpoint that merges a branch without a pull request, ref updates,
file deletions through the API, `gh pr merge --auto`, and pushes to a lane base
or the default branch. Tool names in scheduled tasks are a Phase 0 check.

**7. What replay needs from the issue timeline.** Kit-level. Draft and title
changes are only visible in the timeline. Phase 1 reconstructs the title from
`renamed` events and takes draft as false at merge time (GitHub does not merge
drafts; not re-verified). Whether that is enough is open.

**8. Complete deletion lists per migration phase.** Per-repo. Merge
conditions are restated in more than twenty places across the consumers
(runner specifications, gate documents, agent instruction files, backlog and
routine files, a decision index). Each consumer's switch step must list what
it deletes.

**9. Two consumer-specific checks: gate or `rules.md`.** Per-repo.
(a) quorum-election-simulator's runner treats a pull request as a runner pull
request only if the oldest first-parent commit after the merge base is the
empty claim commit. (b) The game consumer leaves for the owner any pull request
that adds, deletes or renames a file under its specifications directory, or
adds or removes a `Date:` or `Status:` line there. An earlier draft placed (b)
in a consumer `extra_check` (item 18). No recommendation.

**10. Where the shadow verdicts are recorded and what counts as passing.**
Kit-level procedure, per-repo thresholds. No recommendation.

**11. Kit downgrades and the kit repository's own merge rules.** Kit-level.
The bootstrap's reachability check accepts a pin to an older kit commit. Not
decided: whether a downgrade needs a rule, who merges into this repository,
and whether this repository gets a ruleset of its own.

## Found while writing the specification

**12. Manifest file format and name.** Kit-level. Earlier drafts named
`.agent-line/manifest.yml`. The kit has no runtime dependencies and Node.js has
no YAML parser; a YAML subset parser would be code the gate's trust depends on.
Recommendation: JSON, `.agent-line/manifest.json`. Not reviewed. Phase 1 reads
JSON, from the default branch or from a file passed to the CLI.

**13. Merge marker attribution in the multi-repo routine.** Per-repo. Its
script prints `Auto-Merged-By: <prefix>-<running routine>`, naming the
routine that ran the gate (nightly or triage), not the pull request's kind. The kit's marker is
per lane, so it names the pull request's lane. Whether the desk or the owner
relies on the running-routine attribution is not known.

**14. Check runs the manifest does not name.** Kit-level. The multi-repo
routine today parks a pull request if any reported check run concluded other
than success; the kit evaluates only the named checks and ignores the rest.
Recommendation: each manifest names every check its CI produces; a new
workflow is a floor change, so the owner sees it and can update the manifest.
Not reviewed.

**15. Codex security review under `no_blocking`.** Kit-level. The
routine's script requires a present security review to be completed without
findings; the other consumers' scripts ignore it. The kit follows each
consumer's current behaviour. Whether security reviews appear on their pull
requests at all has not been checked.

**16. How a `hold:strong-review` pull request reaches `merge`.** Kit-level.
The gate has no input that records a passed strong review, and adding one
would be an agent-writable approval. The design resolves it by the owner's
confirmation inside the owner-started review loop. Whether that confirmation
step fits the review loop's current flow is not checked; the loop is outside
Phase 1.

**17. Halt label timing in replay.** Kit-level. Replay considers issues that
carry `pipeline-halt` now and were open at merge time; when the label was added
or removed is not reconstructed. Reading issue events would close this. No
recommendation.

**18. `extra_check` interface and execution.** Kit-level. Specified in the
design as a follow-up; needed before the multi-repo routine migrates, because
its current script checks file contents (front matter, a version-only JSON
change, sections of its backlog file, line endings and byte-order marks). Open:
how the script is run without a token in its environment, its time limit, and
its output contract.

**19. Interactive lane.** Kit-level mechanism, per-repo choice. Which
consumers want gate-decided self-merge of interactive pull requests is
undecided; the private consumers have it off.

**20. Exactly one Codex summary.** Per-repo backtest item. The kit (like the
two JavaScript scripts) requires exactly one trusted summary comment and
blocks on more; the routine's procedure took the newest one. If backtests show
more than one summary on that routine's pull requests, the rule needs a
decision.

**21. `skipped` and `neutral` named checks.** Kit-level. GitHub counts them
as passing for required checks; the kit gives `blocked:check`. Backtests will
show whether any consumer's named check is ever skipped on a merged pull
request.

## Recorded review findings (not fixed)

Found by the code review of the first slice. Each needs an input not seen in a
real run, or belongs to a later slice, so it is recorded here and not fixed.

- **R1. Line budget and git attributes.** `git diff --numstat` honours `-diff`
  and `binary` attributes, so a text file under such an attribute reports no
  line counts, counts as 0 lines towards `max_changed_lines`, and still passes
  the NUL check. `.gitattributes` is a floor path, so only an owner-merged
  attribute can cause it. Fix when a consumer has such an attribute: hold on
  missing counts for a NUL-free regular file, or count lines from the blobs.
- **R2. The collector trusts the local git configuration.** It fetches from
  the `origin` remote of the directory it is given and runs with that
  directory's hooks and URL rewrites. A changed remote could supply a false
  trust root. Deliberate circumvention; to be closed in the hook slice (fetch
  by explicit URL, disable hooks).
- **R3. `evaluate --manifest FILE` in live mode.** A manifest passed on the
  command line replaces the trust root, and the output does not say so. The
  hook slice must not pass this option; restricting it to `replay` and
  `backtest` is the likely fix.
- **R4. Check run without a start time.** Such a run sorts as oldest, so an
  older completed run of the same name can win. Not seen from GitHub Actions.
- **R5. Codex finding flags cover the whole pull request.** On real data a
  head reviewed clean can still carry `has_any_findings: true` from unresolved
  threads on earlier commits; the gate then gives `blocked:codex`
  (`findings-unverified`), as the source script does. It fails closed; expect
  it in backtests.
- **R6. Check-name collisions.** Any GitHub Actions job with a listed name
  counts, whichever workflow ran it. A per-consumer manifest concern, related
  to question 14.
- **R7. Test fixtures are synthetic.** They copy the observed shapes of Codex
  output; none is an unmodified capture.
- **R8. CI actions are referenced by tag, not by commit.** The workflow has
  read-only permission.
