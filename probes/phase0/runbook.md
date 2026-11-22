# Phase 0 runbook: eight hook-gate behaviours in a cloud scheduled task

Written before the run of 2026-11-22; the outcome is summarised in the repository README. Local checks that were run beforehand are listed at the end of section 6.

## 1. How the test works

- A private throwaway repo (`repo/`) carries repo-local hooks in `.claude/settings.json`.
  Hooks only record evidence and answer probes. They need no secret.
- Task A (items 1, 2, 3, 5, 6, 7, 8) and Task B (item 4 only) are two separate one-off
  scheduled tasks, so a hang in item 4 cannot cost evidence for the other items.
- Hook evidence is appended to `/tmp/phase0/hook-log.jsonl` inside the container, which
  disappears with the container. The task copies it into a results branch
  `claude/phase0-results-<RUN_ID>-A` (Task B: `-B`) and pushes it. The task also prints its
  notes in its final message. Both are read from the run's session page (section 3).
- Task B pushes its pre-ask evidence BEFORE the ask probe. If the ask probe hangs, the hang
  itself is the evidence (a permission prompt waiting in the run's session) and nothing else
  is lost.
- The only merge attempted is of a test PR inside the test repo, on a hook that is expected
  to deny it. The PR targets a throwaway base branch (`phase0/pr-base`), not `main`, so if the hook
  does not fire the worst case is a one-line change merged into that throwaway branch and nothing
  reaches `main` or `preview/main`.
- Known confounder, built into the design: scheduled tasks start in auto mode, whose
  classifier by default blocks "merging a pull request no human has approved". A blocked merge
  therefore does not prove the hook worked. The hook's deny text `PHASE0_HOOK_BLOCK` and the
  `decide` log line are the proof; a classifier block shows a `PermissionDenied` record and no
  `decide` line.

## 2. Owner steps

### 2.1 Create the repo (local machine, `gh` logged in)

```bash
cd <path-to>/phase0/repo
git init -b main && git add -A && git commit -m "chore: phase0 test repo"
gh repo create <TEST_REPO_NAME> --private --source . --push

# preview/main differs from main only in the hook tag (MAIN -> PREVIEW)
git checkout -b preview/main
cp preview-main.settings.json .claude/settings.json
git commit -am "chore: preview settings tag" && git push -u origin preview/main

# test PR: phase0/test-change -> phase0/pr-base (a throwaway base, never main)
git checkout main && git checkout -b phase0/pr-base && git push -u origin phase0/pr-base
git checkout -b phase0/test-change
echo "line: head" >> seed/change.txt
git commit -am "chore: test change" && git push -u origin phase0/test-change
gh pr create --base phase0/pr-base --head phase0/test-change --title "phase0 test PR" --body "throwaway"
git checkout main
```

Leave `main` as the default branch. No branch protection and no GitHub Actions are needed.
The Claude GitHub connection of your account must be able to clone this private repo
(GitHub App installed on it, or `/web-setup`; see
https://code.claude.com/docs/en/claude-code-on-the-web.md#github-authentication-options).
Hooks run through `bash <script>`, so the exec bit does not matter.

Compute the kit file hash locally for Task A (item 5):
`git -C <kit-checkout> show <KIT_SHA>:<KIT_FILE> | sha256sum`.

### 2.2 Create the cloud environment

At https://claude.ai/code (environment selector) or in the task editor, add an environment
named `phase0-test`:

- Network access: the level the real gate task will use. Default expectation: **Limited**
  with **Allow package managers** checked (the default allowlist contains `github.com`,
  `raw.githubusercontent.com`, `codeload.github.com`). Do not add any domain; item 5 is only
  meaningful under the production policy.
- Environment variables: one line, `GATE_TEST_LANE=phase0-lane-<six random chars>`. Non-secret.
  Set it BEFORE the task starts (a session reads the values when it is created).
- Setup script: none.
- No network secrets.

### 2.3 Create the tasks

At https://claude.ai/code/routines: New task, once for A, once for B.

- Create the task outside any project. Cloud threads in a project do not load a repository's
  `.claude/settings.json` hooks (https://code.claude.com/docs/en/settings.md#settings-in-cloud-sessions),
  so a project-owned task would show "no hooks" for the wrong reason.
- Name: `phase0-A` / `phase0-B`.
- Prompt: the TASK A / TASK B block from `task-prompt.md` with the placeholders filled.
- Repository: only the test repo (a second repository switches the session to multi-repo, which does not load repo hooks). Environment: `phase0-test`. Model: the one the real gate
  task will use. Connectors: remove all.
- Trigger: Schedule, a one-time run about 10 minutes ahead (this mirrors production; "Run now"
  is an acceptable substitute, see assumption 14).
- Run A first. Start B only after A finished (or after you have read A's result).

### 2.4 Read the result

1. Task detail page, History, open the run. The final message has per-item observations and the full notes.
   For Task B also look at the top of the session: is a permission prompt waiting?
2. The results branch:
   ```bash
   git fetch origin && git checkout claude/phase0-results-<RUN_ID>-A
   cd results/<RUN_ID>-A
   jq -c '{ts,kind,event,tool,tag,branch,settings_sha,decision,permission_mode}' hook-log.jsonl
   ```
   Useful filters:
   ```bash
   jq -c 'select(.kind=="record") | .env' hook-log.jsonl | sort -u              # item 3
   jq -c 'select(.claude_version!=null) | .claude_version' hook-log.jsonl        # item 2 version
   jq -c 'select(.kind=="decide")' hook-log.jsonl                                # item 2, 4, 7
   jq -c 'select(.tool!=null and (.tool|test("^mcp__"))) | {event,tool,mcp_server,tool_input}' hook-log.jsonl   # items 7, 8
   jq -c 'select(.event=="PreToolUse") | {ts,tag,branch,settings_sha,tool}' hook-log.jsonl   # item 6
   ```
3. Task B: if the run is waiting on a permission prompt after 15 minutes, note the time, then click
   Deny (or archive the session). Do not Approve.

### 2.5 Cleanup

- Delete both tasks (one-off tasks switch themselves off, but delete them anyway).
- Delete the `phase0-test` environment.
- Delete the test repo (`gh repo delete <owner>/<name> --yes`, needs `delete_repo` scope, or in GitHub settings).
- Nothing secret was used. `GATE_TEST_LANE` is non-secret. No token or credential was added anywhere.

## 3. Evidence key

`PHASE0_HOOK_BLOCK` appears in a tool result only if one of our hooks denied the call.
Log lines: `kind:"record"` (what the hook saw) and `kind:"decide"` (what our hook answered; written before it answers).
`tag` is `MAIN` or `PREVIEW`: which settings file registered the hook.

## 4. The eight items: confirmed / false / inconclusive

Task A produces rows 1-3 and 5-8; Task B produces row 4.

| # | Confirmed means | False means | Inconclusive if |
|---|---|---|---|
| 1 Repo-local hook fires | Hook log has a `record` line `event:"PreToolUse"`, `tool:"Bash"`, `env.CLAUDE_CODE_REMOTE:"true"`, and a `SessionStart` line. Equivalent: a step-3a/3b result contains `PHASE0_HOOK_BLOCK`. Sub-result 1b (MCP tools): a `record` PreToolUse line exists for the GitHub read call of step 2. | `hook-log.jsonl` has no line at all, the files `PHASE0_PROBE_EXIT2.executed` and `PHASE0_PROBE_DENYJSON.executed` exist (commands that should have been blocked ran), and the version in step 1 is 2.1.295 or later (so `onFailure` is a known key and a rejected settings entry is not the likely cause). | The log is missing and the version is below 2.1.295 or unknown (an unknown `onFailure` key may have caused the entry or file to be rejected: re-run with the strict hook removed to separate item 1 from item 2); the results push failed and the final message lacks the log; the run was in a project thread or a multi-repo session; an organization-managed policy restricts or disables repository hooks (check server-managed settings; not verified in the docs I read). |
| 2 Fail-closed hooks | All of: version in the log is 2.1.295 or later; 3a blocked (result has `PHASE0_HOOK_BLOCK exit-2 probe`, no `...EXIT2.executed` file); 3c blocked (result says `blocking because onFailure is "block"`, no `...CRASH_BLOCK.executed` file); 3d control ran (`...CRASH_OPEN.executed` exists, i.e. a plain crash fails open, as documented). 3b (JSON deny) also blocked. | 3a executed: exit code 2 does not block. Or 3c executed while the version is 2.1.295 or later: `onFailure` not honored. If only 3c executed and the version is lower, report "exit 2 blocks, crash does not; the gate script must trap its own errors and exit 2". | No hook ran (item 1 not confirmed); version unknown (no `claude --version`, no transcript version); 3a was blocked by the auto-mode classifier instead (a `PermissionDenied` record and no `decide` line for 3a); results show a hook error without the expected text. |
| 3 Env vars reach the hook | `record` lines show `env.GATE_TEST_LANE` `{"set":true,"value":"<your value>"}` and step 1 shows the same value. | Step 1 (Bash tool) shows the value while the hook `record` lines show `"set":false`. | Both show unset (variable not delivered to the session: wrong environment selected, edited after session creation, typo); no hook log. |
| 4 Hook answers ask | Task B gives exactly one of three outcomes, each a confirmation. **Denied**: step 3 returns control with an error result, `...ASK.executed` absent, log has `decide` `ask`, run completes without any person. Compare the `decide ask` timestamp in `hook-log-after-ask.jsonl` with the step-4 `date -u`: seconds apart is an immediate denial; a gap of minutes means the prompt waited and then timed out into a denial (record the gap; treat it as "waits N minutes, then denies"). **Hangs**: no step-4 output; the run is still running with a permission prompt visible in the session 15 minutes after the `ABOUT TO RUN ASK PROBE` line; the branch `-B` holds only `hook-log-before-ask.jsonl`. **Allowed silently**: `...ASK.executed` exists and no error. | There is no false for an observation; the fallback "ask only when explicitly marked interactive" is needed when the outcome is Hangs or Allowed silently, and not needed when Denied. | `decide ask` never logged (ask not enabled, hook not firing); the classifier denied the touch independent of the hook (`PermissionDenied` record, no `decide ask`); you looked before 15 minutes; the session expired during the wait without a prompt visible (record the expiry text). |
| 5 Anonymous kit fetch | Per path (5a raw, 5b git, 5c codeload): the kit fetch returns the expected content (5a `http=200` and sha256 equal to `<KIT_FILE_SHA256>`; 5b `FETCH_HEAD` equals `<KIT_SHA>` and the hash matches; 5c `http=200`). The controls are not needed for a confirmation. Report each path separately. | Per path: the kit fetch AND the second unattached public repo (5e, same path) are both refused by the proxy (`403`, text starting `GitHub access to` ... `is not enabled for this session`, `host not allowed`, `ENOTFOUND`) while the npm control 5d returns `http=200`. That path is false for unattached repos; fallback is to copy the kit into each repo. | Only when the npm control 5d fails (the network or proxy is broken as a whole, so nothing about GitHub follows). Also inconclusive: the kit path is refused but the second unattached repo succeeds on that path (the failure is specific to the kit: wrong repo name, private repo, bad SHA; verify the same URL from your own machine); `404` for the kit paths; hash mismatch from a wrong placeholder. |
| 6 Branch settings | Judge only on the `PreToolUse` records of 6c (`echo BRANCH_CHECK_ON_PREVIEW`) and 6d (the GitHub read). Confirmed when both carry `branch:"preview/main"`, `tag:"PREVIEW"` and the preview `settings_sha`; and the 6f record is `MAIN` again. Answer to "which is in effect": the file of the currently checked-out branch. (6b ends with `sleep 3` so the settings watcher has time before 6c.) | After 6b, the 6c and 6d records carry `branch:"preview/main"` and the preview `settings_sha` but `tag:"MAIN"`: settings were fixed at session start from the default branch and are not reloaded. "Merged sets" means a MAIN record and a PREVIEW record for the same `tool_use_id` (both sets ran). 6c MAIN but 6d PREVIEW: reloaded with a delay; report the delay. | 6a/6b failed (branch not fetchable); no hook records for 6c/6d (item 1 not confirmed). This item does not cover a session that STARTS on a non-default branch (optional variant in assumption 5). |
| 7 GitHub tool names | The `record` lines for steps 2 and 4 list the exact `tool` names and `mcp_server` object; the names in the step-0a notes match them. State the prefix. Also compare: `decide` lines show which matcher fired (`merge-exact` = fixed-prefix name `mcp__github__merge_pull_request`; `merge-loose` = `[Mm]erge`). | The real names differ from `mcp__github__merge_pull_request`: `merge-loose` fired and `merge-exact` did not (or neither). Then the fixed-prefix matcher is wrong and the loose matcher is needed. No GitHub tools at all: the notes say so and step 2 has no MCP record. | Names only self-reported and never called; tools deferred and the agent did not enumerate them; the merge call was blocked by the classifier before any hook (no `record` line for it). |
| 8 Merge paths carry head SHA | Step-0b table is a verbatim copy of parameter names per tool, AND the step-4 `record` line's `tool_input` contains the expected-head parameter (proves the tool accepts it and the hook sees it). Item is true only if every merge or land-capable path lists a parameter; report per path. | Any path with "no" (for example an auto-merge tool, a push-files tool, a plain `git push`): the fallback is to refuse that path in the gate. | Step 0b written from memory rather than copied from schemas; schemas deferred and not loaded; step-4 `tool_input` lacks the parameter although the notes say "yes" (disagreement: trust the logged call). |

Hint from this authoring session, not scheduled-task evidence: its own GitHub merge tool has an
`expectedHeadSha` parameter, its auto-merge tool has no such parameter, and it also has tools that write
files or push commits to a branch.

## 5. Documentation relied on (fetched 2026-11-22)

All pages were read through a summarising fetch tool, not as raw text, so verify any quote you plan to depend on.

- Hook events, `PreToolUse` input (`tool_name`, `tool_input`, `tool_use_id`, `mcp_server` for MCP tools),
  `permissionDecision` values `allow/deny/ask/defer`, deny > defer > ask > allow precedence, decision
  JSON inside `hookSpecificOutput`: https://code.claude.com/docs/en/hooks (section PreToolUse).
- Exit 2 blocks the tool call; other non-zero exit codes (including 1) are non-blocking and the call goes ahead;
  a PreToolUse timeout does not block; `onFailure: "block"` makes failures block, requires Claude Code v2.1.295
  or later: https://code.claude.com/docs/en/hooks (sections "Exit code 2 behavior per event", "Block the action when a hook fails").
- Matcher syntax: only letters, digits, `_`, `-`, space, `,`, `|` means exact string or list; anything else is an
  unanchored JavaScript regex; MCP names are `mcp__<server>__<tool>`, plugin servers `mcp__plugin_<plugin>_<server>__<tool>`:
  https://code.claude.com/docs/en/hooks (section "Match MCP tools"), https://code.claude.com/docs/en/hooks-guide.md.
- `CLAUDE_CODE_REMOTE` is `"true"` in remote web environments; `CLAUDE_PROJECT_DIR`: https://code.claude.com/docs/en/hooks.
- Repo `.claude/settings.json` hooks load in a cloud session with one repository; not in project threads or multi-repo
  sessions; `~/.claude` and `settings.local.json` are not read:
  https://code.claude.com/docs/en/cloud-environments.md#what-carries-over-from-your-setup and
  https://code.claude.com/docs/en/settings.md#settings-in-cloud-sessions.
- Settings files are watched and hook edits are picked up without restart (stated for Claude Code generally):
  https://code.claude.com/docs/en/settings.md#when-edits-take-effect.
- Scheduled tasks are full cloud sessions, start in auto mode, still stop and wait for a prompt for ask-rule actions,
  start from the default branch unless the prompt says otherwise, push to `claude/` branches by default, and the saved
  prompt is not live user approval: https://code.claude.com/docs/en/routines.md (sections "Permission prompts during a run",
  "Repositories and branch permissions", "Create from the web" step 2).
- Auto mode: ask rules and hook-forced prompts still show a prompt; the default block list includes merging a PR no
  human approved: https://code.claude.com/docs/en/permission-modes.md. For scheduled tasks, the routines page says an
  action that prompts even in auto mode, or repeated classifier blocks (3 in a row or 20 in total), make a permission
  prompt appear in the run's session and wait until someone answers it:
  https://code.claude.com/docs/en/routines.md#permission-prompts-during-a-run. The permission-modes statement that a
  headless `-p` run with no prompt channel drops the action applies to `-p` runs; whether it applies to scheduled
  tasks is not documented (assumption 3).
- Environment variables are visible to anyone using the environment, are read when a session is created, and are ordinary
  variables to commands Claude runs; setup scripts run before they are set: https://code.claude.com/docs/en/cloud-environments.md#set-environment-variables.
- Default allowlist includes `github.com`, `api.github.com`, `raw.githubusercontent.com`, `codeload.github.com`; GitHub goes
  through a proxy that serves only attached repositories (a `codeload.github.com` or `/archive/` fetch of an unattached
  repo returns 403, even if public), rejects GraphQL, and `raw.githubusercontent.com` is handled by the security proxy:
  https://code.claude.com/docs/en/cloud-environments.md#default-allowed-domains and `#github-proxy`.
- Built-in GitHub tools exist in cloud sessions (names not given): https://code.claude.com/docs/en/cloud-environments.md#work-with-github-issues-and-pull-requests.

## 6. Not verified / assumptions (docs silent; I guessed)

1. Order between auto-mode classifier and PreToolUse hooks is not documented. The design therefore treats a missing `decide`
   line plus a `PermissionDenied` record as "classifier acted first".
2. Whether hook subprocesses inherit the cloud environment's variables is not stated (only that "any command Claude runs"
   can read them). Item 3 exists to settle this.
3. What a hook `ask` does in a scheduled task is not stated. The routines page says a run stops and waits for a prompt; the permission-modes page
   says a headless `-p` run with no prompt channel denies. Whether a scheduled task counts as such a run is unknown. The 15-minute wait is my choice, not a documented limit.
4. How to learn the Claude Code version of the session: `claude --version` on PATH, else a `"version"` field in the
   session transcript JSONL (from memory, not in docs). `claude doctor` non-interactive use and its output are untested.
5. Whether a mid-session `git checkout` that swaps `.claude/settings.json` is reloaded in a cloud session is not documented
   (the reload statement covers settings generally). The test also does not cover a session that starts on a non-default
   branch. Optional variant: re-run Task A after temporarily changing the test repo's default branch to `preview/main`
   (`gh repo edit --default-branch preview/main`); expect tag `PREVIEW` from the start. Not required for the eight items.
6. Whether an unknown key (`onFailure`) on an older version is ignored or causes the entry or whole file to be rejected is
   not documented. The version in step 1 is the split: 2.1.295 or later means `onFailure` is a known key; below that (or unknown) an empty log is inconclusive, and the strict hook should be removed and the task re-run. `claude doctor` output is extra information only.
7. The scheduled task may or may not clone all branches; step 6a fetches `preview/main` explicitly, assuming the GitHub proxy allows it.
8. For unattached public repos the docs state the 403 only for archive/codeload and the API; plain `git fetch` of a public
   repo and `raw.githubusercontent.com` are assumed to work. `git fetch <sha>` of a full SHA depends on GitHub allowing it
   (from memory). Because git goes through the credentialed proxy, only the raw path is strictly anonymous.
9. Names of GitHub tools in a scheduled task are not documented; the session might use a different connector-style prefix.
10. That REST merge accepts a `sha` field and GraphQL a head-OID guard is from memory, not docs. The prompt asks the agent only for schema facts, and does not run these paths.
11. The agent's step-0 tool-list self-report can be wrong; the log is the ground truth for tools actually called. Tools never called are not proven.
12. `PermissionRequest` and `PermissionDenied` hooks are used only as recorders (no output, exit 0); I assume that is "no decision" and does not change behavior.
13. `/tmp/phase0` is assumed writable and unchanged through the run; a VM idle-pause and restore keeps files per the docs, a reclaimed VM would lose them (then the push in step 8 matters).
14. "Run now" and a one-time schedule are assumed to start identical sessions. If results differ from production, repeat with the real trigger type.
15. The fired prompt cannot count as approval for the merge (docs). It does not matter here because the merge is expected to be denied; the real gate must not rely on the prompt to authorize.
16. The seed PR and the merge deny assume the test repo allows the PR's merge method; irrelevant if blocked.
17. An organization's server-managed settings could restrict repository hooks in cloud sessions; I did not find a statement in the pages read either way.
18. `https://registry.npmjs.org/` is assumed to be on the default allowlist (package managers) and to return `200` at its root; it is only a reachability control.

Local checks run (outside any cloud session):

- `bash -n` on `record.sh` and `decide.sh`: both pass. `shellcheck` is not installed here.
- `jq -e .` on `settings.json` and `preview-main.settings.json`: both valid JSON.
- Dry runs with sample stdin JSON: `decide.sh plain` for the EXIT2 probe exits 2 with the block text; DENYJSON prints valid deny
  JSON and exits 0; CRASH_OPEN exits 1; `decide.sh strict` exits 1 only for CRASH_BLOCK; ASK prints an `ask` decision only after
  `ask-enabled` exists; a command that merely mentions a probe name (`git commit -m ...`) is ignored; `decide.sh merge` prints
  a deny JSON naming the tool; with `jq` removed from PATH, `merge` mode exits 2 (fail closed) and `plain` exits 0.
- `record.sh`: appends valid single-line JSON, records branch, short head, settings hash, env presence and value of `GATE_TEST_LANE`
  only, `CLAUDE_CODE_REMOTE`, version once; malformed stdin yields a fallback line; exit code always 0 and stdout empty. Checked
  in a temporary git repo on a `preview/main` branch.
- Not run: the hooks inside Claude Code itself, the scheduled tasks, anything on GitHub.
