#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ops/vps-common.sh
source "${SCRIPT_DIR}/vps-common.sh"

ops_require_command git
ops_require_command npm
ops_require_command node
ops_require_command timeout
ops_require_env TARGET_COMMIT
ops_validate_sha "$TARGET_COMMIT"
ops_require_absolute_path VPS_APP_DIR
ops_require_absolute_path VPS_OPS_STATE_DIR
ops_require_absolute_path VPS_REPORT_DIR
ops_require_env VPS_TRADING_SERVICE_MANAGER
ops_require_env VPS_TRADING_SERVICE
ops_validate_service_name "$VPS_TRADING_SERVICE"

mkdir -p "$VPS_REPORT_DIR"
chmod 700 "$VPS_REPORT_DIR" 2>/dev/null || true
ops_acquire_global_lock
ops_assert_repository
ops_assert_clean_tracked_tree

PREVIOUS_SHA="$(ops_current_sha)"
SERVICE_STATE_BEFORE="$(ops_service_state "$VPS_TRADING_SERVICE_MANAGER" "$VPS_TRADING_SERVICE")"
SERVICE_PID_BEFORE="$(ops_service_pid "$VPS_TRADING_SERVICE_MANAGER" "$VPS_TRADING_SERVICE")"
SERVICE_STATE_AFTER="$SERVICE_STATE_BEFORE"
SERVICE_PID_AFTER="$SERVICE_PID_BEFORE"
DEPLOYMENT_STARTED=false
ROLLBACK_ATTEMPTED=false
ROLLBACK_SUCCEEDED=false
PREFLIGHT_STATUS="NOT_RUN"
PREFLIGHT_LOG="${VPS_REPORT_DIR}/trading-no-order-preflight.log"

