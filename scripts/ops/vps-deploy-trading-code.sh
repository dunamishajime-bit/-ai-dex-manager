#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ops/vps-common.sh
source "${SCRIPT_DIR}/vps-common.sh"

ops_require_command git
ops_require_command npm
ops_require_command node
ops_require_command timeout
ops_require_command tar
ops_require_command journalctl
ops_require_env TARGET_COMMIT
ops_validate_sha "$TARGET_COMMIT"
ops_require_atomic_layout
ops_require_absolute_path VPS_SOURCE_REPO_DIR
ops_require_absolute_path VPS_TRADING_RELEASES_DIR
ops_require_absolute_path VPS_TRADING_CURRENT_LINK
ops_require_absolute_path VPS_TRADING_STAGED_LINK
ops_require_absolute_path VPS_TRADING_SHARED_STATE_DIR
ops_require_absolute_path VPS_TRADING_SHARED_APPROVAL_DIR
ops_require_absolute_path VPS_OPS_STATE_DIR
ops_require_absolute_path VPS_REPORT_DIR
ops_require_env VPS_TRADING_SERVICE_MANAGER
ops_require_env VPS_TRADING_SERVICE
ops_require_env VPS_TRADING_PREFLIGHT_SERVICE_TEMPLATE
ops_validate_service_name "$VPS_TRADING_SERVICE"
ops_validate_preflight_template "$VPS_TRADING_PREFLIGHT_SERVICE_TEMPLATE"
[[ -d "$VPS_TRADING_SHARED_STATE_DIR" ]] || ops_die "VPS_TRADING_SHARED_STATE_DIR does not exist"
[[ -e "$VPS_TRADING_SHARED_APPROVAL_DIR" || -L "$VPS_TRADING_SHARED_APPROVAL_DIR" ]] || ops_die "VPS_TRADING_SHARED_APPROVAL_DIR does not exist"

mkdir -p "$VPS_REPORT_DIR"
chmod 700 "$VPS_REPORT_DIR" 2>/dev/null || true
ops_acquire_global_lock
ops_assert_source_repository
ops_assert_clean_source_tree

CURRENT_RELEASE="$(ops_link_target "$VPS_TRADING_CURRENT_LINK" 2>/dev/null || true)"
CURRENT_SHA="$(ops_link_release_sha "$VPS_TRADING_CURRENT_LINK" 2>/dev/null || true)"
[[ -n "$CURRENT_RELEASE" && -n "$CURRENT_SHA" ]] || ops_die "trading current link is not initialized to a valid release"
ops_validate_sha "$CURRENT_SHA"

SERVICE_STATE_BEFORE="$(ops_service_state "$VPS_TRADING_SERVICE_MANAGER" "$VPS_TRADING_SERVICE")"
SERVICE_PID_BEFORE="$(ops_service_pid "$VPS_TRADING_SERVICE_MANAGER" "$VPS_TRADING_SERVICE")"
SERVICE_STATE_AFTER="$SERVICE_STATE_BEFORE"
SERVICE_PID_AFTER="$SERVICE_PID_BEFORE"
NEW_RELEASE=""
PREVIOUS_STAGED_RELEASE="$(ops_link_target "$VPS_TRADING_STAGED_LINK" 2>/dev/null || true)"
PREVIOUS_STAGED_SHA="$(ops_link_release_sha "$VPS_TRADING_STAGED_LINK" 2>/dev/null || true)"
STAGED_SWITCHED=false
PREFLIGHT_STATUS="NOT_RUN"
PREFLIGHT_LOG="${VPS_REPORT_DIR}/trading-no-order-preflight.log"

