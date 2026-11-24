# agent-pipeline-kit

A command-line merge gate for coding-agent pipelines on GitHub. It evaluates a pull request against repository policy, GitHub Actions checks, and Codex review evidence for the PR head. Use it before a merge or to audit merged pull requests.

## Migration target

These diagrams record the workflow that consumer repositories are moving toward. The first shows where they started.

### Before migration

Three runners made merge decisions independently.

```mermaid
flowchart TD
  subgraph MR["Multi-repo maintenance routine"]
    direction TB
    h1["Procedure text classifies the PR"] --> h2["Agent decides whether to call<br/>a bash gate script"] --> h3["Agent merges"]
  end
  subgraph GR["Game repo runner, merges into a preview branch"]
    direction TB
    i1["Prose merge conditions in the runner spec<br/>the agent judges them"] --> i3["Agent merges"]
  end
  subgraph QR["quorum-election-simulator runner"]
    direction TB
    q1["Prose merge conditions in the runner spec<br/>the agent judges them"] --> q3["Agent merges"]
  end
```

### Shared gate

The caller runs the gate and handles the verdict. A `merge` verdict lets the caller proceed through its normal permission checks. The PreToolUse hook is the adapter for single-repo sessions; see [Install the hook](#install-the-hook). Use an explicit procedure call in environments where the hook probe cannot establish reliable coverage.

```mermaid
flowchart TD
  call["Any session wants to merge"] --> gate{"gate<br/>one tested program"}
  gate -->|"merge"| pass["Normal permission handling<br/>and classifier still apply"] --> done["Merge as the owner<br/>deploys fire as today"]
  gate -->|"hold"| hold["Runner: denied, left for the owner<br/>Interactive: ask the owner"]
  gate -->|"fix / update / wait / blocked"| deny["Runner: denied with the reason<br/>Interactive: ask recommended, not decided"]
  how["Who runs the gate<br/>single-repo session: PreToolUse hook<br/>multi-repo session and Codex: procedure call"] -.-> gate
```

### Workflow

The night runner, local review loop, and owner session share the gate. Keep one existing runner per queue. The caller reruns `evaluate` after review or owner confirmation and immediately before merging, then requires the merge to match the reviewed head SHA. Owner confirmation and strong review resolve holds in the owner-directed path. Unattended merges require a `merge` verdict. The operator schedules morning replay. Direct-push detection and GitHub control drift checks are planned.

```mermaid
flowchart TD
  q["Queue item<br/>enters only through an owner-merged PR"] --> r["Night runner<br/>claims, implements, runs its own critic"]
  r --> pr["PR"]
  pr --> ci["CI and native Codex review<br/>on GitHub"]
  ci --> g{"gate"}
  g -->|"fix: go back and fix"| r
  g -->|"merge"| m["Merged"]
  g -->|"hold: strong review"| s["Local strong-model review<br/>review loop started by the owner"]
  g -->|"hold: owner"| o["Owner<br/>cloud or local session"]
  r -->|"round cap, or 6 h without progress"| d["Parked<br/>one question and a recommended answer"]
  d --> o
  s -->|"Owner-directed merge after review and gate rerun"| m
  o -->|"Owner confirms and reruns the gate"| m
  m --> desk["Morning desk<br/>replays the gate the next day"]
  desk -.->|"anomalies and to-do lists"| o
```

**Pull request states in the target workflow.** These transitions describe actions taken by the caller and owner. The diagram omits `update:base` and `blocked:*`.

```mermaid
stateDiagram-v2
  state "Open" as Open
  state "Waiting" as Waiting
  state "Fixing" as Fixing
  state "Awaiting strong review" as Strong
  state "Awaiting owner" as Owner
  state "Merged" as Merged
  state "Closed" as Closed
  [*] --> Open
  Open --> Waiting: CI or Codex not finished
  Waiting --> Open: results arrive
  Open --> Fixing: fix - CI failed or Codex P0 or P1
  Fixing --> Open: runner pushes a fix
  Fixing --> Owner: round cap, or 6 h without progress
  Open --> Strong: hold - strong review
  Strong --> Merged: owner-directed merge after review and gate rerun
  Strong --> Strong: review worker pushes a fix, re-review
  Open --> Owner: hold - owner, FAILED prefix, or draft
  Owner --> Merged: owner confirms and reruns the gate
  Owner --> Closed: owner rejects
  Open --> Merged: merge - auto tier
  Merged --> [*]
  Closed --> [*]
```

### Repository layout

The target includes the hook and its bootstrap, and a planned shared runner procedure. The bootstrap fetches the pinned kit commit by SHA, checks the fetched commit against the pin and runs it; it does not check that the commit is reachable from the kit’s default branch, and the owner approves pin changes. Keep the consumer as the sole attached repository for a hook-based session and read the public kit at its owner-approved pin. The cloud probe showed that one pinned file can be read anonymously at its raw URL and that the pinned commit can be fetched through the cloud Git proxy, which is credentialed, so only the raw read is anonymous. The kit is not vendored. The public kit uses synthetic or public fixtures. Private consumer names, account and deployment settings, queue and report data, and secrets stay outside it. Existing GitHub controls stay in force. The current CLI reads the manifest and returns verdicts.

```mermaid
flowchart TD
  subgraph KIT["agent-pipeline-kit, public, one copy"]
    k["Gate library and tests<br/>hook script<br/>generic runner procedure<br/>queue and report formats, templates"]
  end
  subgraph REPO["Each consumer repository keeps only"]
    m1["manifest<br/>pins a kit commit"]
    m2["rules.md<br/>this repository's own rules"]
    m3["hook settings and bootstrap"]
    m4["queue and reports"]
  end
  subgraph RUN["When a scheduled task runs"]
    rd["Read the manifest"] --> ft["Fetch the kit at the pinned commit"] --> go["Follow the generic procedure plus rules.md"]
  end
  k -.->|"referenced by commit SHA"| m1
  m1 --> rd
  m2 --> go
  m3 -->|"runs the gate on a merge call"| go
  go -->|"writes"| m4
```

### Shared policy and cutover

The target policy combines an immutable kit floor with a consumer allowlist that defaults to a hold. Three readers share the kit floor and the consumer manifest: the PR evaluator, the `check-paths` command, and the runner hook. Today the runner hook gates only merge tool calls. Enforcing the floor patterns marked for write and push checks in the hook is the target and is not implemented yet.

Start by backtesting and running the gate in shadow mode. During overlay, require both the existing rules and the gate to allow an unattended merge. Switch only after every existing hold has equivalent coverage or an explicit, recorded retirement, the path check without a PR exists, and the branch used to read policy is settled. Then replace duplicated rules with a pointer to the shared policy. [Historical hook plan](https://github.com/yusaanthya/agent-pipeline-kit/blob/7d311aba10120e0ebd1026700e8e07e62b81f878/docs/implementation-plan.md#11-slice-4-the-hook-reads-the-same-policy) · [Historical open questions](https://github.com/yusaanthya/agent-pipeline-kit/blob/7d311aba10120e0ebd1026700e8e07e62b81f878/docs/open-questions.md)

## Run the gate

Use Node.js 22 or newer, Git, and an authenticated GitHub CLI (`gh`) with read access to the target repository. Use a trusted local clone of the target repository with `origin` pointing to that same repository and enough history to resolve the relevant commits. There are no npm dependencies to install.

Run from the kit checkout and replace the repository, PR number, clone path, and dates with your own values. These commands assume a configured queue lane targeting `preview`. For live evaluation, pick an open PR with a `claude/item-<id>` head. For replay, pick a merged PR.

```sh
node src/cli.js evaluate --repo OWNER/REPO --pr 123 --repo-dir /path/to/repo
node src/cli.js replay --repo OWNER/REPO --pr 122 --repo-dir /path/to/repo
node src/cli.js backtest --repo OWNER/REPO --repo-dir /path/to/repo --since 2026-11-01 --until 2026-11-08 --base preview
node src/cli.js check-paths --repo OWNER/REPO --repo-dir /path/to/repo --base main --head 0123456789abcdef0123456789abcdef01234567 --lane nightly
npm test
```

- `evaluate` checks a live PR. Pass `--lane` for a caller lane. A configured queue lane is inferred from a `claude/item-<id>` head branch.
- `replay` reconstructs a verdict for one merged PR. A caller lane is inferred from an exact `Auto-Merged-By:` line in the merge commit message that identifies one configured caller lane. Before cutover, configure every merging routine to stamp the lane of the PR it merges, including when another routine handles that lane.
- `backtest` runs replay for PRs merged from `--since` inclusive to `--until` exclusive. The optional `--base` filters by target branch. It emits one JSON line per PR and a final summary. `anomalies` lists marked merges with a verdict other than `merge`, and `unmarkedNotMerge` lists such verdicts on unmarked merges. PRs whose evidence collection failed appear in both lists because their marker is unknown.
- `check-paths` reports whether the change-set conditions of `evaluate` would hold a head commit that has no pull request, such as an unpushed commit in the clone, against a base branch fetched from `origin`. It checks nothing else, so the result is `clear` or a `hold:*` or `blocked:*` result, never `merge`. Without `--lane` the lane conditions are skipped. `--item ID` with a queue lane exempts that item's own report.

`evaluate` and `replay` emit a JSON object and exit `0` for `merge` or `1` for any other verdict. `check-paths` exits `0` for `clear` and `1` otherwise. `backtest` exits `0` after producing a summary even if it found anomalies, so inspect the JSON. It exits `1` if collecting the PR list fails. Invalid arguments exit `2`.

## Install the hook

The hook blocks an agent's GitHub merge tool call unless the gate says `merge` for that pull request. It runs before the call, allows non-merge tools untouched, and never asks: it exits `0` to allow or `2` to block, with one line on stderr naming the verdict and its first reason. The call must also match the verdict: `expectedHeadSha` equal to the verdict's head, `merge_method` `squash`, and a `commit_message` that contains the lane marker (`Auto-Merged-By: ...`) as an exact line. Any failure blocks, including a missing manifest or kit commit, a `gh` or `git` error, a gate crash and malformed tool input. The merge tool is matched by name, `mcp__<server>__merge_pull_request`. A pull request whose head is not a queue branch gets its caller lane from the manifest: the lane whose `title_prefix` the pull request title starts with. The call's `commit_message` must then contain that lane's marker as an exact line, and a message with another lane's marker or none holds with `lane-marker-mismatch`. No matching prefix holds with `no-lane`. A title that starts with `[FAILED]` or `[NEEDS-DECISION]` matches no plain prefix, and a title that merely contains either still holds. Only the hook selects a lane this way; `evaluate`, `replay`, `backtest` and `check-paths` do not.


1. Copy [`examples/hook-bootstrap.mjs`](examples/hook-bootstrap.mjs) to `.claude/hooks/` in the consumer repository.
2. Merge [`examples/settings.json`](examples/settings.json) into the repository's `.claude/settings.json` and replace the kit URL. Keep `"onFailure": "block"` on every gate hook entry: without it a failing hook does not stop the call. The `permissions.deny` list closes the tools that skip the merge call: auto-merge, direct file writes and `gh pr merge`.
3. Pin the kit commit in `.agent-line/manifest.json` on the default branch. The bootstrap fetches that default branch from `origin`, fetches the pinned commit from the kit URL into a temporary directory, checks that the checkout is that commit and runs its `hook` command. It does not check that the commit is reachable from the kit's default branch.

Preconditions in the environment that runs the hook: Node.js 22 or newer on `PATH`; `gh` authenticated with read access to the repository; a clone of the consumer repository with `origin` set and enough history to find the merge base; and network access to the kit's Git URL. This is a guardrail against honest mistakes, not a security barrier, as described under the Phase 0 probe below.

## Configure policy

Copy the example manifest and set `kit` to the kit checkout’s 40-character commit SHA. Replace `check` with the exact GitHub Actions check-run name and adapt the base branch, freeze rule, and paths to your repository. Commit it as `.agent-line/manifest.json` on the target repository’s default branch. The gate reads that file from the fetched default branch even when the PR targets another branch. [Example manifest](examples/manifest.json)

The CLI validates the `kit` field’s format. Pin the kit checkout separately for reproducible runs. `checks: "none"` requires an owner decision. `codex_clean: "no_findings"` requires a review with no findings, while `"no_blocking"` allows advisory findings. Built-in holds cover changes such as GitHub workflow files, agent configuration, and dependency manifests. Path rules match case-insensitively. `*` matches within one path segment and a `**` segment matches zero or more segments. Extra path and content holds are configurable. `hold_on_line_change` uses literal text with optional anchors at the start (`^`) and end (`$`). `sections_only` takes entries of `{"glob": "docs/backlog.md", "sections": ["## Ready"]}`: in a matching file only the bodies of the listed sections may change, where a heading is any line that starts with `## `, even inside a code fence. Everything else must stay byte-identical, so an added, removed, renamed, duplicated or reordered heading line, or a changed final newline, holds, as does an added or deleted file, a carriage return, or an unreadable file. [Manifest validation](src/core/manifest.js) · [Content rules](src/core/content.js)

A queue lane reads `.agent-line/queue/<id>.md` from the evaluated base commit. A missing item, unreadable front matter, or `merge: owner` in the item holds the PR for the owner. For a workflow without queue branches, configure a lane with `"kind": "caller"` and pass its name with `--lane` when running `evaluate`. A caller lane may also declare `"title_prefix": "<string>"` (non-empty, one line, case-sensitive) for the hook to select it. No prefix may be a prefix of another lane's prefix, so at most one lane matches a title. The title is agent-writable, so it may only choose among the consumer's own caller lanes. It widens nothing, because the chosen lane's allowlist, line budget and every other condition still apply. Keep the allowlists of caller lanes disjoint, so that choosing the wrong lane cannot reach a path the right lane would not.

All four commands accept `--manifest FILE`, which takes precedence over the policy in Git. Treat the file as trusted policy and keep it under operator control, outside the PR checkout. In `replay`, pass a separately verified copy of the policy in effect at merge time when available. In `backtest`, the same supplied file applies to every PR, so use it to evaluate a proposed policy or a window with one verified policy version. By default, replay selects a manifest from the current default branch’s first-parent history using commit timestamps as an approximation.

## Interpret results and adopt the gate

A live `merge` verdict includes the expected head SHA and the suggested squash commit message. If you integrate it into a runner, evaluate immediately before merging and require the merge operation to match that head SHA. Handle `hold:*` as an escalation, `wait:*` as pending, `fix:*` as failed checks or review, `update:base` as a stale base, and `blocked:*` as a stop. Use `reasons` for the details. Start with manual evaluation and backtests to see how the policy behaves on your repository.

The CLI queries GitHub and fetches Git objects into temporary local refs. The fetch writes to the clone’s object store. The CLI leaves the worktree untouched, reads PR contents as Git objects, and performs no GitHub writes. Merge execution, scheduling, hooks, and enforcement belong to the caller or repository configuration. Anyone with sufficient repository permissions can bypass the gate or change its inputs. A merge marker is a convention for auditing and lane selection. GitHub permissions and branch controls govern enforcement.

The Phase 0 probe ran in a cloud scheduled task on 2026-11-22 (Claude Code 2.1.330, one attached repository, limited network). Repository hooks fired for shell and GitHub tool calls. Exit code 2, a JSON deny, and a failing hook with `onFailure: "block"` each blocked the call; a failing hook without it did not. Variables of the cloud environment reached the hook. The session applied the hook settings of the branch checked out at the time, so a branch that predates the hook runs without it, and an agent that can write files can replace a hook. Treat the hook as a guardrail against honest mistakes, and use GitHub branch rules where a barrier is needed: the platform does not restrict which branch a task pushes to. A hook `ask` left the run waiting on a permission prompt until a person answered, so an unattended caller holds for the owner instead of asking. Anonymous reading of one pinned kit file at its raw URL worked. Fetching the pinned commit with `git fetch` also worked, but through the credentialed cloud Git proxy, so it is not anonymous. The archive address was refused. The merge and update-branch tools accept an expected head SHA; auto-merge and direct file writes do not, so deny those tools in the settings file. [Probe kit as run](https://github.com/yusaanthya/agent-pipeline-kit/tree/8d5e8f5936cbda8132209f015935b51285514685/probes/phase0)

Historical results are best-effort. Replay needs the PR head and a reachable merge commit and uses the merge commit’s first parent as the historical base. For a multi-commit PR merged by rebase, that parent can be an intermediate rebased commit. Replay can evaluate against that base without flagging the limitation in `limits`. Historical halt labels, freeze PR retargeting, and later review edits can also affect reconstruction. Inspect `limits` alongside each verdict. Backtest enumerates merged PRs, so use a separate audit if you also need to detect direct branch pushes.

## Threat model

State at this commit. The gate is a guardrail against honest agent mistakes: an agent that merges something it should not, edits a file it should not, or misreads a condition. It is not a barrier against a determined attacker, or an agent, with write access to the repository. Use GitHub branch rules where a barrier is needed. Compromise of the GitHub account, GitHub or the machine that runs the gate is out of scope.

**Inputs and their trust.**

- The manifest is read from the fetched default branch (or from `--manifest`, which the operator controls), never from the pull request. Whoever can change the default branch can change the policy.
- GitHub data (pull request state, check runs, comments, reviews, labels) is read through `gh` and git objects. Check runs count only from the GitHub Actions app. Codex review counts only from the trusted bot, bound to the exact head SHA.
- The title, body, commit messages and review comments are agent-writable. The gate reads the title only for the owner markers `[FAILED]` and `[NEEDS-DECISION]` and, in the hook, to select a caller lane by `title_prefix`. It reads the commit message only for the marker line. Agent-writable text is never executed or used to widen a decision.

**Floor.** Paths such as workflow files, agent configuration, dependency manifests, git hooks and the pipeline's own files always hold for the owner, whatever the manifest says. The manifest adds holds and allowlists; it cannot remove a floor path. Symlinks, submodules, executables, type changes and binary files hold.

**Content rules.** `hold_on_add_delete`, `hold_on_line_change`, `keys_only`, `front_matter_only` and `sections_only` only add holds. An unreadable or oversized file holds. For `sections_only`, a heading is a line that starts with `## `, so changes outside the listed sections hold.

**`check-paths`.** It evaluates the change-set conditions for a commit with no pull request, so a runner can check its own commit before pushing. It never returns `merge`.

**PreToolUse hook.** It blocks a merge tool call unless the gate says `merge` and the call matches the verdict (head SHA, method, marker line). It fails closed: with `"onFailure": "block"` on every gate hook entry, a crash or a missing kit also blocks. The hook does not read environment variables to decide; it applies wherever the settings that register it are loaded, and the Phase 0 probe showed the settings of the checked-out branch apply. A merge made through `gh api`, another HTTP client or a tool the matcher does not name does not pass the hook, so the settings deny list closes auto-merge, file writes and `gh pr merge`, and `gh api` merges stay uncovered. An agent that can write files can change the hook settings.

**Caller-lane selection by title prefix.** The hook picks the caller lane from the title and requires that lane's marker in the merge call. An agent can change the title, so the title only selects among the consumer's own lanes. Each lane's allowlist and conditions still apply to the diff, and consumers keep caller-lane allowlists disjoint.

**Accepted residuals.** None is closed by the kit.

- A merge or push that does not pass the hook, including `gh api`, and a changed hook or manifest by someone who can write to the repository.
- One-call changes to gate inputs: un-drafting, removing a title marker, closing a halt issue, editing or deleting a Codex comment. The gate treats them as agent-writable inputs that can only remove a stop the owner set.
- The gate checks the diff at merge time. It does not protect against code that runs before the merge, such as a workflow a pull request changes and runs.
- Recorded from a 2026-11-24 review of 7d311ab..f4bbf2a and not fixed, because the inputs have not been seen in a real run:
  - R1: in a listed `sections_only` body, a line that looks like a heading but does not start with `## ` (a leading space, a tab, a setext underline, `#` or `###`, or text after U+2028) passes. A reader may take what follows as owner text.
  - R2: an unclosed code fence or `<!--` in a listed body passes and can make the following owner sections render wrongly on GitHub.
  - R3: a `## ` line inside a code fence counts as a heading. An owner section that holds a fence with `## Ready Nightly` makes the following owner text editable by triage.

## License

[MIT](LICENSE)
