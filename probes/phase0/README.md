# Phase 0 probe kit

A kit for checking whether a Claude Code cloud scheduled task can use a
repository-local hook to gate merges. The [runbook](runbook.md) defines eight
checks and how to interpret the evidence.

Status: **reviewed, never run in a cloud session.** The scripts passed
syntax and dry-run checks on a local machine (listed at the end of the
runbook); nothing has been executed inside Claude Code or on GitHub. Treat
every expected outcome in the runbook as a prediction, not a result.

Contents:

- `runbook.md`: what each of the eight items means as confirmed, false or
  inconclusive, the owner's steps, and the documentation relied on.
- `task-prompt.md`: the two prompts (task A for seven items, task B for the
  `ask` probe, so a hang cannot cost the other evidence) and the placeholders
  to fill in.
- `repo/`: the throwaway test repository, to be copied out and pushed to a new
  private repository. It contains hooks that only record evidence and deny
  harmless probe commands, and no secret or product code.

These files are inert here. Claude Code reads project settings at the root of
a session's repository, so the hooks under `repo/.claude/` take effect only in
a session started inside `repo/`, or in a repository that contains `repo/`'s
files at its root. Do not copy them into a real consumer.

For a consumer integrating the gate, the checks inform these fallbacks.

| Probe result | Fallback |
| --- | --- |
| Repository hooks do not load, fail-closed handling is unavailable, or the hook set after a branch switch is unverified | Call the gate CLI explicitly before merging. |
| The lane environment variable does not reach the hook | Pass the lane explicitly when calling the gate CLI from the task. |
| A hook's `ask` stalls or silently allows a scheduled action | Use `ask` only in sessions explicitly marked interactive. |
| The scheduled task cannot fetch the pinned kit | Vendor the kit into the consumer repository. |
| GitHub tool names have a different prefix | Match the observed tool names without assuming a fixed prefix. |
| A merge path cannot carry the expected head SHA | Refuse that path. |
