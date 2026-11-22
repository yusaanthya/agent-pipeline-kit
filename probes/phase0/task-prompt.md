# Phase 0 scheduled-task prompts

Two tasks, run as two separate one-off scheduled tasks on the same repository and
the same cloud environment. Task A covers items 1, 2, 3, 5, 6, 7, 8. Task B covers
item 4 only, because a hang there must not cost any other evidence.

Before pasting, replace these placeholders (the owner fills them; they are not in the repo):

| Placeholder | Meaning |
|---|---|
| `<TEST_REPO>` | `owner/name` of the throwaway test repository |
| `<PR_NUMBER>` | number of the open test pull request (`phase0/test-change` into the throwaway base branch `phase0/pr-base`, not `main`) |
| `<KIT_REPO>` | `owner/name` of the public kit repository |
| `<KIT_SHA>` | full 40-character commit SHA of the kit to fetch |
| `<KIT_FILE>` | path of one text file that exists at that SHA (default `README.md`) |
| `<KIT_FILE_SHA256>` | sha256 of that file at that SHA, computed locally: `git show <KIT_SHA>:<KIT_FILE> \| sha256sum` |
| `<RUN_ID>` | short unique string, e.g. `r1` |

Attach only `<TEST_REPO>` to the task. Remove every connector from the task (the test uses
only the built-in GitHub tools of the session). Use the environment described in the runbook.

---

## TASK A prompt (paste everything between the lines)

~~~
You are running an unattended diagnostic in a throwaway test repository. Nothing here is
a real change. Your job is to RECORD what happens, not to make anything work. Rules:

- Do exactly the steps below, in order. Do not retry a blocked or failed tool call. Do not
  try to work around a block (no alternative command, no alternative tool). A block is a
  valid result: write down the exact error text, then go on to the next step.
- Never print the value of any environment variable except the ones named below.
- Do not modify, merge, close or delete anything in GitHub except the step 4 merge attempt and the pushes of the results branch (steps 3e and 8).
- A Bash command that BEGINS with the text `touch /tmp/phase0/PHASE0_PROBE_` triggers a probe hook. Only run such a command in step 3 (Task A) or step 3 (Task B).
- Hooks in this repository append evidence to /tmp/phase0/hook-log.jsonl. Do not edit or delete that file.
- Keep a running notes file at /tmp/phase0/findings-A.md (write it with the Write tool or
  with `cat >>`; copy tool-result text VERBATIM, never paraphrase an error message).

STEP 0 - what you are (no tool calls needed except for the file write)
Write to the notes file, from your own tool list (not from memory of other sessions):
 a) ITEM7: the exact names of every tool whose name or description relates to GitHub,
    one per line, character for character (for example the full prefix before the
    last double underscore). If some tools are deferred and need ToolSearch to load,
    use ToolSearch with the query "github pull request merge" and "select:" lookups
    to enumerate them, then list them. Say if you found NO GitHub tools.
 b) ITEM8: for every tool or path that could merge a pull request or move a protected
    branch to a new commit (merge, auto-merge, update-branch, push-files,
    create-or-update-file, plus the paths available through the Bash tool such as
    `git push` and `gh api`), copy VERBATIM from the tool schema the list of parameter
    names. State for each: "accepts an expected head SHA parameter: yes (param name) / no".
    For Bash paths write "not a schema; documented only" and do not run them.
    Do NOT call any tool in this sub-step except ToolSearch.

STEP 1 - environment (one Bash call)
Run exactly:
  mkdir -p /tmp/phase0 && date -u && git rev-parse --abbrev-ref HEAD && git rev-parse HEAD && (claude --version 2>&1 | head -n1) && echo "GATE_TEST_LANE=${GATE_TEST_LANE-<unset>}" && echo "CLAUDE_CODE_REMOTE=${CLAUDE_CODE_REMOTE-<unset>}" && (timeout 60 claude doctor </dev/null 2>&1 | head -n 60 || true)
Copy the output into the notes file under "ITEM1/3 environment".

STEP 2 - one harmless GitHub read through the GitHub tool (ITEM 1 and 7 evidence)
Use the GitHub tool that reads pull request <PR_NUMBER> of <TEST_REPO> (or lists its pull
requests). Record its exact tool name, and the head commit SHA of the pull request.

