# Open questions

Unsettled items. Each is marked **kit-level** (decided once, in this
repository) or **per-repo** (decided when that consumer migrates, before its
overlay step, with backtest data). "Recommendation" is the current proposal
where one exists; "not reviewed" means no critic has examined it.

Items 1 to 11 were left open when the design-level review closed. Items 12 to
21 were found while writing this repository's specification. Items 22 to 32
were added with the policy-shape change of 2026-11-22
([decisions](decisions.md), [research note](research/2026-11-policy-shape.md)).
An item marked **Closed** or **Decided** keeps its number, so that references
stay valid; its text says what settled it.

## Left open by the design review

**1. Where the game consumer reads its manifest, kit pin and hook from.**
Per-repo (the game consumer). Its sessions work on the preview branch.
Reading from `main` means every manifest change needs a promotion first;
reading from the preview branch matches how its runner reads its
specification today and relies on the floor to protect the file.
Recommendation: the preview branch. Not reviewed. If adopted, the design's
trust root (default branch) needs a per-consumer trust branch. The answer also
fixes which branch the path check and the hook read, and it must be settled
before that consumer's switch step (design section 10), because the runner
specification's prose list becomes a pointer to the manifest there. Not
decided.

**2. Scope of the runner-lane write restriction in the hook.** Kit-level.
Settled: the hook has no list of its own. It reads the write-time column of
the floor table (design section 5.4): `.github/**`, `.agent-line/**` except
the item's own report, and `**/.claude/**`, because those act before any merge
or take effect in the session. Everything the policy only holds at merge is
not denied at write time, so the runner may still open a pull request that
changes it and a queue item may still ask for it. Open: whether a consumer
needs additions to the write-time set, and how the hook learns the item's
identity for the own-report exception.

**3. quorum-election-simulator: keep its sensitive-path list or move to an
allowlist.** **Closed 2026-11-22.** Runner lanes are written as allowlists
with default hold (decision 2026-11-22), so this consumer's manifest is an
allowlist, not a carry-over of its current list. A security critic had
recommended it because a merge there deploys production; a continuity critic
had pointed out it is a behaviour change, and an allowlist is stricter, which
the overlay step allows. A trial allowlist (`internal/**`, `cmd/**`,
`web/src/**`, the test scripts, `readme.md`) passed all 10 sampled pull
requests inferred to be runner merges (the author's classification, not a
record kept by the runner). The entries are chosen at this consumer's migration from its
backtest.

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
it deletes. Prose copies of the path policy are deleted, and replaced by a
pointer to the manifest, only after the path check exists (design sections 6
and 8.6).

**9. Two consumer-specific checks: gate or `rules.md`.** Per-repo.
(a) quorum-election-simulator's runner treats a pull request as a runner pull
request only if the oldest first-parent commit after the merge base is the
empty claim commit. No recommendation. (b) The game consumer leaves for the
owner any pull request that adds, deletes or renames a file under its
specifications directory, or adds or removes a `Date:` or `Status:` line
there. **(b) needs no script:** it is expressible with content rules,
`hold_on_add_delete` on the directory and `hold_on_line_change` with a pattern
for each of the two line prefixes (design section 5.4.1); whether and how to
write them is that consumer's decision at its migration. In its one-month
backtest no runner pull request violated either rule, so the rule was not
exercised.

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

