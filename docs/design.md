# Design

This is the canonical design of the kit. Sections 1 to 6 and 9 are what
Phase 1 implements. Section 7 (pinning) and section 8 (hook and procedure
invocation) are specified here and implemented in later slices; a statement in
those sections describes intended behaviour, not code that exists. Facts about
GitHub, Claude Code and Codex that the design depends on are listed with their
verification status in [the review brief](review-brief.md#platform-facts).

Terms:

- **Consumer**: a repository that adopts the kit. The current consumers are a
  public repository whose `main` deploys production
  (quorum-election-simulator), a private game repository whose runner merges
  into a preview branch that the owner later promotes to `main`, and a private
  repository maintained by a multi-repo routine (a nightly routine and a triage
  routine that run in sessions with several repositories attached).
- **Lane**: a named path by which pull requests reach a base branch
  unattended. A lane has exactly one base.
- **Floor**: the hard-coded list of paths whose change always needs the owner.
- **Runner**: an unattended scheduled session. **Interactive**: a session the
  owner is in.

## 1. Stance

The agent acts on GitHub with the owner's identity, so GitHub cannot tell the
agent from the owner. Private repositories on the free plan have no rulesets.
The kit therefore does not build a merge service on GitHub. It makes the merge
decision one tested program, runs it at the tool boundary where the merge call
is made, and re-checks every merge the next day. It is a guardrail with
detection, not a boundary. [The threat model](threat-model.md) states what that
does and does not protect.

## 2. Components

| Component | Where | Phase |
| --- | --- | --- |
| Verdict function `evaluate(input)`: pure, deterministic, no I/O | kit, `src/core/` | 1 |
| Input collector: reads GitHub REST and git objects, builds the input | kit, `src/collect/` | 1 |
| CLI: `evaluate`, `replay`, `backtest` | kit, `src/cli.js` | 1 |
| PreToolUse hook script and a small vendored bootstrap | kit (script), consumer (bootstrap, settings) | later |
| Manifest and `rules.md` | consumer | format: later; schema: section 6 |
| Generic runner procedure, queue and report formats, templates | kit | later |
| Morning desk (daily replay and lists) | the owner's existing routine, outside the consumers | later; calls the CLI |

## 3. Verdicts

The gate returns exactly one verdict and the list of every reason that
contributed to it. Verdict strings are `merge`, `hold:owner`,
`hold:strong-review`, `fix:ci`, `fix:codex`, `update:base`, `wait:<what>` and
`blocked:<why>`.

| Verdict | Meaning | Runner | Interactive session |
| --- | --- | --- | --- |
| `merge` | Every condition of section 5 holds | Merges with the parameters the gate returns | Merges; the hook returns no decision, so normal permission handling and the classifier apply |
| `hold:owner` | The change needs the owner: a floor or hold path, no lane, wrong base, a queue item marked `merge: owner`, a `[FAILED]` or `[NEEDS-DECISION]` title, a draft, a size limit, runner merging switched off | Does not merge; leaves it for the owner | Ask the owner; the owner's answer is the approval |
| `hold:strong-review` | A path the manifest marks for strong-model review | Does not merge; hands off to the local review loop | Ask the owner, as for `hold:owner` |
| `fix:ci` | A named check failed on the head | Pushes a fix within the consumer's round cap | Not decided (open question 4); recommended: ask |
| `fix:codex` | Codex reported a blocking finding (P0 or P1, or changes requested; any finding under `no_findings`) on the head | Pushes a fix within the round cap | Not decided; recommended: ask |
| `update:base` | Everything else passes but the head does not contain the base tip | Merges the base into the branch (never a rebase), pushes | Not decided; recommended: ask |
| `wait:<what>` | Something has not finished or a stop is in force: `ci`, `codex`, `mergeable`, `freeze`, `halt` | Takes no action (it may request a Codex review once where the consumer's Codex does not re-review pushes) | Not decided; recommended: ask |
| `blocked:<why>` | An input is missing, malformed or contradictory: `manifest`, `lane`, `input`, `codex`, `check`, `not-open`, `empty-diff`, `not-mergeable` | Parks the pull request with one question and a recommended answer | Not decided; recommended: ask |

The runner behaviour in this table is the behaviour the consumers' runners have
today, mapped onto verdicts; its exact procedure (labels, round caps, the
6-hour park rule, claim rules) belongs to the generic runner procedure, a later
slice. The gate itself has no notion of rounds or elapsed time.

The interactive column for `fix`, `update`, `wait` and `blocked` is unsettled.
Asking keeps the rule every consumer has today that the owner may merge
anything by saying so; denying is safer. A runner is denied every verdict
except `merge` either way.

### 3.1 Precedence

When several conditions fail, the verdict is the reason that comes first in
this order; every reason is still returned:

1. `wait:halt`
2. `wait:freeze`
3. `blocked:*`
4. `hold:owner`
5. `hold:strong-review`
6. `wait:ci`, `wait:codex`, `wait:mergeable`
7. `fix:ci`
8. `fix:codex`
9. `update:base`
10. `merge` (no reason)

Why this order: a halt or a freeze means "change nothing", so they come before
anything that would make a runner write (fix, update, park). A blocked input
makes the remaining evaluation untrustworthy. Holds come before fixes because
the consumers' runners today leave a pull request for the owner before they
try to fix it. Waits come before fixes because both runners wait for missing
results before acting on a failure. `update:base` comes last because both
runners update a branch only when every check passes.

Within one step, reasons keep the order in which section 5 lists their
conditions, and the first one determines the verdict string (for example
`wait:ci` before `wait:codex`).

## 4. Inputs

The gate reads only the inputs below. The third column says whether an input
can contribute to a `merge` verdict or is used only to stop one.

| Input | Source | Use |
| --- | --- | --- |
| Manifest | Fresh fetch of the consumer's default branch (section 6), never the working tree, the pull request or a lane base | Grants (owner-merged, on a floor path) |
| Pull request facts: number, state, head repository, head branch, head SHA, base branch, `mergeable` | GitHub REST | Grants: origin and lane are derived from them |
| Caller lane | Argument of a procedure call (section 8.2) | Selects a lane; supplied by the calling session (see the threat model) |
| Changed files with status, base and head modes, NUL check of head blobs, added and deleted line counts | git objects: `git diff --raw -z --no-renames` and `--numstat` between the merge base and the head; `git cat-file` | Grants: facts about the change itself |
| Base tip SHA and whether it is an ancestor of the head | Fresh fetch of the pull request's base branch (which must be the lane's base); `git merge-base` | Grants |
| Queue item text, `.agent-line/queue/<id>.md` | git object at the base tip | Grants (queue paths are floor paths, so only owner-merged pull requests put items there) |
| Check runs on the head SHA | GitHub REST, all runs, all pages | Grants, only check runs created by the GitHub Actions app with a name the manifest lists |
| Codex review state for the head SHA | GitHub REST: issue comments, review comments, reviews, all pages; only items authored by the trusted Codex bot (numeric id and login both match) | Grants; see the residual on comment editing in the threat model |
| Draft flag | GitHub REST | Stop only |
| Title | GitHub REST | Stop only: `[FAILED]` or `[NEEDS-DECISION]` anywhere in it, case-insensitive |
| Open issues labelled `pipeline-halt` | GitHub REST | Stop only |
| Open pull requests (head branch, head repository, base) | GitHub REST | Stop only (freeze) |

Rule for agent-writable inputs: anything the agent's identity can change in one
call (title, draft, labels, issues, other pull requests) may only stop a merge,
never enable one. No title, body or comment can make a pull request pass.

The gate never reads: the pull request body, comments or reviews by anyone
other than the trusted Codex bot, commit messages (except the merge marker,
which replay reads to classify a merge and find its caller lane, section 9),
pull request labels, commit statuses,
or files of the working tree. It never checks out or executes pull request
code.

Why commit statuses are never read: anyone with write access can set any
commit status in one call. The public consumer's `Codex Review Gate` status is
such a status; the gate reads the Codex review state directly instead.

## 5. Conditions

All conditions are evaluated; each failure adds a reason. Paths are compared
after lowercasing both the path and the pattern.

### 5.1 Origin and state

- The head repository equals the consumer repository. Otherwise `hold:owner`
  (a pull request from a fork never merges unattended).
- Outside replay, the pull request is open. Otherwise `blocked:not-open`.
- The diff is non-empty. Otherwise `blocked:empty-diff`.
- Every path decodes as UTF-8 without loss. Otherwise `blocked:input`.

### 5.2 Lane and base

Lanes are declared in the manifest (section 6). There are two kinds:

- **Queue lane** (at most one per manifest): the head branch is exactly
  `claude/item-<id>` with `<id>` matching `^[a-z0-9][a-z0-9-]*$`. Both queue
  consumers use this branch form today, so it is fixed, not configurable.
- **Caller lane**: the calling procedure passes the lane name, as the
  multi-repo routine passes `--kind` to its gate script today. That routine's
  session may be pinned to a generated branch name, so its lane cannot be
  derived from the branch.

Resolution, failing closed:

- The head branch matches the queue form and the manifest declares a queue
  lane: the lane is the queue lane. If a caller lane is also passed and differs
  from it: `blocked:lane`. A head branch in the queue form where the manifest
  declares no queue lane is treated as not in the queue form: the resolution
  continues with the next bullets.
- Otherwise a caller lane is passed: it must name a caller lane of the
  manifest, else `blocked:lane`.
- Otherwise there is no lane: `hold:owner`.
- In replay only, where no caller is present: a merge whose commit message
  contains a line exactly equal to a caller lane's `marker` is evaluated in
  that lane (section 9). The marker records the lane the procedure passed at
  merge time.
- The pull request's base must equal the lane's one base. Any other base is
  `hold:owner`. Why: a runner pull request opened against, or retargeted to,
  a branch other than its lane's must not merge there (for the game consumer,
  `main` instead of the preview branch).
