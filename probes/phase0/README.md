# Phase 0 probe kit

A kit for checking, in a Claude Code cloud scheduled task, the eight behaviours
that [design section 8.5](../../docs/design.md#85-phase-0-dependencies) lists
as unverified: whether a repository's hooks fire there, whether they fail
closed, whether an environment variable reaches them, what a hook's `ask` does
without a person, whether the kit can be fetched anonymously, whether the hook
set follows a branch switch, the names of the GitHub tools, and whether every
merge path carries an expected head SHA.

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

Relation to the open questions: the results decide the fallbacks of design
section 8.5 (hook or procedure call), and inform
[open questions](../../docs/open-questions.md) 1 (does a hook load after a
branch switch), 2 and 6 (what the hook can intercept, and which GitHub tool
names to match), and 4 (what `ask` does in a scheduled task). They do not
answer the policy probes (questions 26 to 31), which concern the runner's
GitHub credentials and the platform, not hooks.
