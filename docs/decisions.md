# Decisions

Dated owner decisions for the kit, and the designs that were rejected, with
the concrete reasons, so that a reviewer does not re-propose them. A design
was reviewed in three rounds by independent critics before these decisions.
Each consumer's own records of the rules this kit replaces stay in that
consumer; a private companion record outside this repository maps them.

## Owner decisions

### 2026-11-21: direction adopted

One gate library, a pure verdict function, invoked at the merge tool boundary:
by a PreToolUse hook in sessions with one repository, by procedure call in
sessions with several repositories and in the Codex-hosted review loop. Each
consumer has a manifest and a local `rules.md`; the kit is pinned by commit
SHA; a morning desk replays every merge the next day. Stance: a guardrail with
detection, not a boundary. Existing rulesets and `Codex Review Gate` status
workflows on public repositories stay as built; the main line changes no
GitHub setting.

Why: the three consumers wrote the merge decision three ways, two of them as
prose the agent judges; the three copies of the Codex gate script had already
diverged into two versions with ten behavioural differences. Under the
platform limits (same identity for agent and owner, no rulesets on private
repositories on the free plan), making the judgement correct and consistent is
worth more than isolating who presses merge.

### 2026-11-21: each consumer migrates separately

Each consumer's migration is its own piece of work, in that consumer's own
session with its own specification and critic process, in the three steps of
[the design](design.md#10-migration-context) (backtest and shadow, overlay,
switch). The order of consumers is a recommendation. The common prerequisites
are only Phase 0 and Phase 1. New repositories start directly on the kit.

### 2026-11-21: per-repository trade-offs are decided at migration

Items that belong to one consumer (for example which branch its manifest is
read from, or whether it moves to an allowlist) are decided before that
consumer enters the overlay step, using backtest data. See
[open questions](open-questions.md); each is marked kit-level or per-repo.

### 2026-11-21: one private consumer keeps its Codex status workflow

It is kept as the owner's visual cue on pull requests and slimmed to a single
job, keeping its shared-SHA handling, its re-evaluation of the previous head
after a push, and its per-commit serialisation. Nothing enforces it there. The
slimming is a change to a workflow file that the owner authorises separately.

### 2026-11-21: a previously parked host-side runner is retired

It is not re-enabled and the kit does not replace it. The `.agent-line/`
directory name that the consumers already use for queues and reports is kept.

### 2026-11-22: the kit is this public repository

`agent-pipeline-kit` is public so that a single-repository cloud session can
fetch it anonymously; it also serves as a side-project showcase. Conditions:

- The kit holds only the gate library, hook, tests, templates and
  documentation. Manifests, local rules, queue items and reports stay in the
  consumers.
- The kit needs no secret; it holds no token, account id or deployment
  setting.
- Test fixtures are synthetic or taken from the public consumer. Nothing is
  copied from private consumers' pull requests, queues or reports; private
  consumers are referred to generically.
- No company-related content. Code ported from private consumers is reviewed
  file by file.
- No mention of repositories under any other account or brand.

Secret scanning and push protection are free on public repositories and catch
tokens; they do not catch names or identity links, which rely on review.

### 2026-11-22: no GitHub Pro for now

Reasons: no direct push to a base branch has been recorded; every merge
can be reverted with one commit; the private consumer whose `main` would
deploy production does not deploy it yet; Pro saves no work. Reconsider when
any of these happens: production deploys from a private consumer are switched
on; the desk finds a commit that belongs to no pull request, or an unmarked
merge the owner does not recognise; Actions usage after the workflow slimming
still approaches the free plan's monthly allowance; another person or another
automation identity gets write access to a private consumer. The other
optional upgrades are not decided.

### 2026-11-22: the design-level critic loop is closed

The third review round still found blocking items, all at the level of
specification detail, none against the direction. The fixes were folded into
the design but not reviewed again at design level. Remaining details are
handled against concrete diffs: in this repository for kit-level items, in
each consumer's migration for per-repository items.

## Settled during review (carried into the design)

- **Lane of the multi-repo routine is passed by the caller.** The premise "the
  gate can work out which lane a routine's pull request belongs to" failed in
  every round, differently each time (no fail-closed path; a generated branch
  name; unrecoverable at replay). The routine already passes the kind to its
  script and writes it into the merge marker; the kit keeps that.
