# Threat model

## Setting

- One owner, a personal GitHub account on the free plan. Consumers are a mix
  of public and private repositories.
- Unattended Claude Code cloud scheduled tasks and interactive sessions act on
  GitHub through the owner's connected identity. Everything they do "appears
  as" the owner: author, merger and administrator are one identity.
- Native Codex review on GitHub reviews pull requests. A local Codex CLI runs
  the owner-started review loop.
- Private repositories on the free plan have no rulesets, branch protection or
  required checks. Public repositories can have rulesets; quorum-election-
  simulator has one that requires a pull request, its CI check and the
  `Codex Review Gate` status, blocks force pushes, and has no bypass actor.

Out of scope: compromise of the owner's GitHub account, of GitHub, Anthropic
or OpenAI, and of the owner's machines.

## Threats

**TA. Agent mistake or overreach.** The most likely threat. The agent merges
something it should not, edits a file it should not, or misreads a condition.
This includes trying another route after a refusal: an agent stopped by the
hook that then calls the merge endpoint with `curl` or `gh api` is ordinary
goal-directed behaviour, not malice.

**TB. Prompt injection.** Instructions planted in repository content,
dependencies, pull request, issue or comment text, or fetched pages steer the
agent toward the same actions as TA.

**TC. Deliberate multi-step circumvention.** An agent that sets out to defeat
the guardrail over several steps. Not a design target. Residuals that only TC
reaches are named, not closed.

Classification rule: anything the agent's identity can do in one ordinary call
that follows from its goal or from an injected sentence is TA or TB, never TC.
Disabling a ruleset, changing the default branch, un-drafting a pull request,
removing a title prefix and closing an issue are each one call.

## What the gate is designed to stop

The gate is designed so that, when it is the code path that decides a merge,
none of these produce `merge`:

