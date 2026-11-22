# Review brief

For an external reviewer of the policy-shape change of 2026-11-22. It is a
documentation change: it revises the design and adds a research note, a probe
kit and an implementation plan for three later slices. It changes no file under
`src/` or `test/`, and `npm test` still passes. This brief stands alone; you do
not need, and will not get, access to the consumer repositories other than the
public quorum-election-simulator.

## What you are asked to judge

Whether the revised documents describe one coherent design that an
implementer could build and a tester could test, and whether the new content
rules and the allowlist-first path policy let an agent-writable input allow a
merge. You are not asked to review code: there is none in this change.

## What changed and where

| Document | Change |
| --- | --- |
| [Design](design.md) | Section 5.4: the allowlist is the form of a runner lane; the floor table gains category ids, a class (authority, execution, oracle) and a write-time column; product code is deliberately off the floor. New section 5.4.1: four content-rule types with exact semantics. Section 6: one policy, two homes, three readers; the optional `content_rules` manifest key (schema stays 1). New section 8.6: the path check without a pull request. Section 8.1: the hook reads the floor's write-time column. Sections 5.5, 9, 10, 11: one-way check trust, pre-merge execution, the marker names the lane, migration order, follow-ups and the recorded `extra_check` contract (11.1) |
| [Decisions](decisions.md) | Nine entries dated 2026-11-22, one per decision, each with the reason and what it replaces, and a tenth that lists what is left open |
| [Threat model](threat-model.md) | Residuals 2, 6, 7 revised; 11 (pre-merge execution) and 12 (content rules are structural) added; protection table row; optional upgrades |
| [Open questions](open-questions.md) | 3 closed, 9, 13, 18, 19 rewritten, 1, 2, 8 updated; 22 to 25 added, and 26 to 31 as probes with what each outcome implies |
| [Implementation plan](implementation-plan.md) | Sections 9 to 11: content rules in the core, the path check, the hook's policy reading; test tables; order of work |
| [Research note](research/2026-11-policy-shape.md) | New: what outside practice does, with sources and a verified, summarised or inferred mark on every claim |
| [`probes/phase0/`](../probes/phase0/README.md) | New: a reviewed, never-run kit for the eight Phase 0 hook checks |
| [README](../README.md) | Status and layout only |

## What to read

1. [Design](design.md) sections 5.4, 5.4.1, 6, 8.1, 8.6, 9 and 11.
2. [Decisions](decisions.md), the entries of 2026-11-22.
3. [Threat model](threat-model.md): residuals 2, 6, 7, 11, 12.
4. [Implementation plan](implementation-plan.md) sections 9 to 11, for whether
   the semantics are testable as written.
5. [Open questions](open-questions.md) 22 to 31.

## Evidence

- **Research.** [The research note](research/2026-11-policy-shape.md) cites
  official documentation, source and papers. Its marks say which quotations
  were checked against page text and which came through a summarising tool.
  No published account of a solo, single-identity operator with unattended
  self-merge was found; the transfer to this setting is the author's
  inference.
- **Two backtests of private consumers.** They are not in this repository and
  you cannot check them; treat the figures as the author's report. One covers
  101 merged pull requests of one month in the game consumer: 10 were runner
  self-merges and all 10 replay as `merge`; 90 of 101 agree with what happened
  and none is a past miss of a written rule; an independent recomputation of
  the path holds over all 101 found no mismatch; a four-entry trial allowlist
  gave the same verdict on the ten self-merges (computed from the backtest
  facts, not re-run through the kit). The other covers 79 merged pull requests
  of the multi-repo consumer: none carried the marker, so replay assigned a
  lane to 0 of 79 (13 with the title prefix its procedure uses); comparing
  its existing script with the kit on 158 forced pairs gave 156 agreements;
  of the two differences, one is a gap that a front-matter rule closes and in
  the other the kit is the stricter. A separate case, an automation pull
  request merged while an owner pull request was open, is process state.
- **Probes.** The policy questions 26 to 31 and the Phase 0 hook checks have
  not been run. Nothing in this change relies on an outcome.