- **The review loop already runs Codex locally.** Two drafts specified a
  rewrite of it based on a summary instead of the file. The only change is
  running the gate before its merge.
- **Hook returns no decision on `merge`.** Returning `allow` skips the
  auto-mode classifier and covers the whole Bash string.
- **Every lane has one base**, and the floor has an exception for the item's
  own report (otherwise the floor holds every runner pull request).
- **Agent-writable inputs stop merges only.** The pull request body is never
  read; a body-based waiver was dropped.
- **One execution path on the main line** (hook or procedure call). The
  Actions-side gate is an optional upgrade.
- **Not revived:** a cross-repository lint and a generic critic loop, both
  rejected earlier by the owner.

## Rejected designs

### Draft 1: the gate as a merge service in GitHub Actions on every repository

The gate ran in Actions, was the only component allowed to merge, and agents
only opened pull requests. Rejected because:

- A verdict written as a workflow job conclusion does not attach to the pull
  request head for `workflow_run`, `issue_comment` or dispatch runs; those
  checks attach to the default branch head. A skipped job counts as success.
- It would have merged pull requests from forks.
- Every owner signal it relied on (an approval label, the draft flag, a
  needs-decision marker, a halt issue, a waiver line in the body) is writable
  by the agent's identity in one call; the draft called that deliberate
  circumvention, which the classification rule rejects.
- To deploy after a merge made with the Actions token (which starts no `push`
  workflow) it made the deploy workflow dispatchable on any ref, while deploy
  secrets were readable by branch workflows.
- The floor depended on each manifest, and path matching was underspecified
  (renames, case, symlinks, binaries, truncated file lists, repositories with no
  checks).
- The manifest and the content-check script were read at the pull request's
  base, which is a branch the gate itself merges into; the content-check
  interface could not read file contents.
- The cost claim was false: one private consumer had already used roughly
  two-thirds of the free plan's shared monthly Actions allowance in 30 days
  (computed from job timestamps; each job rounds up to a whole minute; usage
  is blocked when the allowance runs out without a payment method).
- It dropped runner behaviour the consumers rely on (tending, fix rounds,
  updates, parking, the promotion freeze, a break-glass path).

### Draft 2: two profiles, Actions-side gate on public repositories and hook on private ones

Rejected because:

- The floor contained the pipeline directory, which every runner pull request
  touches with its report, so every runner pull request would have been held;
  the runner-lane hook also denied writing the report.
- Lanes were not bound to a base: a runner pull request opened against, or
  retargeted to, `main` instead of the preview branch would have merged there.
- The hook returned `allow` on `merge`, which skips the classifier and covers
  the whole Bash command; worse than today.
- One-call administrator actions (disabling a ruleset, changing the default
  branch) were labelled deliberate circumvention; un-drafting, removing the
  needs-decision marker and closing the halt issue were not named at all.
- The Actions token cannot merge pull requests that change workflow files, and
  there was no fallback.
- The multi-repo routine's lane was identified by branch prefix, which does not
  work when its session is pinned to a generated branch.
- The Actions profile removed the owner's ability to have a cloud session merge
  on instruction and made stale approved pull requests worse, without saying
  so.
- The migration changed a ruleset before reworking the review loop, bundled
  several changes in one phase, and had no deletion lists; several current
  capabilities (dependency chains, the kill switch, one-cell toggles, the title
  prefix hold) were not mapped.
- Its hard boundary still ended at a label the agent can apply, and each review
  round found more mechanics to get right in the Actions half. The second round
  recommended cutting to one execution path.

### Other rejected choices

- **Copying the kit into each repository by default.** It recreates the drift
  found in the audit (three gate copies, two versions, ten differences) and
  keeps the gate's logic inside the repository the agent edits. Vendoring stays
  only as the fallback if a scheduled task cannot clone the kit.
- **Attaching the kit to a session as a second repository.** A session with
  several repositories loads no repository hooks.
- **A push-triggered audit workflow that opens a halt issue on unmarked
  commits.** Replaced by the desk's daily detection; it would have added
  Actions usage on private repositories.
- **An Actions-side gate on private repositories.** Actions minutes there are
  already tight, and without rulesets it buys no enforcement.