write_report() {
  local status="$1"
  local message="$2"
  ops_json_report "${VPS_REPORT_DIR}/trading-code-deploy.json" \
    "schemaVersion=1" \
    "generatedAt=$(ops_now)" \
    "status=${status}" \
    "message=${message}" \
    "targetCommit=${TARGET_COMMIT}" \
    "previousCommit=${PREVIOUS_SHA}" \
    "deployedCommit=$(ops_current_sha 2>/dev/null || true)" \
    "preflightStatus=${PREFLIGHT_STATUS}" \
    "tradingServiceStateBefore=${SERVICE_STATE_BEFORE}" \
    "tradingServiceStateAfter=${SERVICE_STATE_AFTER}" \
    "tradingServicePidBefore=${SERVICE_PID_BEFORE}" \
    "tradingServicePidAfter=${SERVICE_PID_AFTER}" \
    "tradingRestartAttempted=false" \
    "ordersSent=false" \
    "positionsChanged=false" \
    "runtimeStateDirectEdit=false" \
    "rollbackAttempted=${ROLLBACK_ATTEMPTED}" \
    "rollbackSucceeded=${ROLLBACK_SUCCEEDED}"

  cat >"${VPS_REPORT_DIR}/trading-code-deploy.md" <<EOF
# VPS trading code deployment

- Status: **${status}**
- Message: ${message}
- Target SHA: \`${TARGET_COMMIT}\`
- Previous SHA: \`${PREVIOUS_SHA}\`
- Current source SHA: \`$(ops_current_sha 2>/dev/null || printf 'unknown')\`
- No-order preflight: ${PREFLIGHT_STATUS}
- Trading state before/after: ${SERVICE_STATE_BEFORE} / ${SERVICE_STATE_AFTER}
- Trading PID before/after: ${SERVICE_PID_BEFORE} / ${SERVICE_PID_AFTER}
- Trading restart attempted: false
- Orders sent by this workflow: false
- Position changes requested by this workflow: false
- Direct runtime-state edits by this workflow: false
- Rollback attempted: ${ROLLBACK_ATTEMPTED}
- Rollback succeeded: ${ROLLBACK_SUCCEEDED}
EOF
  chmod 600 "${VPS_REPORT_DIR}/trading-code-deploy.md"
}

write_preflight_state() {
  local status="$1"
  ops_json_report "${VPS_OPS_STATE_DIR}/trading-last-preflight.json" \
    "schemaVersion=1" \
    "generatedAt=$(ops_now)" \
    "status=${status}" \
    "targetCommit=${TARGET_COMMIT}" \
    "ordersSent=false" \
    "tradingRestartAttempted=false" \
    "servicePidBefore=${SERVICE_PID_BEFORE}" \
    "servicePidAfter=${SERVICE_PID_AFTER}"
}

rollback_on_error() {
  local exit_code="$1"
  trap - ERR
  set +e
  ROLLBACK_ATTEMPTED=true
  ops_log "trading code deployment failed; restoring source SHA ${PREVIOUS_SHA} without restarting the daemon"

  if [[ "$DEPLOYMENT_STARTED" == true ]]; then
    git -C "$VPS_APP_DIR" checkout --detach --force "$PREVIOUS_SHA"
    (
      cd "$VPS_APP_DIR"
      timeout --preserve-status "${VPS_COMMAND_TIMEOUT:-30m}" npm ci --no-audit --no-fund &&
      timeout --preserve-status "${VPS_COMMAND_TIMEOUT:-30m}" npm run build
    )
    if [[ $? -eq 0 && "$(ops_current_sha 2>/dev/null)" == "$PREVIOUS_SHA" ]]; then
      ROLLBACK_SUCCEEDED=true
    fi
  fi

  SERVICE_STATE_AFTER="$(ops_service_state "$VPS_TRADING_SERVICE_MANAGER" "$VPS_TRADING_SERVICE")"
  SERVICE_PID_AFTER="$(ops_service_pid "$VPS_TRADING_SERVICE_MANAGER" "$VPS_TRADING_SERVICE")"
  write_preflight_state "FAILED"
  write_report "FAILED_ROLLED_BACK" "deployment or no-order preflight failed with exit code ${exit_code}"
  exit "$exit_code"
}

trap 'rollback_on_error $?' ERR

ops_log "deploying trading source exact SHA ${TARGET_COMMIT}; no service restart is permitted"
DEPLOYMENT_STARTED=true
ops_checkout_exact_sha "$TARGET_COMMIT"
ops_run_in_app "npm ci" npm ci --no-audit --no-fund
ops_run_in_app "production build" npm run build

ops_log "running authenticated no-order preflight"
(
  cd "$VPS_APP_DIR"
  timeout --preserve-status "${VPS_PREFLIGHT_TIMEOUT:-15m}" npm run strategy:disdex-v52:preflight
) 2>&1 | tee "$PREFLIGHT_LOG"

if ! grep -q 'PASS_NO_ORDERS_SENT' "$PREFLIGHT_LOG"; then
  ops_die "preflight output did not contain PASS_NO_ORDERS_SENT"
fi
if ! grep -Eq '"ordersSent"[[:space:]]*:[[:space:]]*false' "$PREFLIGHT_LOG"; then
  ops_die "preflight output did not explicitly confirm ordersSent=false"
fi
PREFLIGHT_STATUS="PASS_NO_ORDERS_SENT"

SERVICE_STATE_AFTER="$(ops_service_state "$VPS_TRADING_SERVICE_MANAGER" "$VPS_TRADING_SERVICE")"
SERVICE_PID_AFTER="$(ops_service_pid "$VPS_TRADING_SERVICE_MANAGER" "$VPS_TRADING_SERVICE")"
[[ "$SERVICE_STATE_AFTER" == "$SERVICE_STATE_BEFORE" ]] || ops_die "trading service state changed during code deployment"
[[ "$SERVICE_PID_AFTER" == "$SERVICE_PID_BEFORE" ]] || ops_die "trading service PID changed; an unexpected restart may have occurred"

ops_write_sha_file "${VPS_OPS_STATE_DIR}/trading-staged.sha" "$TARGET_COMMIT"
write_preflight_state "$PREFLIGHT_STATUS"
write_report "PASS_STAGED_NO_RESTART" "trading code and no-order preflight passed; daemon was not restarted"
ops_log "trading code staged at ${TARGET_COMMIT}; daemon restart count: 0"
