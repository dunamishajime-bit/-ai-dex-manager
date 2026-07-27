#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ops/vps-common.sh
source "${SCRIPT_DIR}/vps-common.sh"

ops_require_command git
ops_require_command npm
ops_require_command node
ops_require_command timeout
ops_require_command curl
ops_require_env EXPECTED_SHA
ops_validate_sha "$EXPECTED_SHA"
ops_require_env CONFIRMATION
[[ "$CONFIRMATION" == "I_APPROVE_LIVE_TRADING_DAEMON_RESTART" ]] || ops_die "confirmation phrase is invalid"
[[ "${VPS_ENABLE_APPROVED_TRADING_RESTART:-false}" == "true" ]] || ops_die "repository variable VPS_ENABLE_APPROVED_TRADING_RESTART is not true"
ops_require_absolute_path VPS_APP_DIR
ops_require_absolute_path VPS_OPS_STATE_DIR
ops_require_absolute_path VPS_REPORT_DIR
ops_require_absolute_path VPS_STATE_ROOT
ops_require_env VPS_TRADING_SERVICE_MANAGER
ops_require_env VPS_TRADING_SERVICE
ops_require_env VPS_TRADING_HEALTH_URL
ops_validate_service_name "$VPS_TRADING_SERVICE"

mkdir -p "$VPS_REPORT_DIR"
chmod 700 "$VPS_REPORT_DIR" 2>/dev/null || true
ops_acquire_global_lock
ops_assert_repository
ops_assert_clean_tracked_tree

CURRENT_SHA="$(ops_current_sha)"
[[ "$CURRENT_SHA" == "$EXPECTED_SHA" ]] || ops_die "deployed source SHA does not match EXPECTED_SHA"

STAGED_SHA_FILE="${VPS_OPS_STATE_DIR}/trading-staged.sha"
[[ -f "$STAGED_SHA_FILE" ]] || ops_die "trading-staged.sha is missing; deploy and preflight the code first"
STAGED_SHA="$(tr -d '[:space:]' <"$STAGED_SHA_FILE")"
[[ "$STAGED_SHA" == "$EXPECTED_SHA" ]] || ops_die "staged SHA does not match EXPECTED_SHA"

SERVICE_STATE_BEFORE="$(ops_service_state "$VPS_TRADING_SERVICE_MANAGER" "$VPS_TRADING_SERVICE")"
SERVICE_PID_BEFORE="$(ops_service_pid "$VPS_TRADING_SERVICE_MANAGER" "$VPS_TRADING_SERVICE")"
SERVICE_STATE_AFTER="$SERVICE_STATE_BEFORE"
SERVICE_PID_AFTER="$SERVICE_PID_BEFORE"
HEALTH_STATUS=0
PREFLIGHT_STATUS="NOT_RUN"
RESTART_ATTEMPTED=false
GATE_REPORT="${VPS_REPORT_DIR}/trading-restart-gate.json"
PREFLIGHT_LOG="${VPS_REPORT_DIR}/trading-restart-preflight.log"