- A lane with `auto_merge: false` gives `hold:owner`. This replaces the
  consumers' rollout cells that switch runner merging on or off.

Interactive self-merge through the gate (a lane for pull requests that match
no other lane) is a follow-up; no consumer has chosen it yet.

### 5.3 Queue item

For the queue lane only:

- `.agent-line/queue/<id>.md` must exist at the base tip. Otherwise
  `hold:owner`.
- Its front matter (lines between a first line `---` and the next `---`) is
  read for one key, `merge`. Absent or `runner`: no reason. `owner`:
  `hold:owner`. Any other value, or front matter that cannot be read:
  `hold:owner`.

The gate does not validate the rest of the item; the runner procedure does.

### 5.4 Change set

Every entry of `git diff --raw -z --no-renames <merge-base> <head>` is checked.
`--no-renames` reports a rename as a deletion and an addition, so both sides of
a rename are checked by construction.

Per entry:

- Head mode, when the file exists at the head, must be `100644`. A symlink
  (`120000`), submodule (`160000`), executable (`100755`) or type change gives
  `hold:owner`.
- A head blob containing a NUL byte gives `hold:owner` (binary).
- A floor path gives `hold:owner`, except the exception below.
- A path matching the manifest's `hold_paths` gives `hold:owner`.
- A path matching the lane's `tier.strong_review` gives `hold:strong-review`.
- With `tier.default: "hold"` (allowlist), a path that matches none of
  `tier.auto` gives `hold:owner`. With `tier.default: "auto"` (denylist), any
  path not caught above is auto.