## Who the change must hold up against

An agent that acts with the owner's GitHub identity and makes mistakes or
overreaches, including trying another route after a refusal (TA), or that
follows instructions injected through repository content, dependencies, pull
request, issue or comment text, or fetched pages (TB). Not deliberate
multi-step circumvention (TC), and not compromise of the owner's account, of
GitHub or of the model providers. The owner is a solo developer. Read the
stance first: this is a guardrail with detection, not a boundary, and the
residual gaps it accepts are listed in the threat model. A finding that only
restates a listed residual is not new.

## What counts as blocking

A finding is blocking when it shows one of these, with a concrete input of a
kind a real run produces:

1. **A contradiction of a recorded decision**: the design or another document
   says something the decisions of 2026-11-22 (or earlier) rule out.
2. **A rule too vague to implement or to test**: two implementers could build
   different behaviour from the text of a content rule, the path check or the
   hook policy, or a test could not tell them apart.
3. **An agent-writable input that allows a merge**: any way that a title, label,
   comment, file content, branch name, argument or manifest-adjacent file lets a
   pull request reach `merge` that would otherwise hold, or removes a hold the
   floor, `hold_paths`, the allowlist or a content rule sets. This includes
   anything that lets a path-check `clear` be read as permission.
4. **An internal contradiction between documents**: a number, a section
   reference, a reason code, a field name or a verdict that differs between the
   design, the plan, the decisions, the open questions and the threat model.
5. **A false claim**: a statement presented as fact that is not true,
   including an unverified platform fact presented as verified, or a statement
   about what exists in this repository.
6. **Private or identifying content**: a private repository's name, path,
   number, title, date of an internal decision or any other detail that
   identifies a private consumer, a person, an account or a credential.

Everything else is non-blocking: style, naming, a clearer wording, an
additional test row that is not needed to make a rule testable.

## What is recorded, not fixed

A finding that needs an input not seen in a real run (for example a
file layout no consumer has, a Unicode normalisation trick on a path, or a
crafted blob that exploits a decoder) is recorded as a follow-up or an open
question with a one-line reason, not fixed in this change. Say which real run
would produce the input if you believe one would. A finding that needs a
deliberately constructed multi-step attack is TC and is recorded.

## Questions worth attacking

Content-rule semantics (design 5.4.1):

- Line changes are decided by comparing the count of each distinct line text
  between the two sides, so a moved line is not a change. Is there a plausible
  edit of a guarded line, in a file a consumer would guard, that this misses?
- Front matter is defined by a small block grammar. Do the malformed cases
  (opener variants, carriage returns, a leading byte-order mark or form feed,
  column-0 junk, repeated keys) leave any path on which a key outside the named
  set can change without a hold?
- `keys_only` compares top-level keys and rejects duplicate keys. Is a
  top-level-only rule enough for a version-only file in a real consumer?
- Unreadable means over 1 MiB, invalid UTF-8 or containing NUL, and holds.
  Does anything make a readable file hold wrongly often enough to matter?
- A rename is a deletion plus an addition, evaluated separately. Does a rename
  across the glob boundary behave as intended in every type?

Allowlist and default hold (design 5.4):

- Matching is case-insensitive, so a case variant of an allowed path is
  allowed. Is that acceptable for an allowlist, given that it only matters on a
  case-sensitive checkout?
- A `tier.auto` pattern that matches everything turns the allowlist into a
  denylist, and the schema does not reject it. Should it?
- An empty `tier.auto` lets only the item's own report merge. Is that the right
  failure mode?
- The floor's `.github/**` is root-only while `**/.claude/**` is nested. Is
  that difference deliberate and right?
- Moving a file from a held path into an allowed one holds by the deletion.
  Does any other move or mode change slip through?

Agent-writable inputs:

- Does anything in the new text let a head blob, a branch name, `--item`, a
  title or a path-check argument allow a merge, rather than only add a hold?