**13. Merge marker attribution in the multi-repo routine.** Per-repo.
**Decided 2026-11-22:** the marker must name the pull request's lane (design
section 9). The routine's script prints `Auto-Merged-By: <prefix>-<running
routine>`, naming the routine that ran the gate (nightly or triage), not the
pull request's kind; replay would assign the wrong lane to a pull request of
one kind merged by the other kind's routine (a backtest inferred this for two
of six such pull requests). That consumer changes its marker before it
migrates. Open: whether the desk or the owner relies on the running-routine
attribution, and where that attribution then lives (for example in the
report); not known.

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

**18. `extra_check` interface and execution.** Kit-level. **Rewritten
2026-11-22:** content rules are declarative first (decision 2026-11-22). The
four types cover the multi-repo routine's front-matter rule and its
version-only JSON rule and the game consumer's two specification rules. The
contract of a consumer-supplied script is recorded in design section 11.1 and
built only for the first rule the types cannot express. That is the routine's
rule on named sections of its backlog file; its whole-file line-ending
rule is a second, smaller gap (a leading byte-order mark is already covered:
it makes a matched file unreadable, which holds). Open, and decided at that
consumer's migration: build the contract, or add a fifth type ("named
sections of one Markdown file stay unchanged"), and whether the line-ending
rule becomes a type.

**19. Interactive lane.** Kit-level mechanism, per-repo choice. **Decided
2026-11-22: not built now.** Both backtests show that the inputs an interactive
merge's rules depend on (the owner's message in the session, a named pull
request, a critic's waiver or convergence) are not inputs the gate can see, and
that with a lane forced onto the pull requests outside the queue lane, 1 of 74
got `merge` in one consumer. Reopen when a consumer's interactive rules can be
stated on inputs the gate reads; it would also need per-lane `hold_paths`.

**20. Exactly one Codex summary.** Per-repo backtest item. The kit (like the
two JavaScript scripts) requires exactly one trusted summary comment and
blocks on more; the routine's procedure took the newest one. If backtests show
more than one summary on that routine's pull requests, the rule needs a
decision.

**21. `skipped` and `neutral` named checks.** Kit-level. GitHub counts them
as passing for required checks; the kit gives `blocked:check`. Backtests will
show whether any consumer's named check is ever skipped on a merged pull
request.

## Added with the policy-shape change (2026-11-22)

**22. An oracle-defining source file as a hold path.** Per-repo, kit-level
principle. Whether a consumer's source file that holds the limits its checks
enforce, and its test, should be hold paths. The floor cannot know where a
consumer keeps them (design section 5.4); an allowlist that includes the source
tree lets a runner change them. In the game consumer's one-month backtest no
pull request touched such a file, and a finding that needs an input not seen
in a real run is recorded, not fixed. Not decided; no recommendation here.

**23. Home of the "owner pull request is open" rule.** Per-repo. A rule that
the runner does nothing while a pull request outside every lane is open needs
GitHub state. Its home is the gate core (a variant of the freeze: hold while
any open pull request is outside every lane, for which the gate already lists
open pull requests) or a step of the runner procedure. Never a content rule or
a script (decision 2026-11-22). The multi-repo routine's procedure already has
the step; in its backtest one pull request got `merge` where that step would
have stopped the run, a gap that matters only if the gate replaces the step.
Decided at the first migration that needs it.

**24. The lane source when backtesting history that predates a marker.**
Kit-level. `backtest` passes no lane, and a merge without a marker has no lane
in replay. In the multi-repo routine's backtest no merge carried the marker, so
0 of 79 pull requests resolved a lane; a title prefix the procedure itself
uses resolved 13, and a rule on the head branch name had 33 percent
precision. Not decided: whether `backtest` takes an explicit
lane rule for pre-marker history (a title prefix is agent-writable, so it is
acceptable only as an argument the backtest caller supplies, never as an input
the gate reads), or such history is replayed with a wrapper outside the kit.

**25. Pinning a public consumer's ruleset to the source app of its required
contexts.** Owner decision. It would amend the decision that the main line
changes no GitHub setting (2026-11-21). Before pinning, read the source app of
both required contexts on recent heads: a wrong pin stops every merge, and the
app must have reported the context recently. Not decided.

### Probes

Each probe is read-only or runs on a scratch repository, and every GitHub write
needs the owner's go-ahead. Outcomes are what each answer implies.

**26. Can the runner's connection push a change under the workflow
directory?** A throwaway session on the same connection pushes a trivial
workflow edit to a scratch branch. Yes: the hook's write-time deny
(design section 8.1) is the only pre-merge control. No: the platform enforces
it for the runner, and the floor stays as detection, because the permission can
change silently. Reports differ, and an official action's app requests
workflow write permission; test the connection method the runner uses.

**27. Can the runner's connection push directly to a stand-in lane base?**
The same session pushes to a scratch base branch. Yes (expected: the vendor
documents that its proxy does not limit which branch a push can update): the
gate is bypassed on private repositories (threat model residual 1), so the
desk's list of commits that belong to no pull request becomes required. No:
record it; the residual narrows to the merge API.

**28. Can a workflow in a pull request post a passing check under a listed
name, as the Actions app?** On a throwaway public repository, a pull request
adds a job with that name, and a second variant posts the check through the
checks API with a workflow that grants itself `checks: write`. Yes:
`.github/**` never leaves the floor and the design's reliance on it is
confirmed. No: threat model residual 6 weakens; keep the floor anyway.

**29. Are the reviewer's own edits to its summary comment attributed to the
reviewer?** A read-only GraphQL query, on summaries already edited, for
`editor`, `lastEditedAt` and `userContentEdits`. Yes: add a check that returns
`blocked:codex` when an edit's editor is not the reviewer, and correct threat
model residual 2. No: residual 2 stands. Either way, check whether the cloud
proxy lets a session read GraphQL at all; if it does not, the check can run
only on the owner's host (the desk), not in a session.

**30. Do a consumer's preview builds see secrets or production bindings, and
does the host build branches other than the preview branch?** The owner reads
the hosting project's settings. Yes: deploy and build configuration executes
with credentials, so those classes stay held and, once production deploys from
the default branch, the promotion pull request must show their diff. No:
preview-only harm today; keep holding deploy configuration, which costs
nothing while no runner pull request touches it. Re-run when production deploy
is enabled.

**31. Can the cloud runner authenticate as a GitHub App installation or another
separate identity?** Vendor documentation or a support question. Yes: the only
path to a real boundary opens (decision 2026-11-22, deferred). No: confirms
that the kit stays a guardrail with detection.

The Phase 0 hook checks of design section 8.5 are separate from these probes.
A reviewed kit that runs them in a throwaway repository is in
[`probes/phase0/`](../probes/phase0/README.md); it has never been run. Its
results decide the fallbacks in section 8.5 and inform questions 2, 4, 6 and 1
(hook scope, the answer to `ask`, the list of intercepted calls, and whether a
hook loads after a branch switch).

**32. Push-time enumeration for the hook's write and push deny.** Kit-level,
hook slice. The deny is only as good as the hook's ability to enumerate what a
call writes: a file-write tool names its path, but Bash can write files and
push commits with no per-path tool call. The intended rule, a requirement of
the hook slice: for a push, or any call that updates a remote ref, compute the
raw diff of the pushed range against the remote ref, evaluate every path of it
against the write-time column of the floor, and deny when the range cannot be
determined. The baseline is specified in design 8.1: the remote's own commit
for an existing target ref; for a target ref that does not exist yet (the first
push of a new topic branch), the merge base with the lane base read from the
remote; anything else is indeterminate and denies. Open: how the hook learns the remote ref and range for each
shape of call (`git push`, the API's ref and file writes), and which of them
it intercepts at all (question 6).

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
