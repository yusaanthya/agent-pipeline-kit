# Review brief

For an external reviewer of the Phase 1 pull requests of this repository: the
documents and, where present, the gate library, its tests and the CLI. This
brief stands alone; you do not need, and will not get, access to the consumer
repositories other than the public quorum-election-simulator.

## What to read

1. [README](../README.md): purpose and stance.
2. [Design](design.md): the specification the code must implement.
3. [Threat model](threat-model.md): what the design claims to protect.
4. [Implementation plan](implementation-plan.md): signatures, data shapes,
   CLI contract and test list.
5. [Decisions](decisions.md) and [open questions](open-questions.md): what
   is settled, what was rejected and why, and what is deliberately open.

## Who the change must hold up against

An agent that acts with the owner's GitHub identity and makes mistakes or
overreaches, including trying another route after a refusal (TA), or that
follows instructions injected through repository content, dependencies, pull
request, issue or comment text, or fetched pages (TB). Not deliberate
multi-step circumvention (TC), and not compromise of the owner's account, of
GitHub or of the model providers. Read the stance first: this is a guardrail
with detection, not a boundary, and the residual gaps it accepts are listed in
the threat model. A finding that only restates a listed residual is not new.

## What counts as blocking

A finding is blocking when it shows one of these, with a concrete input:

1. **A wrong `merge` verdict** reachable with inputs of a kind seen in real
   runs: pull request facts, diffs, check runs and Codex comments in the shapes
   GitHub and Codex actually produce (the public consumer's pull requests and
   its gate script's fixtures are examples).
2. **A floor path that can be merged unattended**: any way a change to a path
   on the floor (design section 5.4), other than the item's own report, gets
   `merge`.
3. **Spec and implementation disagree**: the code does something the design or
   implementation plan does not say, or the reverse, including the precedence
   order and the Codex state mapping.
4. **A false claim in the documents**: a statement presented as fact that is
   not true, including a statement about what exists in this repository, or an
   unverified platform fact presented as verified.

Everything else is non-blocking: style, naming, a clearer wording, an
additional test that is not needed to show one of the four.

## What is recorded, not fixed

A finding that needs an input not seen in a real run (for example a Codex
comment format Codex has not been observed to produce, or a path crafted to
exploit a filesystem's normalisation) is recorded as a follow-up or an open
question with a one-line reason, not fixed in this slice. Say which real run
would produce the input if you believe one would.

## Ending the review

A round ends when it has no blocking finding and every remaining finding is
either fixed or recorded with a reason. Please state, per finding, which of
the four blocking categories it falls under, or "non-blocking". Questions that
depend on unknown platform behaviour are settled by a live check (the Phase 0
list), not by further review rounds.

## Out of scope

- Each consumer's migration: its manifest values, hold paths, tiers, its
  `rules.md`, deletion lists and per-repo open questions.
- The hook adapter, the bootstrap, pinning and the generic runner procedure:
  specified in the design, implemented in later slices. Review their
  specification for consistency with the rest of the design, not for code.
- The morning desk and the review loop, which are the owner's own routines.
- The existing `Codex Review Gate` status workflows, which stay as built.

## A private companion record exists

The private consumers are described here only generically ("a game repository
that merges into a preview branch", "a multi-repo maintenance routine"). A
private record outside this repository maps these descriptions to the actual
repositories and holds their as-built details, the full review history and the
consumers' current rule texts. If a finding depends on a consumer detail you
cannot see, state the assumption and raise it as a question rather than as a
blocking finding.

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