- a pull request from a fork;
- a pull request outside a lane, or into a base other than its lane's;
- a change to a floor path (agent configuration, CI, dependencies, git hooks
  and attributes, the pipeline's own files), other than the item's own report;
- a change to a consumer hold path, or to a path outside the lane's allowlist
  (runner lanes are written as allowlists with default hold);
- a change that violates a content rule of the manifest: a file added, deleted
  or renamed under a guarded glob, a guarded line added or removed, a
  structured file or front matter changed beyond its named keys, or one of
  them unreadable;
- a symlink, submodule, executable, type change or binary file;
- a head on which a named check has not succeeded;
- a head without a completed Codex review bound to that exact SHA by the
  trusted bot, or with a blocking finding, or with any finding the parser
  cannot classify;
- a head that does not contain the base tip;
- a merge while a halt issue is open, or into the preview branch while a
  promotion is open;
- a pull request the owner marked as a draft or with a `[FAILED]` or
  `[NEEDS-DECISION]` title, or whose queue item says `merge: owner`.

What the merge-time path policy protects is two things: what a check result
on the head means, and what lands on the base branch. It does not protect
against code that runs before the merge (residual 11).

## Protection, honestly

| Scenario | Public consumer with a ruleset | Private consumers |
| --- | --- | --- |
| Direct push to the base branch | The ruleset blocks it | Only the hook and the classifier |
| Merge with failing CI or a Codex P0/P1 | The ruleset blocks an ordinary call; the Codex status depends on comments that any write-access identity can edit | The gate |
| Unattended merge of a floor path | The gate | The gate |
| Pull request into the wrong base, skipping the preview | Not applicable | The gate |
| After the hook refuses, another route to the merge API | The classifier, then the next morning's desk. The ruleset still requires a pull request, CI and the Codex status, but knows nothing of floor, tiers or lanes | The classifier, then the next morning's desk |
| Disabling the ruleset or changing the default branch | Found by the next morning's desk | Not applicable |
| A pull request that edits a workflow file and runs it with the repository's secrets before any merge | Not stopped by the gate or the ruleset. Deploy secrets in an environment limited to the production branch (a consumer setting) and the hook's write-time deny on the runner lane | Not stopped by the gate. The hook's write-time deny on the runner lane; environments are not configurable on private repositories on the free plan |

"The gate" in this table means: enforced by the hook in single-repo sessions
(not yet confirmed in scheduled tasks, see the Phase 0 checks in the design),
and by the written procedure in multi-repo sessions and in the Codex review
loop. A ruleset blocks an ordinary call; it does not block a call made after
the ruleset has been changed.

## Residual gaps on the main line

Each of these is accepted and named; none is closed by the kit.

1. **A merge or push that does not pass the hook** (TA/TB): another HTTP client
   or a script through the session's authenticated proxy, a tool the hook does
   not match, a multi-repo session that skips the written step, an agent edit
   to `.claude/` (settings are reloaded in-session), or a checkout of a branch
   that lacks the hook files. On private repositories nothing else stops it;
   on the public consumer the ruleset still requires a pull request with CI and
   the Codex status, but not floor, tier or lane. The vendor's cloud proxy
   documents that it does not limit which branch a push can update, so a
   direct push to a lane base is expected to work; open question 27 probes it,
   and a yes makes the desk's list of commits that belong to no pull request
   required.
2. **One-call changes to gate inputs or platform state** (TA/TB): un-drafting,
   removing a title prefix, closing a halt issue, disabling a ruleset or
   changing the default branch from a session with administrator rights, and
   editing or deleting Codex comments. As designed, the gate does not detect
   an edit of the reviewer's summary comment: the REST API shows no editor.
   GitHub's GraphQL schema exposes `editor`, `lastEditedAt` and
   `userContentEdits` on issue comments, so detection may be possible, but it
   depends on a read-only probe (open question 29): whether the reviewer's own
   edits are attributed to the bot, and whether the cloud proxy, which rejects
   GraphQL, lets a session read these fields at all. The reviewer edits its own
   summary, so "never edited" is not a usable rule; the candidate rule is to
   return `blocked:codex` when an edit's editor is not the reviewer. The rule
   "agent-writable inputs only stop a merge" limits the first three changes to
   removing a stop the owner set; it does not prevent it.
3. **A wrong answer to `ask`** (TA): in an interactive session the owner
   answers the hook's question; a wrong "yes" merges.
4. **Caller-supplied lane** (TA): in a procedure call the calling session
   passes the lane, as it passes the routine kind to its gate script today. A
   wrong lane selects that lane's tiers. The base binding and the floor still
   apply.
5. **Branch name selects the queue lane** (TA): a branch named
   `claude/item-<id>` for an existing queue item is treated as that item's
   lane, whatever its content. The floor, tiers, checks and Codex review
   still apply. A check that the branch starts with the item's claim commit is
   open question 9.
6. **Check results the branch controls**: a check run from a `pull_request`
   workflow runs the branch's workflow file. This is evidence only because
   `.github/**` is on the floor. The dependence runs one way: trust in a check
   result depends on the oracle files being held, and the held paths do not
   depend on check results. Whether a workflow in a pull request can post a
   passing check under a listed name, as the Actions app, has not been tested
   (open question 28); the floor stays either way.
7. **Auto-tier changes can weaken tests** that CI runs (for example by editing
   test files in an allowed path). The floor cannot know where a consumer
   keeps its tests, so they are held only if the consumer lists them in
   `hold_paths` or leaves them outside its allowlist. Whether a consumer's
   source file that defines the limits its checks enforce should be a hold
   path is open question 22.
8. **Dependency install scripts** run in the session with the session's GitHub
   access. Dependency files are floor paths, which limits but does not remove
   this.
9. **The kit is a single point of change.** A bug in the kit reaches every
   consumer at its next pin bump. A change in Codex's comment format stops
   every lane at `blocked:codex` until the kit is fixed and each consumer bumps
   its pin.
10. **Hook behaviour after Claude Code updates** must be re-checked; cloud
    scheduled tasks are a research preview.
11. **Pre-merge execution** (TA/TB): a `pull_request` run from the same
    repository executes the branch's workflow file, receives the repository's
    secrets (this follows from GitHub's documented exception for forks, "With
    the exception of `GITHUB_TOKEN`, secrets are not passed to the runner when
    a workflow is triggered from a forked repository"; the same-repository
    case is not separately tested) and can raise its token permissions in that
    file (documented). A hold at merge time cannot undo a run that has already happened. The
    structural answers are a deploy-secret environment limited to the
    production branch (a consumer setting, available on public repositories
    only) and the hook's write and push deny for the workflow directory on the
    runner lane, which is subject to residual 1 and is only as good as the
    hook's ability to enumerate what a call writes: Bash can write files and
    push with no per-path tool call, so the hook must diff the pushed range
    against the remote ref and deny when it cannot (open question 32). Whether
    the runner's
    credential can already not write workflow files is open question 26.
12. **Content rules are structural** (TA): they see added or removed lines, top
    level keys and front matter blocks, not meaning. A pure move of a guarded
    line, a new value of a key the rule names, and any change to a file's body
    are not changes they hold. A line separator that readers honour and the
    line split does not (a carriage return outside a CRLF, U+000B, U+000C,
    U+0085, U+2028, U+2029) makes a type 2 file unreadable, so it holds and
    cannot hide a guarded line; one inside the front matter of a type 4 file
    makes the front matter malformed, so it holds as well. JSON nested deeper
    than 512 containers is unreadable, so what the parser can read does not
    depend on the call's stack. They apply only to the globs a consumer lists.
    "Well-formed" means the kit's own grammar, not YAML: a value that YAML
    would reject, or an anchor or alias, passes if the grammar accepts the block
    and the key is named or its block is unchanged. Recorded, not fixed.

## Detection limits

- The desk finds these at its next run, evaluated as of merge time. It cannot
  see the content of a Codex comment edited after the merge (it reports such
  edits as a limit; question 29 asks whether edits can be attributed),
  cannot reconstruct when a halt label was added or a base
  was retargeted, and reads commit dates rather than push times for the
  manifest as of a merge.
- The desk is itself an agent session reading repository text. Its replay
  output is printed verbatim so that the owner reads the program's output, not
  the agent's summary of it.
- The merge marker is written by whoever merged. A merge without a marker
  whose replay is not `merge` is listed for the owner to recognise; it is not
  proven to be the owner's.

## Optional upgrades, not on the main line

| Upgrade | What it buys | Cost and known problems |
| --- | --- | --- |
| GitHub Pro | Private repositories get the platform layer the public consumer has: no direct push, no force push, required CI and Codex status. Most valuable for the repository whose `main` defines every session's rules. More Actions minutes. | A monthly fee (current price not verified). It reduces risk, not work: rulesets cannot express floor, tiers or lanes, so the gate, hook, manifest and kit stay. The agent is still the owner: approvals are forgeable and a ruleset can be switched off in one call. |
| A separate GitHub identity for the agent (the owner's own GitHub App) | GitHub can tell the agent from the owner; approvals start to mean something. The only upgrade that could become a boundary. Deferred: revisit it if the cloud runner can act as a separate identity (open question 31). | Free, but requires a self-built GitHub App and a different way for the agent to obtain credentials. Whether it can be applied to cloud sessions is not verified. |
| Pinning a public consumer's ruleset to the source app of each required check | A status or check of the same name from another app no longer satisfies the ruleset (documented `integration_id`). Public repositories only | Amends the decision that the main line changes no GitHub setting, so it is the owner's decision (open question 25). A wrong pin stops every merge: read the source app of both contexts on recent heads first, and the app must have reported the context recently |
| An Actions-side gate that merges, required by a ruleset on public repositories | Floor, tiers and lanes enforced by a ruleset | Problems found in review: an approval label the agent can apply, stale success statuses, concurrent status writes overwriting each other, the Actions token cannot merge workflow-changing pull requests, a cloud session could no longer merge on the owner's instruction, stale approved pull requests get stuck. |
| Hook installed by the cloud environment's setup script | The hook is outside the repository and survives branch switches | Not documented as possible; needs a live test. |

Rulesets, whether bought (Pro) or already present (public), do not stop a call
made after the ruleset was changed. Only a separate identity could.
