# Design

This is the canonical design of the kit. Sections 1 to 6 and 9 are what
Phase 1 implements, except the content rules (section 5.4.1 and the
`content_rules` field of section 6). Section 7 (pinning), section 8 (hook,
procedure invocation and the path check) and those content rules are specified
here and implemented in later slices; a statement about them describes
intended behaviour, not code that exists. The later slices are listed in
[the implementation plan](implementation-plan.md#9-slice-2-content-rules-in-the-core).
Facts about GitHub, Claude Code and Codex that the design depends on are
listed with their verification status in
[the review brief](review-brief.md#platform-facts); the outside practice that
informed the path, signal and extension design is summarised in
[the research note](research/2026-11-policy-shape.md).

Terms:

- **Consumer**: a repository that adopts the kit. The current consumers are a
  public repository whose `main` deploys production
  (quorum-election-simulator), a private game repository whose runner merges
  into a preview branch that the owner later promotes to `main`, and a private
  repository maintained by a multi-repo routine (a nightly routine and a triage
  routine that run in sessions with several repositories attached).
- **Lane**: a named path by which pull requests reach a base branch
  unattended. A lane has exactly one base.
- **Floor**: the hard-coded list of paths whose change always needs the owner,
  grouped by what the files can do (section 5.4).
- **Policy**: the floor plus one consumer's manifest. Everything that decides
  which paths and which file contents a lane may change unattended is policy.
  It has these two homes and no others (section 6).
- **Content rule**: a declarative rule in the manifest that looks at what a
  file contains, not only at its path (section 5.4.1). A content rule can only
  add a hold.
- **Runner**: an unattended scheduled session. **Interactive**: a session the
  owner is in.

## 1. Stance

The agent acts on GitHub with the owner's identity, so GitHub cannot tell the
agent from the owner. Private repositories on the free plan have no rulesets.
The kit therefore does not build a merge service on GitHub. It makes the merge
decision one tested program, runs it at the tool boundary where the merge call
is made, and re-checks every merge the next day. It is a guardrail with
detection, not a boundary. [The threat model](threat-model.md) states what that
does and does not protect. The merge-time path policy protects two things
only: what a check result on the head means, and what lands on the base
branch, which the next session and the owner's next pull receive. It does not
protect against code that runs before the merge (section 5.5). A real boundary
needs a GitHub identity for the agent that is separate from the owner's; it is
deferred (threat model, optional upgrades).

## 2. Components

| Component | Where | Phase |
| --- | --- | --- |
| Verdict function `evaluate(input)`: pure, deterministic, no I/O | kit, `src/core/` | 1 |
| Input collector: reads GitHub REST and git objects, builds the input | kit, `src/collect/` | 1 |
| CLI: `evaluate`, `replay`, `backtest` | kit, `src/cli.js` | 1 |
| PreToolUse hook script and a small vendored bootstrap | kit (script), consumer (bootstrap, settings) | later |
| Content rules: pure evaluation of the manifest's `content_rules` against the base and head contents of changed files | kit, `src/core/` | later (slice 2) |
| Path check: the change-set conditions of section 5.4 for a base and a head, with no pull request, reporting each path's class | kit, CLI `check-paths` | later (slice 3) |
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
| `hold:owner` | The change needs the owner: a floor or hold path, a path outside the allowlist, a content rule, no lane, wrong base, a queue item marked `merge: owner`, a `[FAILED]` or `[NEEDS-DECISION]` title, a draft, a size limit, runner merging switched off | Does not merge; leaves it for the owner | Ask the owner; the owner's answer is the approval |
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
| Contents of changed files that a content rule matches | git objects: `git cat-file blob` of the merge-base side and the head side of each changed regular-file path that matches a glob of `hold_on_line_change`, `keys_only` or `front_matter_only` (section 5.4.1); `hold_on_add_delete` reads no contents | Stop only: a content rule can only add a hold |
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
never enable one. No title, body or comment can make a pull request pass. The
contents of the files the pull request changes are agent-writable too; the
gate reads them only for content rules, which can only add a hold, so no file
content can make a pull request pass. The text of those files never enters a
reason (section 5.4.1), because the desk prints reasons verbatim and an agent
reads them.

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
no other lane) is not built (decision 2026-11-22); section 11 says why.

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
- A runner lane is written as an allowlist: `tier.default: "hold"`, with
  `tier.auto` listing what that lane's work looks like. A path that matches
  none of `tier.auto` gives `hold:owner` (`not-in-allowlist`), so a path
  nobody listed (a new directory, a new file type, a new kind of
  configuration) is held until the owner lists it. `tier.default: "auto"`
  (denylist: any path not caught above is auto) remains valid in schema 1 but
  is not the form for a runner lane; section 11 records that a later schema
  version may drop it.
- A content rule of section 5.4.1 that the entry violates gives `hold:owner`.

Holds always win. No condition removes another condition's reason: the
allowlist never overrides the floor, `hold_paths`, the mode and NUL checks or a
content rule, and a content rule never overrides any of them. The only
exemption is the one for the item's own report below.

Per pull request:

- With `max_changed_lines` set on the lane, the sum of added and deleted lines
  over all entries must not exceed it. Otherwise `hold:owner`. The multi-repo
  routine's gate has a 150-line budget today; the other consumers have none.

**Floor** (hard-coded; a manifest can add paths through `hold_paths` but
cannot remove any). Each category has an id, which the path check reports
(section 8.6). Each pattern carries the classes of harm it guards against:

- **authority**: what the next run obeys (agent instructions and settings, the
  pipeline's queue, rules and manifest);
- **execution**: what runs on the owner's machine or with credentials, at a
  pull, an install, a commit or a workflow run;
- **oracle**: what decides whether a check passes (workflow definitions).

The last column lists the patterns of the category that the hook denies at
write time (section 8.1). It is a subset of the category's patterns, possibly
empty, so a category can have patterns that are held at merge but not denied at
write time.

| Id | Category | Patterns (classes) | Write-time deny |
| --- | --- | --- | --- |
| `ci-pipeline` | CI and pipeline | `.github/**` (execution, oracle); `.agent-line/**` (authority) | `.github/**`, `.agent-line/**` (the second except the item's own report) |
| `agent-config` | Agent configuration | `**/.claude/**`, `**/.codex/**`, `**/.mcp.json` (authority, execution); `**/.agents/**`, `**/claude*.md`, `**/agents*.md` (authority) | `**/.claude/**` |
| `local-exec` | Editor, shell and git hooks | `**/.vscode/**`, `**/.idea/**`, `**/.envrc`, `**/.husky/**`, `**/.githooks/**`, `**/git-hooks/**` (execution) | none |
| `git-attributes` | git attributes | `**/.gitattributes`, `**/.gitmodules` (execution) | none |
| `package-config` | Package manager configuration | `**/.npmrc`, `**/.yarnrc`, `**/.yarnrc.yml` (execution) | none |
| `dependencies` | Dependency manifests and lockfiles | `**/package.json`, `**/package-lock.json`, `**/npm-shrinkwrap.json`, `**/yarn.lock`, `**/pnpm-lock.yaml`, `**/pnpm-workspace.yaml`, `**/bun.lock`, `**/bun.lockb`, `**/go.mod`, `**/go.sum`, `**/go.work`, `**/go.work.sum`, `**/cargo.toml`, `**/cargo.lock`, `**/pyproject.toml`, `**/poetry.lock`, `**/pipfile`, `**/pipfile.lock`, `**/uv.lock`, `**/requirements*.txt`, `**/gemfile`, `**/gemfile.lock` (execution) | none |

For example, a write to `CLAUDE.md` is held at merge (`agent-config`) but not
denied at write time, because `**/claude*.md` is not in the write-time column.

Why a list at all: a merged change waits for the morning replay, and three
kinds of change do harm before the replay or a revert can act. A change to
what the next run obeys governs the night's later runs before anyone looks
(authority). A change to what runs on the owner's machine acts at the next
pull, before any revert (execution). A change to what decides a check result
lets the rest of the night's merges pass on false evidence (oracle). The floor
holds these three classes until the owner has looked.

Product code is deliberately not on the floor: a revert undoes it, and a
consumer that promotes through a preview branch has the owner's promotion
between a merged change and production. Tests that live in the product tree
are oracle too, but the floor is the same in every consumer and cannot know
where a consumer keeps them; a consumer holds its own oracle files with
`hold_paths`, or by leaving them out of the allowlist (open question 22). The
dependency list is the kit's choice of "common ecosystems"; extending it is a
kit change.

`claude*.md` and `agents*.md` deliberately also catch names such as
`docs/agents-notes.md`. Over-matching only holds a pull request.

**Floor exception**: in the queue lane, the item's own report
`.agent-line/reports/<id>.md`, with status added or modified and head mode
`100644`, is not a floor path, and it is also exempt from the lane's
`tier.auto` (allowlist) and `tier.strong_review` checks, so that a manifest
need not list the report directory in an allowlist and a strong-review pattern
cannot route every runner pull request away from `merge`. The manifest's
`hold_paths`, the content rules, the mode check and the NUL check still apply
to it. Every runner pull request contains its report, so without this
exception the floor would hold all of them. A deleted report, another item's
report, or a report in a caller lane stays on the floor and under the tier
checks.

**Pattern syntax**: segments separated by `/`. A segment `**` matches zero or
more whole segments; `*` inside a segment matches any characters except `/`.
Every other character is literal. A manifest pattern containing `?`, `[`, `]`,
`{`, `}`, `!` or `\`, starting with `/`, or empty, makes the manifest invalid.
This is the subset the consumers' current path lists use. Paths and patterns
are compared after lowercasing both, so a path that differs from a listed one
only by case matches the same entries (for a hold this only holds more; for an
allowlist entry it allows a case variant of an allowed path, which is
recorded in the review brief as a question).

#### 5.4.1 Content rules (later slice)

The manifest's optional `content_rules` object (section 6) holds four rule
types. A path rule looks at where a change is; a content rule looks at what
the changed file contains. Each type replaces a rule that a consumer's runner
specification otherwise states in prose and a script or the agent checks.

Common semantics, which apply to all four types:

- **Scope.** A rule applies to a diff entry (section 5.4) whose path matches
  the rule's glob, using the pattern syntax above. A rename is a deletion
  entry for the old path and an addition entry for the new path, and each is
  matched and evaluated alone. An entry with status `T` is not evaluated by
  a content rule: the mode condition already holds it. More generally, an
  entry whose head mode exists and is not `100644` is not a content target
  (it already holds on mode); a deleted entry has no head mode and is a
  target.
- **Only holds.** A violated rule adds a `hold:owner` reason. A rule that
  matches nothing, or is satisfied, changes nothing. No rule can allow a path
  that another condition holds. The rules apply to every lane, to the
  item's own report and to the path check.
- **Sides.** The *base side* of an entry is the blob at the merge base, the
  *head side* the blob at the head. The base side of an added entry and the
  head side of a deleted entry are absent. These are the two sides of the
  diff, not the base tip, so that replay and live evaluation read the same
  objects.
- **Readable.** A blob is readable when it is at most `CONTENT_MAX_BYTES`
  (1,048,576), valid UTF-8, free of NUL bytes and does not begin with U+FEFF
  (a byte-order mark: common loaders strip it and read the content after it
  as if it were not there, so a rule that looked at the unstripped text could
  be evaded). An unreadable blob of a matched entry holds under types 2 to 4
  (detail `unreadable`). If the collector did not supply a blob that a matched
  entry needs, or gave a side as absent where the status says it exists (the
  base side of `M` and `D`, the head side of `A` and `M`) or as present where
  the status says it is absent, the verdict is `blocked:input`
  (`content-missing`): that is a collector fault, not a property of the
  change.
- **Reasons carry no file text.** A reason's detail is the entry's path and
  one word from a closed vocabulary (below). The text of a file, a line or a
  key never appears in a reason.
- **Order of reasons.** Content reasons are added inside the per-entry loop of
  section 5.4, for each entry in diff order, after that entry's other
  reasons (mode, binary, floor, hold path, strong review, not-in-allowlist);
  for one entry in the order of the types as listed below, and within a type
  in the order of the rules in the manifest array. The per-pull-request
  `too-large` reason follows all entries.
- **Lines.** Lines are split at `\n`; one trailing `\r` is removed from each
  line; a final line without a newline counts; an empty file has no lines.

**Type 1, `hold_on_add_delete`: array of globs.** An entry with status `A` or
`D` whose path matches holds. Status `M` does not. Reason `rule-add-delete`,
detail word `added` or `deleted`. A rename of a matching file holds twice (the
deletion at the old path, the addition at the new path), unless only one side
is under the glob, which then holds once. Needs no file contents.

**Type 2, `hold_on_line_change`: array of `{glob, pattern}`.** The entry holds
when a line that matches `pattern` is added or removed.

- *Line pattern syntax*: the pattern is literal text (case-sensitive), with an
  optional leading `^` that anchors it to the start of the line and an
  optional trailing `$` that anchors it to the end. No other character is
  special: `.`, `*` and `\` are literal. The literal part must not be empty.
  Without anchors the pattern matches anywhere in the line. A pattern that
  needs a literal leading `^` or trailing `$` cannot be written (recorded in
  section 11).
- *What counts as a changed line*: let `count(side, L)` be how many times the
  line text `L` occurs on a side (0 for an absent side). A line text `L` that
  matches the pattern is changed when `count(base, L) != count(head, L)`.
  Order is not compared: a pure move of a matching line is not a change, and
  an edit of a matching line is one removal plus one addition and holds. An
  added file contributes every head line as added; a deleted file every base
  line as removed.
- Reason `rule-line-change`, detail word `line-changed`.

**Type 3, `keys_only`: array of `{glob, keys}`.** `keys` is a non-empty array
of distinct non-empty strings: top-level key names of a JSON object. A file
under the glob may change only those keys.

- *Parse*: each side that exists must be valid JSON whose top level is an
  object, and without a duplicate key at any depth (duplicate keys are read
  differently by different parsers). A leading byte-order mark is already
  unreadable. Otherwise the
  entry holds with detail `unreadable`. The parser needs no dependency; a
  strict tokenizer around `JSON.parse` is enough.
- *Rule*: an entry with status `A` or `D` holds (detail `added` or
  `deleted`): a structured file under a keys-only rule is neither created nor
  removed unattended. This precedes the parse: for status `A` or `D` the
  existing side is not parsed, so an added or deleted file that is malformed
  or unreadable gives exactly one `rule-keys` reason per rule, with detail
  `added` or `deleted`, never `unreadable`. For status `M`, take the top-level keys of both sides
  that are not in `keys`. The entry holds (detail `key-changed`) unless every
  such key is present on both sides with an equal value. Values are equal when
  they are the same JSON value: objects compare without key order, arrays with
  order, numbers by numeric value. Keys named in `keys` may be added, removed
  or changed freely. Whitespace and key order are not compared, so a
  reformatting alone passes.
- Only top-level key names are supported; a rule on a nested key is a
  follow-up (section 11).
- Reason `rule-keys`.

**Type 4, `front_matter_only`: array of `{glob, keys}`.** `keys` is as in
type 3. The front matter of a file under the glob may change only those keys
and must stay well-formed. The body (everything after the front matter) is not
compared.

- *Front matter*: a side has front matter when its first line starts with
  `---`. It is well-formed only if that first line is exactly `---`, a later
  line exactly `---` closes it, no `\r` occurs from the first line through the
  closing line (checked on the raw text, before the carriage-return removal of
  the Lines rule), and its lines are blocks. A **key line** matches
  `^[A-Za-z0-9_][A-Za-z0-9_-]*:` at column 0. A **block** is a key line and
  every following line up to the next key line or the closing line; each
  following line must be blank, start with a space or a tab, or start with
  `- `. Any other line at column 0 (a comment, a quoted key, a stray word)
  makes the front matter malformed, as does a line before the first key line
  that is not blank, and a repeated key. A first line that starts with `---`
  but is not exactly `---` (a trailing space, a language tag) is malformed. A
  side whose first line does not start with `---` has no front matter, which
  is the same as an empty set of blocks; a leading form feed therefore reads
  as "no front matter". (A leading byte-order mark never gets this far: the
  file is unreadable and holds.)
- *Rule*: an entry holds (detail `front-matter-invalid`) if a side that exists
  has malformed front matter, or the file is unreadable (detail
  `unreadable`). Otherwise take, per side, the map from key to block text
  (the key line and its following lines joined with `\n`), absent sides being
  empty. The entry holds (detail `front-matter-changed`) unless every key
  that is not in `keys` is present on both sides with identical block text.
  An added or deleted file therefore passes only if every key it carries is
  named. Because a malformed or removed front matter makes keys vanish,
  turning front matter into body text (a form feed, a changed opener) cannot
  hide a change, and a byte-order-mark prefix cannot hide it either, since it
  makes the file unreadable.
- Reason `rule-front-matter`.
- "Well-formed" means this section's grammar, not YAML. A value that YAML
  would reject, or an anchor or alias, passes if the grammar accepts the block
  and the block text is unchanged or the key is named (threat model residual
  12).
- Not covered: a whole-file rule such as "no carriage returns anywhere in a
  Markdown file" (section 11). A leading byte-order mark is covered by
  readability for every file a rule matches.

**Evaluation and replay.** The core receives, with the diff entries, the
blobs of each entry that matches a glob of types 2 to 4 (shape in the
implementation plan, slice 2). A pure helper tells the collector which paths
need blobs, so the collector holds no decision. The rules read only git
objects, never the clock or the network, so replay evaluates them exactly as
live mode does, from the manifest in force at the merge time (section 9). A
rule added to the manifest after a merge does not apply to that merge's
replay.

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
held for the owner. The relation runs one way: trust in a check result depends
on the oracle files being held, but nothing about the path policy depends on
check results. It is also partial. Tests that live in the product tree are
agent-editable wherever the allowlist includes them (threat model residual 7);
a consumer holds its oracle files with `hold_paths` or keeps them outside the
allowlist (open question 22).

The hold protects what a check result means at merge time. It does not stop
the run itself: a same-repository `pull_request` run executes the branch's
workflow file before any merge, receives the repository's secrets (this
follows from GitHub's documented exception for forks, "With the exception of
`GITHUB_TOKEN`, secrets are not passed to the runner when a workflow is
triggered from a forked repository"; the same-repository case is not
separately tested) and may
raise its token permissions in that file (threat model residual 11). The
answers to that are structural and sit outside the merge-time policy: a
consumer keeps deploy secrets in an environment limited to its production
branch, and the hook denies writes to the workflow directory at write and push
time (section 8.1).

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
`main` or from the preview branch is open question 1; it applies equally to
the path check (section 8.6) and the hook (section 8.1), which read the same
file.

**One policy, two homes, three readers.** Policy has exactly two homes, split
by scope: the **floor** in the kit (the same in every consumer, and a manifest
cannot loosen it) and **one manifest per consumer** (its allowlist, defensive
`hold_paths` and `content_rules`). Three enforcement points read that same
policy, and none keeps a list of its own:

- the write and push hook on the runner lane (section 8.1) reads the floor's
  write-time column and the lane's own-report exception;
- the path check (section 8.6) reads the floor and the whole manifest, for a
  base and a head, with no pull request;
- the merge gate (section 5.4) reads the floor and the whole manifest, for a
  pull request.

A prose copy of the policy in a consumer's runner specification is replaced by
a pointer to the manifest only at that consumer's switch step (section 10),
and only once the path check exists, because the specification's prose also
serves moments the pull-request-bound gate cannot: a tip check before any pull
request exists, and the lists a runner writes into a pull request description.
Process state (an owner pull request being open, round caps, waits) is not
policy and has no home here: it belongs to the gate core or to the runner
procedure (section 11).

**Manifest schema (version 1).** The verdict function receives the manifest as
text and validates it; any invalid manifest gives `blocked:manifest`. Unknown
keys are invalid. The on-disk format and file name are open question 12;
Phase 1 reads JSON at `.agent-line/manifest.json` on the default branch, or
from a file passed to the CLI. `content_rules` is an optional key added to
version 1 without a version bump: a manifest without it is unchanged, and a
manifest that uses it fails closed (`blocked:manifest`, unknown key) in a kit
that predates it, which is safe because the manifest's `kit` pin names the kit
that reads it.

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
a test reads this block and validates it. It shows a runner lane written as an
allowlist: `tier.default` is `hold` and `tier.auto` lists what the lane's work
looks like.

The optional `content_rules` key sits at the top level beside `hold_paths` and
applies to every lane. This fragment shows its shape (section 5.4.1 gives the
semantics); it is added to the example above when slice 2 implements it:

```json
{
  "content_rules": {
    "hold_on_add_delete": ["docs/specs/**"],
    "hold_on_line_change": [{ "glob": "docs/specs/**", "pattern": "^Status:" }],
    "keys_only": [{ "glob": "tools/*/config.json", "keys": ["version"] }],
    "front_matter_only": [{ "glob": "docs/guides/**/*.md", "keys": ["description"] }]
  }
}
```

| Field | Rule | Requirement behind it |
| --- | --- | --- |
| `schema` | must be `1` | lets the kit reject a manifest written for another version |
| `kit` | 40 lowercase hex | single pin (section 7) |
| `checks` | non-empty array of names, or `"none"` | each consumer names its CI check (`check`, `gate`, or the routine's checks) |
| `codex_clean` | `no_blocking` or `no_findings` | the multi-repo routine requires no findings; the others allow P2/P3 |
| `hold_paths` | array of patterns, may be empty | defensive entries inside allowed directories, and files a consumer wants held that the floor does not know |
| `lanes` | object, at least one lane; names match `^[a-z][a-z0-9-]*$`; at most one `queue` lane | queue runners and the routine's two caller lanes |
| `kind` | `queue` or `caller` | section 5.2 |
| `base` | one branch name | one base per lane |
| `auto_merge` | boolean | the consumers' switches for runner merging |
| `tier.default` | `auto` or `hold` | `hold` (allowlist) is the form for every runner lane (decision 2026-11-22); `auto` (denylist) stays valid in schema 1 and no consumer plans to use it |
| `tier.auto` | patterns; required when `default` is `hold`, forbidden otherwise | the allowlist: what the lane's work looks like |
| `tier.strong_review` | patterns, may be empty | `hold:strong-review` routing; the lists are open question 5 |
| `max_changed_lines` | positive integer or null | the routine's 150-line budget |
| `freeze_while_open` | optional `{head, base}` | the game consumer's promotion freeze |
| `marker` | one line starting `Auto-Merged-By: ` | the morning desk recognises unattended merges by this line today; it must name the lane of the pull request, never the routine that ran the merge (section 9) |
| `content_rules` | optional object; optional keys `hold_on_add_delete`, `hold_on_line_change`, `keys_only`, `front_matter_only`; default: no rules; unknown keys invalid | rules about what a file contains (section 5.4.1) |
| `content_rules.hold_on_add_delete` | array of globs (pattern syntax of section 5.4), may be empty | a rule that no file under a directory is added, deleted or renamed unattended |
| `content_rules.hold_on_line_change` | array of `{glob, pattern}`; `glob` valid; `pattern` a line pattern: a non-empty literal, optionally anchored with a leading `^` or trailing `$`, no other special characters; no other keys | a rule that no `Date:` or `Status:` style line changes unattended |
| `content_rules.keys_only` | array of `{glob, keys}`; `glob` valid; `keys` a non-empty array of distinct non-empty strings; no other keys | a structured file that may change only its version field |
| `content_rules.front_matter_only` | array of `{glob, keys}`, as `keys_only` | front matter that may change only its description |

Branch names in the manifest must match `^[A-Za-z0-9._/-]+$`, must not start
with `-` or `/`, and must not contain `..`.

Fields that existed in earlier drafts and are not in version 1, with the
reason, are listed under follow-ups (section 11).

**`rules.md`.** Each consumer keeps its genuinely local runner rules (for
example: documentation that must accompany a change, a proposals routine, the
promotion flow, a revert rule, backlog triage) in `.agent-line/rules.md`. The
gate does not read it. A local rule moves into the kit only when a second
consumer needs the same rule. Rules about file contents are declarative
`content_rules` in the manifest (section 5.4.1), evaluated by the pure core:
they replay by construction, share the one policy file, and execute no
consumer-supplied code. A consumer-supplied script (`extra_check`) is a
recorded contract, built only for the first rule the four types cannot express
(section 11).

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
same collector. A fourth reader of the same policy, the path check (section
8.6), uses the core's change-set evaluation without a pull request.

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
- With `PIPELINE_LANE` set in the environment (on the runner task's
  dedicated cloud environment, outside the repository): deny every other
  verdict, with the reason. The value is the manifest's name for the queue
  lane, `runner` in the example manifest. Runner mode is "the variable is
  set and not empty", not "the value names a known lane": a value that names
  no queue lane of the manifest, or a manifest that cannot be read, still
  denies, with reason `unknown-lane`, so a mismatch between the environment
  and the manifest cannot switch the hook off.
- Otherwise: `ask` for `hold:*`; for `fix`, `update`, `wait` and `blocked`,
  the decision is open question 4 (recommended: `ask`).
- In runner mode, the hook also denies writes and pushes whose target is
  in the write-time column of the floor table (section 5.4): the workflow
  directory `.github/**`, `.agent-line/**` other than the item's own report,
  and `**/.claude/**`. It reads the floor and the manifest, so it has no
  list of its own. The reason is timing, not the merge: a same-repository
  `pull_request` run executes the branch's workflow file with the
  repository's secrets before any merge, and an agent's edit to `.claude/`
  takes effect in the session, so a merge-time hold comes too late for both.
  Paths that the policy only holds at merge (hold paths, paths outside the
  allowlist, the rest of the floor) are not denied at write time: the runner
  may open a pull request that changes them, and the gate leaves it for the
  owner. Content rules are not evaluated at write time. Whether the hook's
  deny set needs consumer additions is open question 2.
- The write-time deny is only as good as the hook's ability to enumerate what
  a call writes. A file-write tool names its path, but Bash can write files and
  push commits with no per-path tool call. The requirement on the hook slice
  is therefore: for a push (or any call that updates a remote ref), compute the
  raw diff of the pushed range against the remote ref, evaluate every path of
  it against the write-time column, and deny when the range cannot be
  determined (open question 32).

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
- commits on those branches that belong to no merged pull request (required,
  not optional, if a probe shows that the runner's connection can push to a
  lane base directly; open question 27);
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

A kit for running these eight checks in a throwaway repository is in
[`probes/phase0/`](../probes/phase0/README.md). It has been reviewed and never
run. The policy probes (open questions 26 to 31) are separate: they concern
GitHub and the runner's credentials, not hooks.

### 8.6 Path check without a pull request (later slice)

The change-set conditions of section 5.4 do not depend on a pull request, only
on a base and a head. The path check runs them for a base and a head and
reports the class of each path, so that a runner can ask before it opens a
pull request, and can list in a pull request description the paths a hold
will apply to. It evaluates nothing else: no checks, Codex state, halt,
freeze, draft or title, and its result never says `merge`.

Command (the usage line is in the implementation plan, slice 3):
`agent-pipeline-gate check-paths`.

Inputs:

- the repository and a local clone, as for the other commands;
- `--base`: a branch name, fetched fresh from `origin` into a private
  namespace, as the collector does; and `--head`: a full commit SHA that is
  already in the clone (the runner's own unpushed commit is valid). The diff is
  `merge-base..head`, as in section 5.4. Nothing is checked out;
- optionally `--lane NAME`. With a lane, the lane-dependent conditions run as
  well (allowlist, strong-review routing, line budget); without one, only the
  lane-independent classes are reported. A name that is not a lane of the
  manifest gives `blocked:lane` (`unknown-lane`), never `clear`. With a queue
  lane, optionally `--item ID`, which enables the own-report exemption of
  section 5.4 for that item. An `--item` that does not match the queue-id form
  `^[a-z0-9][a-z0-9-]*$`, or is given without `--lane`, or with a lane that is
  not a queue lane, is a usage error;
- the manifest, from a fresh fetch of the default branch, exactly as in
  section 6. `--manifest FILE` replaces it for backtests and tests only, and
  the output says so.

The caller supplies the base. The check does not validate that `--base` is the
named lane's base branch or the branch the pull request will target; a runner
that passes another base gets a correct report for that base. This is a limit,
recorded here and in the plan, not a condition.

Output, one JSON object: `repo`, `kit`, the base SHA, the merge base, the head
SHA, the lane or null, `manifest` (`source`: `trust-ref` or `file`, and the
blob id read), `result`, `reasons` (the gate's reason shape) and `paths`. Each
entry of `paths` has the path, its diff status, and `classes`, the list of
every class that applies, in this order:

| Class | Meaning |
| --- | --- |
| `floor:<id>` | a floor path of that category (section 5.4 table) |
| `hold-path` | matches the manifest's `hold_paths` |
| `mode`, `binary` | the mode or NUL conditions |
| `content:<type>` | a content rule of section 5.4.1 (`add-delete`, `line-change`, `keys`, `front-matter`) |
| `strong-review` | matches the lane's `tier.strong_review` (lane given) |
| `not-in-allowlist` | matches none of the lane's `tier.auto` (lane given, default `hold`) |
| `own-report` | the item's own report, exempt from floor, allowlist and strong review |
| `allowed` | none of the above applies |

`result` is `clear` when no path has a class other than `own-report` or
`allowed` and the line budget holds, `hold:owner` or `hold:strong-review`
otherwise (the same precedence as section 3.1), and `blocked:manifest`,
`blocked:empty-diff`, `blocked:lane` or `blocked:input` as for the gate. A
failure to collect is `blocked:input` (`collect-failed`), never an empty
result. Exit status: 0 for `clear`, 1 for anything else, 2 for a usage error
(including an `--item` as above).

Because the path check and the gate call the same core function, a path that
the check reports as `allowed` is not held by any change-set condition of the
gate for the same lane, and the reverse. The check says nothing about whether
the pull request may merge.

## 9. Replay and backtest

**Replay** evaluates a merged pull request as of its merge time, from facts
that stay true after the merge:

| Input | As of merge time |
| --- | --- |
| Head SHA | the pull request's final head |
| Base tip | the first parent of the merge commit |
| Changed files, modes, NUL, line counts, ancestry | git objects, as in live mode |
| Queue item | at that base tip |
| Contents for content rules | git blobs at the merge base and the head, as in live mode |
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

**The marker names the pull request's lane.** Replay assigns the lane from
the marker, so a marker that names anything else gives the wrong lane. A
consumer whose script writes the name of the routine that ran the merge, not
the kind of pull request, would have a pull request of one kind merged by the
other kind's routine replayed under the other lane and held (a backtest of
such a consumer inferred this for two of its six pull requests of one kind). That
consumer changes its marker to name the lane before it migrates (open question
13). History that predates a consumer's marker cannot be replayed by lane: the
`backtest` command passes no lane, so each such pull request replays as
`no-lane` (open question 24).

Content rules (section 5.4.1) add no time dependence: replay reads the same
git objects as live mode, from the manifest in force at the merge time.

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
   today. The manifest's path policy is written as an allowlist from the start;
   an allowlist is stricter than a denylist, so it fits this step.
3. Switch: the old merge text becomes a pointer to the gate and duplicated
   rules are deleted. The gate is then the only judge. Prose copies of the
   path policy become pointers to the manifest at this step and not before,
   and only once the path check (section 8.6) exists and the manifest's read
   branch is settled (open question 1). Each consumer lists what it deletes
   (open question 8).

Phase 0 (independent fixes and the live checks of 8.5) and Phase 1 (this kit's
library and the backtest) are prerequisites for every consumer. The order of
consumers after that is a recommendation, not a rule.

## 11. Follow-ups (not built, with the reason)

| Item | Why not now |
| --- | --- |
| Interactive lane (`interactive_auto`) for pull requests that match no lane | Not built (decision 2026-11-22). The rules an interactive merge depends on are the owner's own message in the session, a named pull request and a critic's waiver or convergence, and the gate sees none of them: the waiver is recorded in an agent-writable pull request body. In a backtest of one consumer with a forced interactive lane, 1 of 74 pull requests outside the queue lane got `merge` and the rest held or waited, mostly on paths the owner should see anyway |
| `extra_check`: a consumer script, recorded contract below | Built only for the first rule the four content-rule types cannot express (open question 18). Declarative rules replay by construction, share one policy file and execute no consumer code; a script does none of these |
| Content-rule extensions: a nested key path for `keys_only`; a literal leading `^` or trailing `$` in a line pattern; a whole-file rule (no carriage returns; a leading byte-order mark is already covered by readability); a fifth type "named sections of one Markdown file stay unchanged" | No consumer rule needs them yet except the last, which is the first candidate for the `extra_check` contract (open question 18) |
| Reject `tier.default: "auto"` on a lane with `auto_merge: true` | Needs a schema version bump; no consumer's manifest uses `auto`. Do it at the first bump |
| Process-state rules in the gate core, for example "hold while an open pull request is outside every lane" | A candidate home for the rule that an owner pull request being open stops the runner; the other home is the runner procedure. Decided at the first migration that needs it (open question 23). Never a content rule or a script |
| Per-lane `hold_paths` | Only the interactive lane would need them, and that lane is not built |
| Fix-round caps, open-pull-request caps, the 6-hour park rule | Runner procedure behaviour, not merge conditions |
| A `needs-decision` label in addition to the title prefix | The title prefix already serves the purpose; adding a label adds an input |
| Detection of commits that belong to no pull request | Desk work (Phase 5); not a gate verdict |
| Path forms that a case- or normalisation-insensitive filesystem maps onto a floor path (for example ignorable code points or trailing dots) | Needs a crafted input not seen in a real run; recorded, not built |
| Configurable queue branch form, queue and report directories | Both queue consumers use the same form today |
| Kit repository's own merge rules and ruleset | Open question 11 |

### 11.1 Recorded contract: `extra_check`

Recorded so that the first rule that needs it does not reopen the design. Not
built. It applies only to a rule that the four content-rule types of section
5.4.1 cannot express, and a declarative fifth type is the alternative to
building it for that rule.

- **Home.** One script per consumer, under `.agent-line/**` (a floor path),
  read from the same trust root as the manifest (section 6). A change to the
  script is therefore an owner-merged change, and the pull request being
  judged cannot supply the code that judges it.
- **Input.** The base and head SHAs and the changed paths with their A, M or D
  status (renames as D plus A). The script reads contents with `git show` from
  the object database; it is never handed a checkout and never executes
  anything from the pull request. It makes no network call and receives no
  token: the cloud proxy authenticates any process, so "no token" is a
  contract, not an enforced limit, and a script that called the network would
  break replay.
- **Output.** One JSON list of `{id, message, path?}`, each entry a hold.
  `message` follows the rule of section 4: no file text.
- **Failure.** An error, a timeout, an invalid output, a missing script or an
  unsupported contract version is a hold, never a pass. (Claude Code hooks fail
  open by default; this is deliberately the opposite.)
- **Limits.** A timeout with process-group kill, an output size cap and a
  fixed environment with no inherited credentials.
- **Record.** The verdict records the policy commit and the script's blob id,
  so replay can tell whether the policy moved.
- **Can only add a hold.** Like every content rule.

