#!/usr/bin/env bash
# PHASE0 decision hook. Logs what it is about to do BEFORE doing it, then answers.
# Usage: bash decide.sh <MODE> <LABEL> <SETTINGS_TAG>
#   MODE plain  : Bash probes. Acts only on a command that STARTS WITH
#                 "touch /tmp/phase0/PHASE0_PROBE_<NAME>.executed"; everything else -> no decision.
#   MODE strict : registered with onFailure=block; only PHASE0_PROBE_CRASH_BLOCK makes it exit 1.
#   MODE merge  : denies every call it is matched against (merge-like tools).
# It needs no secret and has no side effect except the log line.
MODE="${1:?mode}"; LABEL="${2:-}"; TAG="${3:-NOTAG}"
LOG_DIR="${PHASE0_LOG_DIR:-/tmp/phase0}"
LOG="$LOG_DIR/hook-log.jsonl"
mkdir -p "$LOG_DIR" 2>/dev/null
INPUT="$(cat 2>/dev/null)"

if ! command -v jq >/dev/null 2>&1; then
  # Merge gate must fail closed; probe hooks must not break the run.
  [ "$MODE" = merge ] && { echo "PHASE0_HOOK_BLOCK jq missing" >&2; exit 2; }
  exit 0
fi

TOOL="$(printf '%s' "$INPUT" | jq -r '.tool_name // ""')"
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""')"
TS="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"

log() { # $1 = decision label
  jq -nc --arg ts "$TS" --arg mode "$MODE" --arg label "$LABEL" --arg tag "$TAG" \
    --arg tool "$TOOL" --arg d "$1" \
    '{ts:$ts,kind:"decide",mode:$mode,label:$label,tag:$tag,tool:$tool,decision:$d}' >>"$LOG" 2>/dev/null
}
deny_json() { # $1 = reason
  jq -nc --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
}
ask_json() {
  jq -nc '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"ask",permissionDecisionReason:"PHASE0_HOOK_ASK probe"}}'
}

P="touch /tmp/phase0/PHASE0_PROBE_"
case "$MODE" in
  plain)
    case "$CMD" in
      "${P}EXIT2.executed"*)
        log "exit2"; echo "PHASE0_HOOK_BLOCK exit-2 probe" >&2; exit 2;;
      "${P}DENYJSON.executed"*)
        log "deny-json"; deny_json "PHASE0_HOOK_BLOCK deny-json probe"; exit 0;;
      "${P}CRASH_OPEN.executed"*)
        log "exit1-no-onFailure"; echo "PHASE0 crash-open probe (exit 1, no onFailure)" >&2; exit 1;;
      "${P}ASK.executed"*)
        if [ -e "$LOG_DIR/ask-enabled" ]; then log "ask"; ask_json; exit 0
        else log "ask-skipped-not-enabled"; exit 0; fi;;
    esac
    exit 0;;
  strict)
    case "$CMD" in
      "${P}CRASH_BLOCK.executed"*)
        log "exit1-with-onFailure-block"; echo "PHASE0 crash-block probe (exit 1, onFailure=block)" >&2; exit 1;;
    esac
    exit 0;;
  merge)
    log "deny"
    deny_json "PHASE0_HOOK_BLOCK merge-gate label=$LABEL settings=$TAG tool=$TOOL"
    exit 0;;
esac
exit 0