write_report() {
  local status="$1"
  local message="$2"
  local staged_release staged_sha
  staged_release="$(ops_link_target "$VPS_TRADING_STAGED_LINK" 2>/dev/null || true)"
  staged_sha="$(ops_link_release_sha "$VPS_TRADING_STAGED_LINK" 2>/dev/null || true)"
  ops_json_report "${VPS_REPORT_DIR}/trading-code-deploy.json" \
    "schemaVersion=2" \
    "generatedAt=$(ops_now)" \
    "status=${status}" \
    "message=${message}" \
    "deploymentLayoutMode=${VPS_DEPLOYMENT_LAYOUT_MODE}" \
    "targetCommit=${TARGET_COMMIT}" \
    "currentCommit=${CURRENT_SHA}" \
    "currentRelease=${CURRENT_RELEASE}" \
    "stagedCommit=${staged_sha}" \
    "stagedRelease=${staged_release}" \
    "preflightStatus=${PREFLIGHT_STATUS}" \
    "tradingServiceStateBefore=${SERVICE_STATE_BEFORE}" \
    "tradingServiceStateAfter=${SERVICE_STATE_AFTER}" \
    "tradingServicePidBefore=${SERVICE_PID_BEFORE}" \
    "tradingServicePidAfter=${SERVICE_PID_AFTER}" \
    "tradingRestartAttempted=false" \
    "currentLinkChanged=false" \
    "ordersSent=false" \
    "positionsChanged=false" \
    "runtimeStateDirectEdit=false"

  cat >"${VPS_REPORT_DIR}/trading-code-deploy.md" <<EOF_MD
# VPS trading code atomic staging

- Status: **${status}**
- Message: ${message}
- Layout: ${VPS_DEPLOYMENT_LAYOUT_MODE}
- Current/live SHA: \`${CURRENT_SHA}\`
- Target/staged SHA: \`${TARGET_COMMIT}\`
- Staged link SHA: \`${staged_sha:-unknown}\`
- No-order preflight: ${PREFLIGHT_STATUS}
- Trading state before/after: ${SERVICE_STATE_BEFORE} / ${SERVICE_STATE_AFTER}
- Trading PID before/after: ${SERVICE_PID_BEFORE} / ${SERVICE_PID_AFTER}
- Trading restart attempted: false
- Live current link changed: false
- Orders sent by this workflow: false
- Position changes requested by this workflow: false
- Direct runtime-state edits by this workflow: false
EOF_MD
  chmod 600 "${VPS_REPORT_DIR}/trading-code-deploy.md"
}

write_preflight_state() {
  local status="$1"
  ops_json_report "${VPS_OPS_STATE_DIR}/trading-last-preflight.json" \
    "schemaVersion=2" \
    "generatedAt=$(ops_now)" \
    "status=${status}" \
    "targetCommit=${TARGET_COMMIT}" \
    "currentCommit=${CURRENT_SHA}" \
    "ordersSent=false" \
    "tradingRestartAttempted=false" \
    "servicePidBefore=${SERVICE_PID_BEFORE}" \
    "servicePidAfter=${SERVICE_PID_AFTER}"
}

on_error() {
  local exit_code="$1"
  trap - ERR
  set +e
  if [[ "$STAGED_SWITCHED" == true ]]; then
    if [[ -n "$PREVIOUS_STAGED_RELEASE" && -n "$PREVIOUS_STAGED_SHA" ]]; then
      ops_atomic_symlink "$PREVIOUS_STAGED_RELEASE" "$VPS_TRADING_STAGED_LINK"
    else
      rm -f -- "$VPS_TRADING_STAGED_LINK"
    fi
  fi
  SERVICE_STATE_AFTER="$(ops_service_state "$VPS_TRADING_SERVICE_MANAGER" "$VPS_TRADING_SERVICE")"
  SERVICE_PID_AFTER="$(ops_service_pid "$VPS_TRADING_SERVICE_MANAGER" "$VPS_TRADING_SERVICE")"
  write_preflight_state "FAILED"
  write_report "FAILED_NO_LIVE_CHANGE" "trading staging or no-order preflight failed with exit code ${exit_code}"
  exit "$exit_code"
}
trap 'on_error $?' ERR

ops_log "materializing trading release exact SHA ${TARGET_COMMIT}; live current link and daemon will not be touched"
NEW_RELEASE="$(ops_prepare_release "$TARGET_COMMIT" "$VPS_TRADING_RELEASES_DIR")"
ops_link_shared_path "$VPS_TRADING_SHARED_STATE_DIR" "${NEW_RELEASE}/.runtime-state"
ops_link_shared_path "$VPS_TRADING_SHARED_APPROVAL_DIR" "${NEW_RELEASE}/.runtime-approval"

ops_run_in_dir "$NEW_RELEASE" "npm ci" npm ci --no-audit --no-fund
ops_run_in_dir "$NEW_RELEASE" "typecheck" npm run typecheck
ops_run_in_dir "$NEW_RELEASE" "V96 parity" npm run strategy:disdex-v96:parity
ops_run_in_dir "$NEW_RELEASE" "executor self-test" npm run strategy:executor:selftest
ops_run_in_dir "$NEW_RELEASE" "V35 runner self-test" npm run strategy:disdex-v35:runner:selftest
ops_run_in_dir "$NEW_RELEASE" "V46 self-test" npm run strategy:disdex-v46:selftest
ops_run_in_dir "$NEW_RELEASE" "V52 contract" npm run strategy:disdex-v52:contract
ops_run_in_dir "$NEW_RELEASE" "V52 safety self-test" npm run strategy:disdex-v52:safety:selftest
ops_run_in_dir "$NEW_RELEASE" "production build" npm run build
[[ "$(ops_release_sha "$NEW_RELEASE")" == "$TARGET_COMMIT" ]] || ops_die "release marker changed during tests"

ops_log "running authenticated no-order preflight through fixed systemd template"
ops_run_preflight_service "$VPS_TRADING_PREFLIGHT_SERVICE_TEMPLATE" "$TARGET_COMMIT" "$PREFLIGHT_LOG"
grep -q 'PASS_NO_ORDERS_SENT' "$PREFLIGHT_LOG" || ops_die "preflight log did not contain PASS_NO_ORDERS_SENT"
grep -Eq '"ordersSent"[[:space:]]*:[[:space:]]*false' "$PREFLIGHT_LOG" || ops_die "preflight log did not explicitly confirm ordersSent=false"
PREFLIGHT_STATUS="PASS_NO_ORDERS_SENT"

SERVICE_STATE_AFTER="$(ops_service_state "$VPS_TRADING_SERVICE_MANAGER" "$VPS_TRADING_SERVICE")"
SERVICE_PID_AFTER="$(ops_service_pid "$VPS_TRADING_SERVICE_MANAGER" "$VPS_TRADING_SERVICE")"
[[ "$SERVICE_STATE_AFTER" == "$SERVICE_STATE_BEFORE" ]] || ops_die "trading service state changed during staging"
[[ "$SERVICE_PID_AFTER" == "$SERVICE_PID_BEFORE" ]] || ops_die "trading service PID changed; an unexpected restart may have occurred"
[[ "$(ops_link_release_sha "$VPS_TRADING_CURRENT_LINK")" == "$CURRENT_SHA" ]] || ops_die "live current link changed during staging"

ops_atomic_symlink "$NEW_RELEASE" "$VPS_TRADING_STAGED_LINK"
STAGED_SWITCHED=true
[[ "$(ops_link_release_sha "$VPS_TRADING_STAGED_LINK")" == "$TARGET_COMMIT" ]] || ops_die "staged link did not reach target SHA"
ops_write_sha_file "${VPS_OPS_STATE_DIR}/trading-staged.sha" "$TARGET_COMMIT"
write_preflight_state "$PREFLIGHT_STATUS"
write_report "PASS_STAGED_NO_RESTART" "trading release passed tests and authenticated no-order preflight; live current link and daemon were unchanged"
ops_log "trading release staged at ${TARGET_COMMIT}; daemon restart count: 0"
