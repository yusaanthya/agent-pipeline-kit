# THROWAWAY TEST REPOSITORY - phase 0 hook probe

This repository exists only to observe how Claude Code hooks behave inside a
Claude Code on the web scheduled task. It contains no product code, no secrets
and no real data. Delete it when the test is finished.

What is in it:

- `.claude/settings.json` - hooks (tag `MAIN`) that only record evidence, plus
  deny probes that block a harmless `touch` command or a merge of the test PR.
- `.claude/hooks/record.sh` - appends one JSON line per hook event to
  `/tmp/phase0/hook-log.jsonl` (container-local; the task commits a copy).
- `.claude/hooks/decide.sh` - answers deny / ask / exit-code probes. Needs no secret.
- `preview-main.settings.json` - the same hooks with tag `PREVIEW`. It becomes
  `.claude/settings.json` on the `preview/main` branch only (see the runbook).
- `seed/change.txt` - file changed by the test pull request.

Never put credentials in this repository. The only environment variable the
hooks read is the non-secret `GATE_TEST_LANE`.