Per pull request:

- With `max_changed_lines` set on the lane, the sum of added and deleted lines
  over all entries must not exceed it. Otherwise `hold:owner`. The multi-repo
  routine's gate has a 150-line budget today; the other consumers have none.

**Floor** (hard-coded; a manifest can add paths through `hold_paths` but
cannot remove any):

| Category | Patterns |
| --- | --- |
| CI and pipeline | `.github/**`, `.agent-line/**` |
| Agent configuration | `**/.claude/**`, `**/.codex/**`, `**/.agents/**`, `**/claude*.md`, `**/agents*.md`, `**/.mcp.json` |
| Editor, shell and git hooks | `**/.vscode/**`, `**/.idea/**`, `**/.envrc`, `**/.husky/**`, `**/.githooks/**`, `**/git-hooks/**` |
| git attributes | `**/.gitattributes`, `**/.gitmodules` |
| Package manager configuration | `**/.npmrc`, `**/.yarnrc`, `**/.yarnrc.yml` |
| Dependency manifests and lockfiles | `**/package.json`, `**/package-lock.json`, `**/npm-shrinkwrap.json`, `**/yarn.lock`, `**/pnpm-lock.yaml`, `**/pnpm-workspace.yaml`, `**/bun.lock`, `**/bun.lockb`, `**/go.mod`, `**/go.sum`, `**/go.work`, `**/go.work.sum`, `**/cargo.toml`, `**/cargo.lock`, `**/pyproject.toml`, `**/poetry.lock`, `**/pipfile`, `**/pipfile.lock`, `**/uv.lock`, `**/requirements*.txt`, `**/gemfile`, `**/gemfile.lock` |

