# Decisions

Dated owner decisions for the kit, and the designs that were rejected, with
the concrete reasons, so that a reviewer does not re-propose them. A design
was reviewed in three rounds by independent critics before the decisions of
2026-11-21. The policy-shape decisions of 2026-11-22 (path policy, trusted
signals, extension mechanism) followed outside research and two critic reviews
of its synthesis; the research is summarised in
[the research note](research/2026-11-policy-shape.md). Each consumer's own records of the rules this kit replaces stay in that
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
diverged into two versions with nine behavioural differences. Under the
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

### 2026-11-22: path policy on runner lanes is an allowlist with default hold

A runner lane's path policy is written as what that lane's work looks like
(`tier.default: "hold"` and `tier.auto`), not as a list of sensitive paths.
`hold_paths` stay for defensive entries inside allowed directories. The floor
stays in the kit for the classes that are the same in every consumer, and its
rationale is restated by class (design section 5.4): **authority** (what the
next run obeys), **execution** (what runs on the owner's machine or with
credentials) and **oracle** (what decides whether a check passes). Product
code is deliberately not listed, because a revert undoes it.

Why:

- A denylist fails by omission: a new location or a new kind of configuration
  passes until someone amends the list, and the lists have grown by amendment
  after incidents. A default-hold fails by over-holding, which costs the owner
  a look.
- A merged runner change waits for the morning replay, and the three classes
  above do harm before a replay or a revert can act: the night's later runs
  obey a merged rule change, the owner's next pull runs a merged hook, and a
  weakened oracle lets the rest of the night's merges pass on false evidence.
- An allowlist is stricter than a denylist, so it fits the overlay step
  (design section 10), which may only be stricter than today.
- Evidence from the backtests (private; aggregate only): a trial allowlist of
  four entries gave the same verdict on all ten inferred runner self-merges
  of one consumer (the author's classification of the merge history; computed
  from the backtest facts, not re-run through the kit), and
  the other consumer's backtest already ran as an allowlist.
- Outside practice keeps a short list only as a backstop and allowlists safe
  change categories for automated landing (research note). The evidence is of
  medium strength: no source describes a solo operator with one identity.

