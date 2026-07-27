#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ops/vps-common.sh
source "${SCRIPT_DIR}/vps-common.sh"

ops_require_command node
ops_require_command timeout
ops_require_command curl
ops_require_command journalctl
ops_require_env EXPECTED_SHA
ops_validate_sha "$EXPECTED_SHA"
ops_require_env CONFIRMATION
[[ "$CONFIRMATION" == "I_APPROVE_LIVE_TRADING_DAEMON_RESTART" ]] || ops_die "confirmation phrase is invalid"
[[ "${VPS_ENABLE_APPROVED_TRADING_RESTART:-false}" == "true" ]] || ops_die "repository variable VPS_ENABLE_APPROVED_TRADING_RESTART is not true"
ops_require_atomic_layout
ops_require_absolute_path VPS_TRADING_CURRENT_LINK
ops_require_absolute_path VPS_TRADING_STAGED_LINK
ops_require_absolute_path VPS_OPS_STATE_DIR
ops_require_absolute_path VPS_REPORT_DIR
ops_require_absolute_path VPS_STATE_ROOT
ops_require_env VPS_TRADING_SERVICE_MANAGER
ops_require_env VPS_TRADING_SERVICE
ops_require_env VPS_TRADING_HEALTH_URL
ops_require_env VPS_TRADING_PREFLIGHT_SERVICE_TEMPLATE
ops_validate_service_name "$VPS_TRADING_SERVICE"
ops_validate_preflight_template "$VPS_TRADING_PREFLIGHT_SERVICE_TEMPLATE"

mkdir -p "$VPS_REPORT_DIR"
chmod 700 "$VPS_REPORT_DIR" 2>/dev/null || true
ops_acquire_global_lock
ops_assert_service_working_directory "$VPS_TRADING_SERVICE_MANAGER" "$VPS_TRADING_SERVICE" "$VPS_TRADING_CURRENT_LINK"

CURRENT_RELEASE_BEFORE="$(ops_link_target "$VPS_TRADING_CURRENT_LINK" 2>/dev/null || true)"
CURRENT_SHA_BEFORE="$(ops_link_release_sha "$VPS_TRADING_CURRENT_LINK" 2>/dev/null || true)"
STAGED_RELEASE="$(ops_link_target "$VPS_TRADING_STAGED_LINK" 2>/dev/null || true)"
STAGED_SHA="$(ops_link_release_sha "$VPS_TRADING_STAGED_LINK" 2>/dev/null || true)"
[[ -n "$CURRENT_RELEASE_BEFORE" && -n "$CURRENT_SHA_BEFORE" ]] || ops_die "trading current link is invalid"
[[ -n "$STAGED_RELEASE" && "$STAGED_SHA" == "$EXPECTED_SHA" ]] || ops_die "staged release does not match EXPECTED_SHA"
ops_validate_sha "$CURRENT_SHA_BEFORE"

STAGED_SHA_FILE="${VPS_OPS_STATE_DIR}/trading-staged.sha"
[[ -f "$STAGED_SHA_FILE" ]] || ops_die "trading-staged.sha is missing; stage and preflight the code first"
[[ "$(tr -d '[:space:]' <"$STAGED_SHA_FILE")" == "$EXPECTED_SHA" ]] || ops_die "trading-staged.sha does not match EXPECTED_SHA"

SERVICE_STATE_BEFORE="$(ops_service_state "$VPS_TRADING_SERVICE_MANAGER" "$VPS_TRADING_SERVICE")"
SERVICE_PID_BEFORE="$(ops_service_pid "$VPS_TRADING_SERVICE_MANAGER" "$VPS_TRADING_SERVICE")"
SERVICE_STATE_AFTER="$SERVICE_STATE_BEFORE"
SERVICE_PID_AFTER="$SERVICE_PID_BEFORE"
CURRENT_SHA_AFTER="$CURRENT_SHA_BEFORE"
HEALTH_STATUS=0
PREFLIGHT_STATUS="NOT_RUN"
RESTART_ATTEMPTED=false
CURRENT_LINK_SWITCHED=false
CURRENT_LINK_RESTORED_ON_ERROR=false
GATE_REPORT="${VPS_REPORT_DIR}/trading-restart-gate.json"
PREFLIGHT_LOG="${VPS_REPORT_DIR}/trading-restart-preflight.log"