Why these: they change what later agent sessions are told or allowed to do,
what CI runs and therefore what a check result means, what runs on the owner's
machine after a pull, or what code is installed. The dependency list is the
kit's choice of "common ecosystems"; extending it is a kit change.

`claude*.md` and `agents*.md` deliberately also catch names such as
`docs/agents-notes.md`. Over-matching only holds a pull request.

**Floor exception**: in the queue lane, the item's own report
`.agent-line/reports/<id>.md`, with status added or modified and head mode
`100644`, is not a floor path, and it is also exempt from the lane's
`tier.auto` (allowlist) and `tier.strong_review` checks, so that a manifest
need not list the report directory in an allowlist and a strong-review pattern
cannot route every runner pull request away from `merge`. The manifest's
`hold_paths`, the mode check and the NUL check still apply to it. Every runner
pull request contains its report, so without this exception the floor would
hold all of them. A deleted report, another item's report, or a report in a
caller lane stays on the floor and under the tier checks.

**Pattern syntax**: segments separated by `/`. A segment `**` matches zero or
more whole segments; `*` inside a segment matches any characters except `/`.
Every other character is literal. A manifest pattern containing `?`, `[`, `]`,
`{`, `}`, `!` or `\`, starting with `/`, or empty, makes the manifest invalid.
This is the subset the consumers' current path lists use.

### 5.5 Checks

- The manifest lists check names, or says `"checks": "none"`. With `none`, a
  lane pull request never gets `merge` (`hold:owner`): a pull request whose
  tests ran nowhere does not merge unattended.
- For each listed name, the gate takes the check runs on the head SHA with that
  name created by the GitHub Actions app, and uses the latest by start time
  (then by id). None: `wait:ci`. Not completed: `wait:ci`. Conclusion
  `success`: passes. `failure`: `fix:ci`. Any other conclusion (`cancelled`,
  `timed_out`, `skipped`, `neutral`, `action_required`, `stale`,
  `startup_failure`): `blocked:check`.
- Check runs with names the manifest does not list are ignored. (The multi-repo
  routine today requires every reported check run to succeed; open question
  14.)

A check run from a `pull_request` workflow runs the workflow file of the
branch, so the agent can change what the check does. It is evidence only
because `.github/**` is a floor path: a branch that changes the workflow is
held for the owner.

GitHub treats `skipped` and `neutral` as passing for required checks. The gate
does not: a named check that did not run is not evidence (open question 21).

### 5.6 Codex review state

The parser is a port of the hardened variant of the consumers' Codex review
gate script (the public variant is
`scripts/codex-review-gate.mjs` in quorum-election-simulator). It depends on
observed HTML markers in Codex's comments that Codex does not document as a
stable format: `<!-- codex-pull-request-review-summary -->`,
`<!-- codex-review-state:v1 {json} -->` and `<!-- codex-review-receipt:v1 -->`.
When the format changes, every lane stops at `blocked:codex` until the kit is
fixed and each consumer bumps its pin.

An item is trusted only when its author's numeric user id and login both equal
the Codex bot's (the values in the public script named above).

Steps, first match wins, giving a state:

1. Trusted issue comments containing the summary marker: none, `pending`
   (`no-summary`); more than one, `error` (`ambiguous-summaries`).
2. The summary holds exactly one state marker, else `error`
   (`unsupported-format`); its JSON parses and has `code_review.commit_sha` as
   a string, else `error` (`invalid-state`).
3. `commit_sha` differs from the head: `pending` (`stale-review`).
4. `status` is `running`, `pending` or `queued`: `pending`. Any other value
   except `completed`: `error` (`review-status`).
5. `has_any_findings` and `has_unresolved_findings` must both be booleans,
   and `has_unresolved_findings` must not be true while `has_any_findings` is
   false: else `error` (`invalid-findings-state`).
6. A trusted, non-reply review comment whose `commit_id` is the head but which
   has no `original_commit_id`: `error` (`finding-missing-original-commit`).
7. Current findings: trusted, non-reply review comments whose
   `original_commit_id` is the head (never `commit_id`, which GitHub remaps
   after a push), plus findings taken from the bodies of trusted, non-pending
   reviews whose `commit_id` is the head. A review body that is empty or
   whitespace-only yields no finding. Otherwise it yields one finding per
   line whose title starts with `[P` or `![P`; a body with no such line yields
   itself as one finding, unless it contains the receipt marker.
8. A finding's priority is read only from its title (first line, HTML tags and
   leading list or heading markup removed): `[P0]`..`[P3]` or
   `![P0 Badge](...)`..`![P3 Badge](...)`. Any priority 0 or 1: `blocking`
   (`p0-p1`). Any finding without a readable priority: `error`
   (`finding-unclassified`). `has_any_findings` true with no current finding:
   `error` (`findings-unverified`).
9. Current findings all P2 or P3: `advisory`. No current finding: `clean`.
10. Override: any trusted, non-pending review on the head with state
    `CHANGES_REQUESTED` makes the state `blocking` (`changes-requested`),
    whatever the steps above gave.

Mapping to reasons, by the manifest's `codex_clean`:

| State | `no_blocking` | `no_findings` |
| --- | --- | --- |
| `pending` | `wait:codex` | `wait:codex` |
| `error` | `blocked:codex` | `blocked:codex`, except `finding-unclassified` and `findings-unverified`, which give `fix:codex` (any finding blocks in this mode) |
| `blocking` | `fix:codex` | `fix:codex` |
| `advisory` | passes | `fix:codex` |
| `clean` | passes | passes, then the security review check below |

`no_findings` is the multi-repo routine's current rule (no finding of any
priority). It also checks `security_review` in the state JSON as that routine's
script does: absent or `status` null passes; `running`, `pending` or `queued`
gives `wait:codex`; another non-`completed` status gives `blocked:codex`;
`completed` with `has_any_findings` not `false` gives `fix:codex`. Under
`no_blocking` the security review is ignored, as the other consumers' scripts
ignore it (open question 15).

### 5.7 Base ancestry and mergeability

- The base tip must be an ancestor of the head. Otherwise `update:base`.
- Outside replay: `mergeable` null (GitHub still computing) gives
  `wait:mergeable`; `false` with the base an ancestor gives
  `blocked:not-mergeable`.

### 5.8 Halt and freeze

- Any open issue labelled `pipeline-halt` gives `wait:halt`. This replaces the
  missing pause switch: the owner opens such an issue to stop every merge at
  once. Anyone who can label issues can stop the pipeline; only the owner
  should close it.
- A lane with `freeze_while_open: {head, base}` gives `wait:freeze` while any
  open pull request has that head branch and that base. For the game consumer
  this is "no merge into the preview branch while a promotion pull request
  from the preview branch into `main` is open": the owner is checking that
  preview, and nothing may change it underneath.

### 5.9 Owner signals

- Draft: `hold:owner`.
- Title containing `[FAILED]` or `[NEEDS-DECISION]`, case-insensitive:
  `hold:owner`. Both runners prefix titles this way today and the owner uses
  the prefix to take a pull request out of the automated path.

### 5.10 Merge parameters

With `merge`, the gate also returns the parameters the merge call must use:
method `squash`, the evaluated head SHA as the expected head (so a newer head
refuses the merge), and the lane's `marker` line (for example
`Auto-Merged-By: quorum-night-runner`) as the commit message. All lane merges
are squash merges today; the game consumer's promotion uses a merge commit but
is always merged by the owner.

## 6. Trust root, manifest and `rules.md`

**Trust root.** The manifest is read from a fresh fetch of the consumer's
default branch at the time of the call: never local refs, never the pull
request, never a lane base that the gate itself merges into. The manifest's
path is on the floor, so a change to it is owner-merged. For the game consumer,
whose sessions work on the preview branch, whether the manifest is read from
`main` or from the preview branch is open question 1.

**Manifest schema (version 1).** The verdict function receives the manifest as
text and validates it; any invalid manifest gives `blocked:manifest`. Unknown
keys are invalid. The on-disk format and file name are open question 12;
Phase 1 reads JSON at `.agent-line/manifest.json` on the default branch, or
from a file passed to the CLI.

```json
{
  "schema": 1,
  "kit": "0123456789abcdef0123456789abcdef01234567",
  "checks": ["check"],
  "codex_clean": "no_blocking",
  "hold_paths": ["docs/private/**"],
  "lanes": {
    "runner": {
      "kind": "queue",
      "base": "preview",
      "auto_merge": true,
      "tier": {
        "default": "hold",
        "auto": ["src/**", "docs/**"],
        "strong_review": []
      },
      "max_changed_lines": null,
      "freeze_while_open": { "head": "preview", "base": "main" },
      "marker": "Auto-Merged-By: example-runner"
    }
  }
}
```

The values are illustrative. The example is valid against the table below, and
a test reads this block and validates it.

| Field | Rule | Requirement behind it |
| --- | --- | --- |
| `schema` | must be `1` | lets the kit reject a manifest written for another version |
| `kit` | 40 lowercase hex | single pin (section 7) |
| `checks` | non-empty array of names, or `"none"` | each consumer names its CI check (`check`, `gate`, or the routine's checks) |
| `codex_clean` | `no_blocking` or `no_findings` | the multi-repo routine requires no findings; the others allow P2/P3 |
| `hold_paths` | array of patterns, may be empty | each consumer's current sensitive-path list beyond the floor |
| `lanes` | object, at least one lane; names match `^[a-z][a-z0-9-]*$`; at most one `queue` lane | queue runners and the routine's two caller lanes |
| `kind` | `queue` or `caller` | section 5.2 |
| `base` | one branch name | one base per lane |
| `auto_merge` | boolean | the consumers' switches for runner merging |
| `tier.default` | `auto` or `hold` | allowlist for the routine; denylist for the game consumer, where a preview and the owner's promotion stand before production; the public consumer's choice is open (open question 3) |
| `tier.auto` | patterns; required when `default` is `hold`, forbidden otherwise | the routine's allowlist |
| `tier.strong_review` | patterns, may be empty | `hold:strong-review` routing; the lists are open question 5 |
| `max_changed_lines` | positive integer or null | the routine's 150-line budget |
| `freeze_while_open` | optional `{head, base}` | the game consumer's promotion freeze |
| `marker` | one line starting `Auto-Merged-By: ` | the morning desk recognises unattended merges by this line today |

Branch names in the manifest must match `^[A-Za-z0-9._/-]+$`, must not start
with `-` or `/`, and must not contain `..`.

Fields that existed in earlier drafts and are not in version 1, with the
reason, are listed under follow-ups (section 11).

**`rules.md`.** Each consumer keeps its genuinely local runner rules (for
example: documentation that must accompany a change, a proposals routine, the
promotion flow, a revert rule, backlog triage) in `.agent-line/rules.md`. The
gate does not read it. A local rule moves into the kit only when a second
consumer needs the same rule. Content rules that need file contents (front
matter keys, a JSON file that may change only in its version field, sections
of one file that may change) are planned as a consumer-supplied `extra_check`
script read from the default branch (section 11).

## 7. Pinning (later slice)

- One pin per consumer: the manifest's `kit` commit SHA. The manifest is a
  floor path, so a pin bump is an owner-merged pull request.
- The bootstrap vendored in the consumer fetches the kit fresh at that SHA by
  anonymous clone, checks that the SHA is reachable from the kit's default
  branch (so a commit that exists only on an unmerged kit branch or a fork is
  refused), and only then runs the gate. The reachability check is done by the
  bootstrap, not by the pinned kit code.
- The kit is never attached to a session as a second repository: a cloud
  session with several repositories does not load repository hooks.
- A pin to an older kit commit (a downgrade) passes the reachability check.
  Whether that needs a further rule is open question 11.

## 8. Invocation (later slice)

The gate runs in three ways. All three use the same verdict function and the
same collector.

### 8.1 Hook, in sessions with one repository

The consumer commits `.claude/settings.json` with one PreToolUse hook
(`onFailure: block`; exit 2 on any error, so a crashing or timed-out hook
blocks). It matches merge-class calls and writes to protected branches:

- the GitHub tools that merge or enable auto-merge;
- Bash commands that reach merge endpoints, `gh pr merge` (including
  `--auto`), the endpoint that merges a branch without a pull request, ref
  updates, and pushes or API file writes and deletions whose target is a lane
  base or the default branch.

The full list is open question 6.

The call must name this repository, carry an expected head SHA equal to the
evaluated head, and use the merge method the gate returns; otherwise the hook
denies. Whether every merge path can carry an expected head SHA is a Phase 0
check.

Decisions the hook returns:

- `merge`: no decision. Returning `allow` would skip the classifier and would
  cover the whole Bash string; returning nothing keeps ordinary permission
  handling.
- With `PIPELINE_LANE=runner` in the environment (set on the runner task's
  dedicated cloud environment, outside the repository): deny every other
  verdict, with the reason.
- Otherwise: `ask` for `hold:*`; for `fix`, `update`, `wait` and `blocked`,
  the decision is open question 4 (recommended: `ask`).
- In the runner lane, the hook also denies writes to `.github/`, to
  `.agent-line/` other than the item's own report, and to `.claude/`. It must
  not block files that a queue item explicitly allows (open question 2).

### 8.2 Procedure call, in sessions with several repositories

A session with several repositories loads no repository hooks. There the
written procedure runs the gate before merging, as the multi-repo routine runs
its bash gate script today, passing its lane. The same applies to the local
review loop, which runs inside a Codex session where no Claude Code hook
exists.

### 8.3 Review loop

The local review loop exists today and is started by the owner. The change is
one step: run the gate before the merge. Because the gate has no input that
records a passed strong review (an approval the agent could write would be an
agent-writable input that enables a merge), a `hold:strong-review` or
`hold:owner` verdict is resolved in the loop by the owner's confirmation, the
same answer the hook's `ask` collects: the owner starting the loop on that
pull request is the confirmation (open question 16).

### 8.4 Morning desk

The owner's daily desk routine runs the replay (section 9) on every pull
request merged into a lane base or default branch since its last successful
run and prints the output verbatim. It lists:

- anomalies: merge commits carrying an `Auto-Merged-By:` marker whose replay
  is not `merge`;
- other merges whose replay is not `merge`, for the owner to recognise as their
  own;
- commits on those branches that belong to no merged pull request;
- for public consumers, whether the ruleset is still enforced and the default
  branch unchanged.

Only the replay is part of the kit's Phase 1. The other lists are desk work.

### 8.5 Phase 0 dependencies

The hook path depends on behaviour that has not been checked in a scheduled
task. Each has a fallback:

| To check | Fallback if it does not hold |
| --- | --- |
| Repository hooks fire in a scheduled task | Procedure call, as in 8.2 |
| The scheduled task's Claude Code version supports `onFailure: block` | Procedure call |
| An environment variable reaches the hook | Lane from the task prompt; procedure call |
| `ask` in a scheduled task denies rather than stalls | `ask` only when explicitly marked interactive |
| A scheduled task can clone the kit anonymously | Vendor the kit into the consumer |
| The hook still loads after the session checks out a non-default branch | Procedure call until that is shown |
| The GitHub tool names in a scheduled task | Match tool names without a fixed prefix |
| Every merge path can carry an expected head SHA | Deny the paths that cannot |

## 9. Replay and backtest

**Replay** evaluates a merged pull request as of its merge time, from facts
that stay true after the merge:

| Input | As of merge time |
| --- | --- |
| Head SHA | the pull request's final head |
| Base tip | the first parent of the merge commit |
| Changed files, modes, NUL, line counts, ancestry | git objects, as in live mode |
| Queue item | at that base tip |
| Manifest | the file passed with `--manifest`, or the default branch's latest first-parent commit dated at or before the merge (commit dates, not push times: a limit) |
| Check runs | runs on the head SHA that had started by the merge time; a run that completed later counts as not completed |
| Codex items | comments and reviews created or submitted at or before the merge time; a trusted item updated after the merge is reported as a limit (its content at merge time is unknown) |
| Title | reconstructed from the issue timeline's `renamed` events |
| Draft | taken as false: GitHub does not merge a draft pull request (not re-verified here) |
| Halt | issues that carry `pipeline-halt` now and were open at the merge time; when the label was added or removed is not reconstructed (a limit) |
| Freeze | pull requests with the freeze head and base that were open at the merge time; base retargeting is not reconstructed (a limit); the head repository is ignored, as live |
| Open state, `mergeable` | not evaluated (GitHub merged it) |

Halt issues and freeze pull requests are judged from their latest close time
only. One closed before the merge and reopened later can look open at the
merge time, so replay reports the limit `reopen-history-unknown` whenever it
collected any. It can only add a stop to a replayed verdict, never remove one.

Replay assumes that the pull request was merged by a squash or a merge commit.
Rebase merges are unsupported: the first parent of a rebased commit is not the
base tip at merge time, so the replay of such a merge is not meaningful and the
kit does not detect or flag it.

Replay output adds the merge commit, the marker line found in its message (or
none), and every limit that applied. The marker is self-reported by whoever
merged. Replay uses it to sort merges into "claimed to be unattended" and
"other", and to find the caller lane of a pull request that is not on a queue
branch (section 5.2). A missing or unknown marker leaves such a pull request
without a lane, so its replay is `hold:owner` and it is listed for the owner;
a marker therefore cannot turn a replay into `merge` for a lane the pull
request does not satisfy.

**Backtest** replays every pull request merged in a date range, for consumers
that have no manifest yet (with `--manifest`), and summarises verdicts against
markers. Phase 1 uses it to compare the gate with what the consumers' current
rules did during the last month, and the results inform each consumer's hold
paths and tiers.

## 10. Migration (context)

Each consumer migrates as its own piece of work, in three steps:

1. Backtest and shadow: the gate is backtested on merged pull requests and the
   desk replays the previous day's merges. Nothing changes in the consumer.
2. Overlay: manifest, `rules.md` and hook are added; the gate can only deny;
   the old written rules stay in force. The result can only be stricter than
   today.
3. Switch: the old merge text becomes a pointer to the gate and duplicated
   rules are deleted. The gate is then the only judge.

Phase 0 (independent fixes and the live checks of 8.5) and Phase 1 (this kit's
library and the backtest) are prerequisites for every consumer. The order of
consumers after that is a recommendation, not a rule.

## 11. Follow-ups (not built, with the reason)

| Item | Why not now |
| --- | --- |
| Interactive lane (`interactive_auto`) for pull requests that match no lane | No consumer has chosen it; which ones will is undecided |
| `extra_check`: a consumer script read from the default branch that gets base and head SHAs, reads content with `git show`/`ls-tree`, no checkout, no token | Needed first by the multi-repo routine (front matter, version-only JSON, backlog sections) and possibly the game consumer's `Date:`/`Status:` rule (open questions 9, 18); not needed for the Phase 1 backtest of the other consumers |
| Fix-round caps, open-pull-request caps, the 6-hour park rule | Runner procedure behaviour, not merge conditions |
| A `needs-decision` label in addition to the title prefix | The title prefix already serves the purpose; adding a label adds an input |
| Detection of commits that belong to no pull request | Desk work (Phase 5); not a gate verdict |
| Path forms that a case- or normalisation-insensitive filesystem maps onto a floor path (for example ignorable code points or trailing dots) | Needs a crafted input not seen in a real run; recorded, not built |
| Configurable queue branch form, queue and report directories | Both queue consumers use the same form today |
| Kit repository's own merge rules and ruleset | Open question 11 |
