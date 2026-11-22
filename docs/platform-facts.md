# Platform facts

Facts about GitHub, Claude Code and Codex that [the design](design.md) depends
on, each with its verification status.

Status labels:

- **Documented**: reported with a quotation from official documentation by a
  research worker on 2026-11-21. Not re-verified for this repository.
- **Observed**: seen in the consumers' repositories, in public code, or in a
  live session.
- **Unverified**: nobody has checked it. The design does not rely on any of
  these without a fallback.

## Documented

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

## Verified during the design review (documentation or live read-only API)

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

## Observed

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

## Unverified

- The open-question probes 26 to 31 of [open questions](open-questions.md):
  whether the runner's connection can push under the workflow directory or
  directly to a lane base, whether a pull request's workflow can post a passing
  check under a listed name, whether the reviewer's own summary edits are
  attributed to it and whether a session can read those GraphQL fields at all,
  what a preview build can see, and whether the cloud runner can use a separate
  identity.
- That a same-repository `pull_request` run receives the repository's secrets:
  it follows from GitHub's documented exception for forks ("With the exception
  of `GITHUB_TOKEN`, secrets are not passed to the runner when a workflow is
  triggered from a forked repository"); not separately tested.
- The policy-shape change itself: its research synthesis was reviewed by two
  critics. The specification has had one independent review, which found three
  gaps (a byte-order mark could evade the content rules, the path check's
  unknown inputs were unspecified, and the floor's data shape could not
  represent its own table); they are fixed in the text. It has had no review
  since.
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