write_report() {
  local status="$1"
  local message="$2"
  CURRENT_SHA_AFTER="$(ops_link_release_sha "$VPS_TRADING_CURRENT_LINK" 2>/dev/null || true)"
  ops_json_report "${VPS_REPORT_DIR}/trading-restart.json" \
    "schemaVersion=2" \
    "generatedAt=$(ops_now)" \
    "status=${status}" \
    "message=${message}" \
    "expectedCommit=${EXPECTED_SHA}" \
    "previousCommit=${CURRENT_SHA_BEFORE}" \
    "currentCommit=${CURRENT_SHA_AFTER}" \
    "preflightStatus=${PREFLIGHT_STATUS}" \
    "serviceStateBefore=${SERVICE_STATE_BEFORE}" \
    "serviceStateAfter=${SERVICE_STATE_AFTER}" \
    "servicePidBefore=${SERVICE_PID_BEFORE}" \
    "servicePidAfter=${SERVICE_PID_AFTER}" \
    "healthHttpStatus=${HEALTH_STATUS}" \
    "restartAttempted=${RESTART_ATTEMPTED}" \
    "currentLinkSwitched=${CURRENT_LINK_SWITCHED}" \
    "currentLinkRestoredOnError=${CURRENT_LINK_RESTORED_ON_ERROR}" \
    "runtimeStateDirectEdit=false" \
    "killSwitchCleared=false" \
    "orderSubmissionRequestedByWorkflow=false"

  cat >"${VPS_REPORT_DIR}/trading-restart.md" <<EOF_MD
# Approved trading daemon atomic restart

- Status: **${status}**
- Message: ${message}
- Previous SHA: \`${CURRENT_SHA_BEFORE}\`
- Expected/staged SHA: \`${EXPECTED_SHA}\`
- Current link SHA after workflow: \`${CURRENT_SHA_AFTER:-unknown}\`
- No-order preflight: ${PREFLIGHT_STATUS}
- Service state before/after: ${SERVICE_STATE_BEFORE} / ${SERVICE_STATE_AFTER}
- PID before/after: ${SERVICE_PID_BEFORE} / ${SERVICE_PID_AFTER}
- Health HTTP: ${HEALTH_STATUS}
- Restart attempted: ${RESTART_ATTEMPTED}
- Current link switched: ${CURRENT_LINK_SWITCHED}
- Current link restored on error: ${CURRENT_LINK_RESTORED_ON_ERROR}
- Direct runtime-state edits: false
- Kill Switch cleared: false
- Orders requested by this workflow: false

This workflow does not weaken the existing LIVE gates. A failed restart requires operator review; it does not clear state or submit fallback orders.
EOF_MD
  chmod 600 "${VPS_REPORT_DIR}/trading-restart.md"
}

on_error() {
  local exit_code="$1"
  trap - ERR
  set +e
  if [[ "$CURRENT_LINK_SWITCHED" == true ]]; then
    ops_atomic_symlink "$CURRENT_RELEASE_BEFORE" "$VPS_TRADING_CURRENT_LINK"
    CURRENT_LINK_RESTORED_ON_ERROR=true
  fi
  SERVICE_STATE_AFTER="$(ops_service_state "$VPS_TRADING_SERVICE_MANAGER" "$VPS_TRADING_SERVICE")"
  SERVICE_PID_AFTER="$(ops_service_pid "$VPS_TRADING_SERVICE_MANAGER" "$VPS_TRADING_SERVICE")"
  HEALTH_STATUS="$(ops_http_code "$VPS_TRADING_HEALTH_URL" 2>/dev/null || printf '0')"
  write_report "FAILED_MANUAL_REVIEW_REQUIRED" "approved restart failed with exit code ${exit_code}; current link was restored when possible, but no automatic second restart or state edit was attempted"
  exit "$exit_code"
}
trap 'on_error $?' ERR

ops_log "running fail-closed runtime-state gate"
VPS_GATE_REPORT="$GATE_REPORT" node "${SCRIPT_DIR}/vps-trading-restart-gate.mjs"

ops_log "re-running authenticated no-order preflight for staged release"
ops_run_preflight_service "$VPS_TRADING_PREFLIGHT_SERVICE_TEMPLATE" "$EXPECTED_SHA" "$PREFLIGHT_LOG"
grep -q 'PASS_NO_ORDERS_SENT' "$PREFLIGHT_LOG" || ops_die "preflight did not contain PASS_NO_ORDERS_SENT"
grep -Eq '"ordersSent"[[:space:]]*:[[:space:]]*false' "$PREFLIGHT_LOG" || ops_die "preflight did not explicitly confirm ordersSent=false"
PREFLIGHT_STATUS="PASS_NO_ORDERS_SENT"
[[ "$(ops_link_release_sha "$VPS_TRADING_STAGED_LINK")" == "$EXPECTED_SHA" ]] || ops_die "staged link changed during preflight"
[[ "$(ops_link_release_sha "$VPS_TRADING_CURRENT_LINK")" == "$CURRENT_SHA_BEFORE" ]] || ops_die "current link changed before approved switch"

ops_atomic_symlink "$STAGED_RELEASE" "$VPS_TRADING_CURRENT_LINK"
CURRENT_LINK_SWITCHED=true
[[ "$(ops_link_release_sha "$VPS_TRADING_CURRENT_LINK")" == "$EXPECTED_SHA" ]] || ops_die "current link did not switch to approved SHA"

RESTART_ATTEMPTED=true
ops_restart_trading "$VPS_TRADING_SERVICE_MANAGER" "$VPS_TRADING_SERVICE"
sleep "${VPS_POST_RESTART_WAIT_SECONDS:-8}"

SERVICE_STATE_AFTER="$(ops_service_state "$VPS_TRADING_SERVICE_MANAGER" "$VPS_TRADING_SERVICE")"
SERVICE_PID_AFTER="$(ops_service_pid "$VPS_TRADING_SERVICE_MANAGER" "$VPS_TRADING_SERVICE")"
[[ "$SERVICE_STATE_AFTER" == "active" || "$SERVICE_STATE_AFTER" == "online" ]] || ops_die "trading service is not active after restart"
if [[ "$SERVICE_PID_BEFORE" != "0" && "$SERVICE_PID_AFTER" == "$SERVICE_PID_BEFORE" ]]; then
  ops_die "trading service PID did not change after explicit restart"
fi

HEALTH_STATUS="$(ops_http_code "$VPS_TRADING_HEALTH_URL")"
[[ "$HEALTH_STATUS" =~ ^2[0-9][0-9]$ ]] || ops_die "trading health endpoint failed with HTTP ${HEALTH_STATUS}"
[[ "$(ops_link_release_sha "$VPS_TRADING_CURRENT_LINK")" == "$EXPECTED_SHA" ]] || ops_die "current link SHA changed after restart"

ops_write_sha_file "${VPS_OPS_STATE_DIR}/trading-last-restarted.sha" "$EXPECTED_SHA"
write_report "PASS" "approved atomic current-link switch and trading restart completed"
ops_log "approved trading daemon restart passed for ${EXPECTED_SHA}"