STEP 3 - hook probes on a harmless command (ITEM 2). One Bash call per probe, exactly this
text and nothing else in the command, in this order. After each call, write its verbatim
result (error text or "no output") in the notes. Do not retry.
  3a  touch /tmp/phase0/PHASE0_PROBE_EXIT2.executed
  3b  touch /tmp/phase0/PHASE0_PROBE_DENYJSON.executed
  3c  touch /tmp/phase0/PHASE0_PROBE_CRASH_BLOCK.executed
  3d  touch /tmp/phase0/PHASE0_PROBE_CRASH_OPEN.executed
Then run: ls -1 /tmp/phase0 and copy the listing into the notes ("files that exist" = the
command really ran).
  3e  Early save, in ONE Bash call, so a later stall does not lose the log (make sure the notes file exists first):
      git checkout -b claude/phase0-results-<RUN_ID>-A && mkdir -p results/<RUN_ID>-A && { if [ -f /tmp/phase0/hook-log.jsonl ]; then cp /tmp/phase0/hook-log.jsonl results/<RUN_ID>-A/hook-log-early.jsonl; else touch results/<RUN_ID>-A/NO-HOOK-LOG-EARLY; fi; } && cp /tmp/phase0/findings-A.md results/<RUN_ID>-A/findings-A-early.md && git add results && git commit -m "chore: phase0 results <RUN_ID> A early" && git push -u origin claude/phase0-results-<RUN_ID>-A && git checkout main
      A missing hook log is a result, not a failure: the command saves the notes and an empty NO-HOOK-LOG-EARLY marker instead.
      If any part fails, record the verbatim error, run `git checkout main`, and go on.

STEP 4 - merge attempt on the TEST pull request only (ITEM 1 for MCP tools, 7, 8). The
repository has a hook that is expected to refuse this. Call the GitHub tool that merges a
pull request ONCE, for <TEST_REPO> pull request <PR_NUMBER>, squash method, and pass the
head SHA you recorded in step 2 as the expected-head-SHA parameter if the tool has one
(say if it has none). Copy the verbatim result. Then, if the session has a GitHub tool that
enables auto-merge, call it ONCE for the same pull request and copy the verbatim result.
If the first call MERGES the pull request, write "MERGE SUCCEEDED" in the notes and make no
further merge-like call.

STEP 5 - fetch the kit anonymously (ITEM 5). Five Bash calls; copy full output into the notes.
  5a  curl -sS -o /tmp/phase0/kit-raw.out -w 'http=%{http_code} size=%{size_download}\n' https://raw.githubusercontent.com/<KIT_REPO>/<KIT_SHA>/<KIT_FILE>; sha256sum /tmp/phase0/kit-raw.out
      (expected sha256: <KIT_FILE_SHA256>; say whether it matches)
  5b  rm -rf /tmp/phase0/kit-git && git init -q /tmp/phase0/kit-git && git -C /tmp/phase0/kit-git fetch --depth 1 https://github.com/<KIT_REPO>.git <KIT_SHA> 2>&1 | tail -n 5; git -C /tmp/phase0/kit-git rev-parse FETCH_HEAD; git -C /tmp/phase0/kit-git show FETCH_HEAD:<KIT_FILE> | sha256sum
  5c  curl -sS -o /tmp/phase0/kit-tgz.out -w 'http=%{http_code} size=%{size_download}\n' -L https://codeload.github.com/<KIT_REPO>/tar.gz/<KIT_SHA>
  5d  (control on a default-allowlisted non-GitHub host) curl -sS -o /dev/null -w 'control-npm http=%{http_code}\n' https://registry.npmjs.org/
  5e  (second unattached public repo, same three paths as 5a-5c) curl -sS -o /dev/null -w 'second-unattached-raw http=%{http_code}\n' https://raw.githubusercontent.com/octocat/Hello-World/master/README ; git ls-remote https://github.com/octocat/Hello-World.git HEAD 2>&1 | head -n 3 ; curl -sS -o /dev/null -w 'second-unattached-codeload http=%{http_code}\n' -L https://codeload.github.com/octocat/Hello-World/tar.gz/master
Do not run anything fetched from the kit.

