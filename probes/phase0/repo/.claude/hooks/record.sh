#!/usr/bin/env bash
# PHASE0 evidence recorder. Appends ONE JSON line per hook event to the log.
# Contract: never writes to stdout, never blocks, always exits 0.
# Usage (from settings): bash "$CLAUDE_PROJECT_DIR/.claude/hooks/record.sh" <SETTINGS_TAG>
# <SETTINGS_TAG> identifies which settings.json registered the hook (MAIN or PREVIEW).
TAG="${1:-NOTAG}"
LOG_DIR="${PHASE0_LOG_DIR:-/tmp/phase0}"
LOG="$LOG_DIR/hook-log.jsonl"
mkdir -p "$LOG_DIR" 2>/dev/null || exit 0
INPUT="$(cat 2>/dev/null)"
TS="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ 2>/dev/null)"

if ! command -v jq >/dev/null 2>&1; then
  printf '{"ts":"%s","kind":"record","tag":"%s","note":"jq-missing"}\n' "$TS" "$TAG" >>"$LOG"
  exit 0
fi

PROJ="${CLAUDE_PROJECT_DIR:-$PWD}"
BRANCH="$(git -C "$PROJ" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
HEADSHA="$(git -C "$PROJ" rev-parse --short=12 HEAD 2>/dev/null || echo unknown)"
SETTINGS_SHA="$(sha256sum "$PROJ/.claude/settings.json" 2>/dev/null | cut -c1-12)"

# Claude Code version: captured once per container (first hook event of the run).
VERSION=""
if [ ! -e "$LOG_DIR/version.done" ]; then
  VERSION="$(timeout 10 claude --version </dev/null 2>&1 | head -n1)"
  if [ -z "$VERSION" ]; then
    TP="$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)"
    [ -n "$TP" ] && [ -r "$TP" ] && VERSION="transcript:$(grep -o '"version":"[^"]*"' "$TP" 2>/dev/null | head -n1)"
  fi
  [ -z "$VERSION" ] && VERSION="unknown"
  touch "$LOG_DIR/version.done" 2>/dev/null
fi

if [ -n "${GATE_TEST_LANE+x}" ]; then LANE_SET=true; else LANE_SET=false; fi

printf '%s' "$INPUT" | jq -c \
  --arg ts "$TS" --arg tag "$TAG" --arg branch "$BRANCH" --arg head "$HEADSHA" \
  --arg ssha "$SETTINGS_SHA" --arg ver "$VERSION" --arg proj "${CLAUDE_PROJECT_DIR-}" \
  --arg remote "${CLAUDE_CODE_REMOTE-<unset>}" --arg lane "${GATE_TEST_LANE-<unset>}" \
  --argjson lane_set "$LANE_SET" '
  {
    ts: $ts, kind: "record", tag: $tag,
    event: (.hook_event_name // null),
    tool: (.tool_name // null),
    mcp_server: (.mcp_server // null),
    tool_input: (if (.tool_input // null) == null then null else (.tool_input | tojson | .[0:400]) end),
    tool_use_id: (.tool_use_id // null),
    permission_mode: (.permission_mode // null),
    session_id: (.session_id // null),
    cwd: (.cwd // null),
    source: (.source // null),
    extra: (del(.tool_input, .transcript_path, .session_id, .cwd, .hook_event_name, .tool_name, .tool_use_id, .permission_mode, .mcp_server, .source) | tojson | .[0:600]),
    branch: $branch, head: $head, settings_sha: $ssha,
    env: { GATE_TEST_LANE: { set: $lane_set, value: $lane }, CLAUDE_CODE_REMOTE: $remote, CLAUDE_PROJECT_DIR: $proj },
    claude_version: (if $ver == "" then null else $ver end)
  }' >>"$LOG" 2>/dev/null \
  || printf '{"ts":"%s","kind":"record","tag":"%s","note":"stdin-not-json-or-jq-error"}\n' "$TS" "$TAG" >>"$LOG"

exit 0