Replaces: the denylist form that design section 6 described for the game
consumer (a choice that decision 2026-11-21, "per-repository trade-offs are
decided at migration", left to that consumer), and open question 3's
recommendation to keep the current list at the switch and trial the allowlist
in a separate pull request. The entries of each allowlist are still chosen at
that consumer's migration, from its backtest.

### 2026-11-22: two homes, split by scope; three readers of one policy

Policy has two homes: the kit floor (the same in every consumer, and a
manifest cannot loosen it) and one manifest per consumer. All three
enforcement points read that same policy: the write and push hook on the
runner lane, a path check that needs no pull request (a base and a head only,
reporting each path's class), and the merge gate. A prose copy of the policy
in a consumer's runner specification becomes a pointer only at that
consumer's switch step, and only after the path check exists.

Why: a consumer that states its sensitive paths in a runner specification, in
its gate configuration and in the kit's floor keeps three copies, and the list
changed once inside a one-month backtest window, which would have left the
copies disagreeing. The prose also serves moments the pull-request-bound gate
cannot: a tip check before any pull request exists, and the paths a runner
lists in a pull request description. Until a pull-request-free check exists,
the prose has to stay.

Replaces: the hook's separate runner-lane write list (open question 2 had it
as a list of its own) and the plan to leave each consumer's prose list in
place indefinitely.

### 2026-11-22: declarative content rules first; `extra_check` demoted

The manifest gets four generic content-rule types, evaluated in the pure
core: hold on add, delete or rename under a glob; hold on changed lines that
match a pattern under a glob; a structured file may change only named keys;
front matter may change only named keys and must stay well-formed (design
section 5.4.1). A consumer-supplied `extra_check` script becomes a recorded
contract (design section 11.1), built only for the first rule the four types
cannot express.

This reverses the earlier plan, which gave every content rule to an
`extra_check` script read from the default branch (open question 18, design
sections 6 and 11).

Why:

- Replay by construction: the types read git objects in the pure core, so the
  morning replay evaluates exactly what the live call did. A script has to
  be run, bounded and recorded.
- One home: the rules sit in the manifest beside the paths, so the hook, the
  path check and the gate read one file.
- No consumer-supplied code runs on the owner's host, outside every sandbox,
  with the owner's privileges.
- Mature systems converged on small shared rule languages and keep repository
  variety in data (research note): one code-review system retired
  per-project logic for a single expression language, and a merge bot keeps its
  merge policy central while jobs live in the repository.
- Each type has a current user in the backtests: the game consumer's two
  rules about its specifications directory (types 1 and 2) and the multi-repo
  consumer's version-only file and front-matter rules (types 3 and 4). In
  that consumer's forced-lane comparison with its existing script, the one
  case where the script refused and the kit alone would have merged was a new
  file whose front matter the script rejects; type 4 covers it.

Not covered by the four types: a rule restricting changes to named sections of
one Markdown file (the first candidate for `extra_check` or for a fifth
type, decided at that consumer's migration) and "an automatic fix never
relaxes a permission rule", which has no mechanical form and stays with
review. A content rule can only add a hold.

### 2026-11-22: the merge-time path policy protects two things only

The path policy protects what a check result on the head means and what lands
on the base branch. It does not protect against code that runs before the
merge. A same-repository `pull_request` run executes the branch's own workflow
file, receives the repository's secrets and may raise its token permissions in
that file (the permissions part is documented; the secrets part follows from
GitHub's documented exception for forks and is not separately tested; research
note), so holding `.github/**` at merge time
cannot protect secrets. The structural answers are:

- deploy secrets live in an environment limited to the production branch. This
  is a consumer setting, free on public repositories (on the free plan,
  environments can be configured only for public repositories), and outside
  the kit's main line, which changes no GitHub setting (decision 2026-11-21);
- the hook denies writes and pushes to the workflow directory on the runner
  lane (design section 8.1);
- whether the runner's own credential can already not write workflow files
  is a probe (open question 26); the floor stays either way.

Replaces: the implicit reading that the floor's hold on workflow files made CI
configuration safe. It makes the check result meaningful at merge time; it
never stopped the run.

### 2026-11-22: trusted signals are unchanged

The gate trusts check runs created by the GitHub Actions app, matched by name;
the pinned AI-reviewer bot, bound to the head SHA; and never commit statuses.
A consumer's derived display status may stay as a display-only status that the
gate never reads (it keeps the decision of 2026-11-21 about one private
consumer's status workflow). Detection of an edit to the reviewer's summary
comment is recorded as pending a read-only probe (open question 29): it needs
a GraphQL field that the cloud proxy may reject, and the reviewer edits its own
summary, so a rule of "never edited" is wrong.

Why: statuses are writable by anyone with write access and check runs only by
GitHub Apps, and every mature merger the research found merges with the
evaluated head SHA (research note). The check-run signal is weaker than it
looks only in one direction: trust in a check depends on the oracle files
being held, and the held files do not depend on check trust.

Not decided: pinning a public consumer's ruleset to the source app of its
required contexts (open question 25).

### 2026-11-22: process-state rules belong to the gate core or the procedure

A rule about process state, such as "do nothing while an owner pull request
is open", belongs to the gate core or to the runner procedure. It is never a
content rule and never a script.

Why: such a rule needs GitHub state (other pull requests), which a content
rule cannot see and a no-token script cannot read. No mature system the
research found implements such a rule as a per-pull-request script; they put
them in the queue, the scheduler or a human-set flag. In a backtest of the
multi-repo consumer, one pull request got `merge` where its own procedure's
"owner pull request is open" step would have stopped the run; the gap matters
only if the gate replaces that step. Which of the two homes is chosen at the
first migration that needs it (open question 23).

### 2026-11-22: the lane marker names the pull request's lane

The `Auto-Merged-By:` marker of a lane must name the lane of the pull request,
not the routine that ran the merge. A consumer whose script writes the running
routine's name changes its marker before it migrates.

Why: replay finds the lane of a non-queue pull request from the marker. A
backtest of the multi-repo consumer inferred that two of its six pull requests
of one kind were merged by the other kind's routine; under a routine-named
marker, replay would assign the other lane and hold them. Updates open
question 13 instead of adding a new one.

### 2026-11-22: no boundary while the agent acts as the owner's administrator

A real boundary is out of reach as long as the agent acts through the owner's
administrator identity: no GitHub setting stops that identity, and a ruleset
on a public repository can be switched off with one call. A separate agent
identity is deferred; revisit it if the cloud runner can act as a separate
identity (open question 31).

Why: every published separation of agent and approver the research found
depends on a distinct agent identity plus a second approver, and no published
account of a solo operator whose unattended agent merges its own pull
requests was found (research note). The design stays a guardrail with
detection.

### 2026-11-22: interactive lanes are not built now

The gate has no lane for interactive pull requests (design section 11).

Why: the rules an interactive merge depends on (the owner's own message in the
session, a named pull request, a critic's waiver or convergence) are inputs
the gate cannot see; the waiver sits in an agent-writable pull request body,
which the gate must never read. In the backtest of the game consumer, with an
interactive lane forced onto 74 pull requests outside the queue lane, 1 got
`merge` and the rest held or waited, mostly on paths the owner should see
anyway; the lane would add almost nothing. The other backtest found the same for its
interactive and review-loop pull requests: the rules that decide them cannot
be expressed in a manifest.

### 2026-11-22: left open by this change

Not decided, and recorded as open questions: whether a consumer's
oracle-defining source file (the file that holds the limits its checks
enforce) should be a hold path (question 22); which branch a consumer's
manifest is read from when its working branch is not the default branch
(question 1); and the probes (questions 26 to 31).

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
- **Rejected on 2026-11-22:** a risk score instead of a path policy (it needs
  incident data and a model; a 150-line cap alone would have held nine of ten
  inferred runner self-merges of one consumer for no written reason); an owner-signed
  policy tag (it gives policy integrity without a second identity but does
  not remove the list); a runner that never merges its own pull requests,
  with the owner approving in batches (it gives up what the kit is for); a
  fork lane (not viable with one identity); and a consumer-supplied script as
  the first extension mechanism (demoted, above).

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
  found in the audit (three gate copies, two versions, nine differences) and
  keeps the gate's logic inside the repository the agent edits. Vendoring stays
  only as the fallback if a scheduled task cannot clone the kit.
- **Attaching the kit to a session as a second repository.** A session with
  several repositories loads no repository hooks.
- **A push-triggered audit workflow that opens a halt issue on unmarked
  commits.** Replaced by the desk's daily detection; it would have added
  Actions usage on private repositories.
- **An Actions-side gate on private repositories.** Actions minutes there are
  already tight, and without rulesets it buys no enforcement.