write_report() {
  local status="$1"
  local message="$2"
  ops_json_report "${VPS_REPORT_DIR}/trading-restart.json" \
    "schemaVersion=1" \
    "generatedAt=$(ops_now)" \
    "status=${status}" \
    "message=${message}" \
    "expectedCommit=${EXPECTED_SHA}" \
    "deployedCommit=$(ops_current_sha 2>/dev/null || true)" \
    "preflightStatus=${PREFLIGHT_STATUS}" \
    "serviceStateBefore=${SERVICE_STATE_BEFORE}" \
    "serviceStateAfter=${SERVICE_STATE_AFTER}" \
    "servicePidBefore=${SERVICE_PID_BEFORE}" \
    "servicePidAfter=${SERVICE_PID_AFTER}" \
    "healthHttpStatus=${HEALTH_STATUS}" \
    "restartAttempted=${RESTART_ATTEMPTED}" \
    "runtimeStateDirectEdit=false" \
    "killSwitchCleared=false" \
    "orderSubmissionRequestedByWorkflow=false"

  cat >"${VPS_REPORT_DIR}/trading-restart.md" <<EOF
# Approved trading daemon restart

- Status: **${status}**
- Message: ${message}
- Expected/deployed SHA: \`${EXPECTED_SHA}\`
- No-order preflight: ${PREFLIGHT_STATUS}
- Service state before/after: ${SERVICE_STATE_BEFORE} / ${SERVICE_STATE_AFTER}
- PID before/after: ${SERVICE_PID_BEFORE} / ${SERVICE_PID_AFTER}
- Health HTTP: ${HEALTH_STATUS}
- Restart attempted: ${RESTART_ATTEMPTED}
- Direct runtime-state edits: false
- Kill Switch cleared: false
- Orders requested by this workflow: false

The restarted daemon retains its existing production LIVE gates. This workflow does not bypass or weaken them.
EOF
  chmod 600 "${VPS_REPORT_DIR}/trading-restart.md"
}

on_error() {
  local exit_code="$1"
  trap - ERR
  set +e
  SERVICE_STATE_AFTER="$(ops_service_state "$VPS_TRADING_SERVICE_MANAGER" "$VPS_TRADING_SERVICE")"
  SERVICE_PID_AFTER="$(ops_service_pid "$VPS_TRADING_SERVICE_MANAGER" "$VPS_TRADING_SERVICE")"
  HEALTH_STATUS="$(ops_http_code "$VPS_TRADING_HEALTH_URL" 2>/dev/null || printf '0')"
  write_report "FAILED_MANUAL_REVIEW_REQUIRED" "approved restart workflow failed with exit code ${exit_code}; no automatic state edit or Kill Switch change was attempted"
  exit "$exit_code"
}
trap 'on_error $?' ERR

ops_log "running fail-closed runtime-state gate"
VPS_GATE_REPORT="$GATE_REPORT" node "${SCRIPT_DIR}/vps-trading-restart-gate.mjs"

ops_log "re-running authenticated no-order preflight before restart"
(
  cd "$VPS_APP_DIR"
  timeout --preserve-status "${VPS_PREFLIGHT_TIMEOUT:-15m}" npm run strategy:disdex-v52:preflight
) 2>&1 | tee "$PREFLIGHT_LOG"
grep -q 'PASS_NO_ORDERS_SENT' "$PREFLIGHT_LOG" || ops_die "preflight did not contain PASS_NO_ORDERS_SENT"
grep -Eq '"ordersSent"[[:space:]]*:[[:space:]]*false' "$PREFLIGHT_LOG" || ops_die "preflight did not explicitly confirm ordersSent=false"
PREFLIGHT_STATUS="PASS_NO_ORDERS_SENT"

[[ "$(ops_current_sha)" == "$EXPECTED_SHA" ]] || ops_die "source SHA changed during preflight"

RESTART_ATTEMPTED=true
ops_restart_trading "$VPS_TRADING_SERVICE_MANAGER" "$VPS_TRADING_SERVICE"
sleep "${VPS_POST_RESTART_WAIT_SECONDS:-8}"

SERVICE_STATE_AFTER="$(ops_service_state "$VPS_TRADING_SERVICE_MANAGER" "$VPS_TRADING_SERVICE")"
SERVICE_PID_AFTER="$(ops_service_pid "$VPS_TRADING_SERVICE_MANAGER" "$VPS_TRADING_SERVICE")"
[[ "$SERVICE_STATE_AFTER" == "active" || "$SERVICE_STATE_AFTER" == "online" ]] || ops_die "trading service is not active after restart"
if [[ "$SERVICE_PID_BEFORE" != "0" && "$SERVICE_PID_AFTER" == "$SERVICE_PID_BEFORE" ]]; then
  ops_die "trading service PID did not change after an explicit restart"
fi

HEALTH_STATUS="$(ops_http_code "$VPS_TRADING_HEALTH_URL")"
[[ "$HEALTH_STATUS" =~ ^2[0-9][0-9]$ ]] || ops_die "trading health endpoint failed with HTTP ${HEALTH_STATUS}"

ops_write_sha_file "${VPS_OPS_STATE_DIR}/trading-last-restarted.sha" "$EXPECTED_SHA"
write_report "PASS" "approved restart completed; existing LIVE gates remain authoritative"
ops_log "approved trading daemon restart passed for ${EXPECTED_SHA}"