STEP 6 - branch switch (ITEM 6). Bash calls, one each, copy output:
  6a  git fetch origin +preview/main:refs/remotes/origin/preview/main 2>&1 | tail -n 3; git branch -a | head -n 10
  6b  git checkout -B preview/main origin/preview/main 2>&1 | tail -n 3; git rev-parse --abbrev-ref HEAD; sha256sum .claude/settings.json | cut -c1-12; sleep 3
  6c  echo BRANCH_CHECK_ON_PREVIEW
  6d  Use the same GitHub read tool as in step 2 once more.
  6e  git checkout main 2>&1 | tail -n 3; git rev-parse --abbrev-ref HEAD; sha256sum .claude/settings.json | cut -c1-12; sleep 3
  6f  echo BRANCH_CHECK_BACK_ON_MAIN
If 6a or 6b fails, record the error and skip to step 7.

STEP 7 - persist evidence. Make sure you are on main (6e) and have no uncommitted changes, then in ONE Bash call
(if the branch from 3e does not exist, use `git checkout -b` instead of `git checkout`):
  git checkout claude/phase0-results-<RUN_ID>-A && mkdir -p results/<RUN_ID>-A && { if [ -f /tmp/phase0/hook-log.jsonl ]; then cp /tmp/phase0/hook-log.jsonl results/<RUN_ID>-A/hook-log.jsonl; else touch results/<RUN_ID>-A/NO-HOOK-LOG; fi; } && cp /tmp/phase0/findings-A.md results/<RUN_ID>-A/findings-A.md && ls -1 /tmp/phase0 > results/<RUN_ID>-A/tmp-listing.txt
(If the notes file is elsewhere, copy it. If the hook log does not exist, say so in the notes before this call; the command then creates results/<RUN_ID>-A/NO-HOOK-LOG and still saves the notes and the listing.)

STEP 8 - commit and push ONLY to the branch named claude/phase0-results-<RUN_ID>-A :
  git add results && git commit -m "chore: phase0 results <RUN_ID> A final" && git push -u origin claude/phase0-results-<RUN_ID>-A
Do not push to main or preview/main. Do not open a pull request. If the push fails, record the
verbatim error and put the full hook log in your final message instead (step 9).

STEP 9 - final message. Print: (1) one line per item 1,2,3,5,6,7,8 stating what you observed (facts only: tool
results, file listings, log counts - no verdicts like "works"); (2) the results branch name and its
head SHA, or the push error; (3) the contents of /tmp/phase0/findings-A.md in full. Then stop.
~~~

---

## TASK B prompt (item 4 only; run only after Task A has finished)

~~~
You are running an unattended diagnostic in a throwaway test repository. Nothing here is a
real change. Your job is to RECORD what happens. Rules: do exactly the steps in order; do not
retry or work around a blocked, denied or failed tool call; copy tool results VERBATIM; never
print environment variable values; do not push anywhere except the branches named below.
Hooks append evidence to /tmp/phase0/hook-log.jsonl; do not edit or delete it.

STEP 1 (one Bash call):
  mkdir -p /tmp/phase0 && date -u && git rev-parse --abbrev-ref HEAD && (claude --version 2>&1 | head -n1) && touch /tmp/phase0/ask-enabled
Write the output to /tmp/phase0/findings-B.md.

STEP 2 - save evidence BEFORE the risky call, in ONE Bash call:
  mkdir -p results/<RUN_ID>-B && cp /tmp/phase0/hook-log.jsonl results/<RUN_ID>-B/hook-log-before-ask.jsonl; cp /tmp/phase0/findings-B.md results/<RUN_ID>-B/ ; git checkout -b claude/phase0-results-<RUN_ID>-B && git add results && git commit -m "chore: phase0 results <RUN_ID> B pre-ask" && git push -u origin claude/phase0-results-<RUN_ID>-B
Then write in your reply text (not a tool call): "ABOUT TO RUN ASK PROBE" and the UTC time from step 1.

STEP 3 - the ask probe. ONE Bash call, exactly this and nothing else, once:
  touch /tmp/phase0/PHASE0_PROBE_ASK.executed
Whatever happens, do not call it again and do not try another way to create that file.

STEP 4 - only reached if step 3 returned control to you. In ONE Bash call: ls -1 /tmp/phase0 ; date -u
Append to findings-B.md: the verbatim result text of step 3 (or "no error text, command ran"), the
listing, and the time. Then in ONE Bash call copy the log and findings into results/<RUN_ID>-B/
(names hook-log-after-ask.jsonl and findings-B.md), `git add results && git commit -m "chore: phase0 results <RUN_ID> B post-ask" && git push`.
Final message: the verbatim step-3 result, the listing, and the branch name. Then stop.
~~~