- Can a reason's detail carry file text, key names or line text anywhere?
- The path check takes a head SHA from the caller's clone. Is any consumer of
  its `clear` result able to treat it as permission to merge?
- When the merge could be `merge`, the base tip is an ancestor of the head, so
  the merge base equals the base tip; is the content rules' use of the merge
  base consistent with that in live and replay mode?

## Ending the review

A round ends when it has no blocking finding and every remaining finding is
either fixed or recorded with a reason. Please state, per finding, which of the
six blocking categories it falls under, or "non-blocking". Questions that
depend on unknown platform behaviour are settled by a probe (open questions 26
to 31, and the Phase 0 list), not by further review rounds. Match review
effort to the size of the change: this is a documentation change.

## Out of scope

- Each consumer's migration: its manifest values, hold paths, allowlist
  entries, content rules, its `rules.md`, deletion lists and per-repo open
  questions.
- The hook adapter, the bootstrap, pinning and the generic runner procedure:
  specified in the design, implemented in later slices.
- The morning desk and the review loop, which are the owner's own routines.
- The existing `Codex Review Gate` status workflows, which stay as built.
- Phase 1 code under `src/` and `test/`, reviewed earlier.

## A private companion record exists

The private consumers are described here only generically ("a game repository
that merges into a preview branch", "a multi-repo maintenance routine"). A
private record outside this repository maps these descriptions to the actual
repositories and holds their as-built details, the full review history, the
backtests and the consumers' current rule texts. If a finding depends on a
consumer detail you cannot see, state the assumption and raise it as a
question rather than as a blocking finding.

## Platform facts

Status labels:

- **Documented**: reported with a quotation from official documentation by a
  research worker on 2026-11-21. Not re-verified for this repository.
- **Observed**: seen in the consumers' repositories, in public code, or in a
  live session.
- **Unverified**: nobody has checked it. The design does not rely on any of
  these without a fallback.

### Documented

- A cloud session or scheduled task with one repository attached loads that
  repository's `.claude/settings.json` hooks and permission rules; a session
  with several repositories reads only plugin settings from it, no hooks and
  no permission rules.
- PreToolUse hooks can match MCP tools by name (regex allowed), receive the
  tool name and input, and block with exit code 2 or a JSON decision (deny,
  ask, allow, defer). Exit 2 blocks before permission rules. A crashing or
  timed-out hook does not block unless `onFailure: "block"` is set (recent
  versions). Hook processes inherit the parent environment.
- Settings files are watched and reloaded in-session, so an agent edit to
  `.claude/settings.json` or a hook script takes effect. `.claude/` is a
  protected path in default and accept-edits modes and is sent to the
  classifier in auto mode.
- Auto mode is a classifier, described by its vendor as not a boundary.
- In a non-interactive `-p` run, `ask` is treated as deny. Scheduled tasks are
  not documented on this point.
- Scheduled tasks are a research preview, start in auto mode, and are
  configured per task (prompt, repositories, environment, model,
  connectors); no per-task allowed-tools list is documented.
- Environment variables are set per cloud environment, outside the repository.
- Anything a scheduled task does through the connected GitHub identity
  appears as the owner.
- The cloud GitHub proxy rejects branch deletions and tag pushes but does not
  limit which branches a push can update. GraphQL through `gh pr ...` is
  rejected; REST through `gh api` works.
- On the free plan, rulesets, branch protection and auto-merge are available
  on public repositories; private repositories need a paid plan.
- Anyone with write access can set any commit status. Check runs can be
  created only by GitHub Apps.
- `pull_request_target` and `workflow_run` run the workflow file from the
  default branch. From 2026-12-02, `pull_request_target` is blocked by default
  in public repositories unless a repository Actions policy allows it.
- Free-plan Actions include about 2,000 Linux minutes a month for private
  repositories; public repositories are free.
- Codex's GitHub review follows review rules in `AGENTS.md`, can be triggered
  by commenting `@codex review`, and its output format carries no stability
  commitment. The documentation says it flags only P0 and P1 issues by
  default; the consumers' gate scripts and their fixtures nevertheless handle
  P2 and P3 labels. How often P2 and P3 appear in practice is not recorded
  here.

### Verified during the design review (documentation or live read-only API)

- Quoted from official documentation on 2026-11-22 and checked against the
  page text (full quotations and URLs in
  [the research note](research/2026-11-policy-shape.md#2-trusted-signals)):
  commit statuses are writable by anyone with write access, check runs only by
  GitHub Apps; a required check can be pinned to its source app; a skipped job
  counts as success; the merge calls accept the expected head and the GraphQL
  call checks it only if given; comments can be edited by anyone with write
  access and the GraphQL schema exposes comment edit fields; for a
  `pull_request` run the workflow is the one in the merge commit and a
  workflow file may request token permissions such as `checks: write`; on the
  free plan environments can be configured only for public repositories.
- A workflow job's check counts on a pull request only for push,
  pull_request, pull_request_review, pull_request_target and deployment
  triggers; checks from `workflow_run` and `issue_comment` runs attach to the
  default branch head. A skipped or neutral check counts as success for
  required checks.
- quorum-election-simulator's ruleset has no bypass actors and requires a pull
  request and the contexts `check` and `Codex Review Gate` with GitHub Actions
  as the source.
- Anyone with write access can edit or delete other users' comments.
- Billed Actions minutes computed from job timestamps for one private consumer
  were roughly 1,300 in 30 days; each job rounds up to a whole minute; without
  a payment method, usage is blocked when the allowance runs out. (The billing
  page has not been read; the owner is to confirm.)

### Observed

- Codex comments carry the HTML markers `codex-pull-request-review-summary`,
  `codex-review-state:v1 {json}` and `codex-review-receipt:v1`; findings
  carry `[P0]`..`[P3]` or `![Pn Badge](...)` labels. See
  quorum-election-simulator's `scripts/codex-review-gate.mjs` and its tests.
- The Codex bot keeps one summary comment per pull request and edits it in
  place on new commits (observed on one private consumer).
- In quorum-election-simulator, Codex does not review later commits of a pull
  request unless asked with `@codex review`.
- GitHub can remap a review comment's `commit_id` after a push; its
  `original_commit_id` keeps the reviewed commit.
- Public repositories can be cloned anonymously from a cloud session.
- In an interactive cloud session the GitHub tools are named
  `mcp__github__<tool>`, including tools that merge, enable auto-merge, push
  files, create, update and delete files.
- Cloud sessions have no Codex CLI.

### Unverified

- The open-question probes 26 to 31 of [open questions](open-questions.md):
  whether the runner's connection can push under the workflow directory or
  directly to a lane base, whether a pull request's workflow can post a passing
  check under a listed name, whether the reviewer's own summary edits are
  attributed to it and whether a session can read those GraphQL fields at all,
  what a preview build can see, and whether the cloud runner can use a separate
  identity.
- That a same-repository `pull_request` run receives the repository's secrets:
  read from documentation by a critic, not exercised.
- The policy-shape change itself: its research synthesis was reviewed by two
  critics; the specification text of this change has had no review yet.
- Every Phase 0 check in [the design](design.md#85-phase-0-dependencies):
  hooks in scheduled tasks, `onFailure: block` there, environment variables
  reaching the hook, `ask` behaviour there, anonymous kit clone from a task,
  hook loading after a branch switch, tool names in a task, an expected head
  SHA on every merge path.
- Which permissions the Claude GitHub App's token holds (administration,
  workflows, statuses, checks).
- Whether a job from a workflow file added in a pull request branch can satisfy
  a required check of the same name.
- Whether actions taken from cloud sessions carry `performed_via_github_app`.
- That GitHub refuses to merge a draft pull request (replay relies on it).
- The current price of GitHub Pro.
- Whether a hook can be installed by a cloud environment's setup script.
- Whether a separate agent identity can be applied to cloud sessions.
- The design itself after the third review round's fixes: those fixes were
  checked only for consistency with their sources, not reviewed again at
  design level.
