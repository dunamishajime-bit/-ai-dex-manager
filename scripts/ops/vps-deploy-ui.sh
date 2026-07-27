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
ops_require_env TARGET_COMMIT
ops_validate_sha "$TARGET_COMMIT"
ops_require_absolute_path VPS_APP_DIR
ops_require_absolute_path VPS_OPS_STATE_DIR
ops_require_absolute_path VPS_REPORT_DIR
ops_require_env VPS_UI_SERVICE_MANAGER
ops_require_env VPS_UI_SERVICE
ops_require_env VPS_UI_HEALTH_URL
ops_require_env VPS_API_HEALTH_URL
ops_validate_service_name "$VPS_UI_SERVICE"

mkdir -p "$VPS_REPORT_DIR"
chmod 700 "$VPS_REPORT_DIR" 2>/dev/null || true
ops_acquire_global_lock
ops_assert_repository
ops_assert_clean_tracked_tree

PREVIOUS_SHA="$(ops_current_sha)"
DEPLOYMENT_STARTED=false
ROLLBACK_ATTEMPTED=false
ROLLBACK_SUCCEEDED=false
UI_RELOAD_ATTEMPTED=false
UI_HTTP_STATUS=0
API_HTTP_STATUS=0

write_report() {
  local status="$1"
  local message="$2"
  ops_json_report "${VPS_REPORT_DIR}/ui-deploy.json" \
    "schemaVersion=1" \
    "generatedAt=$(ops_now)" \
    "status=${status}" \
    "message=${message}" \
    "targetCommit=${TARGET_COMMIT}" \
    "previousCommit=${PREVIOUS_SHA}" \
    "deployedCommit=$(ops_current_sha 2>/dev/null || true)" \
    "uiReloadAttempted=${UI_RELOAD_ATTEMPTED}" \
    "tradingRestartAttempted=false" \
    "ordersSent=false" \
    "positionsChanged=false" \
    "runtimeStateEdited=false" \
    "rollbackAttempted=${ROLLBACK_ATTEMPTED}" \
    "rollbackSucceeded=${ROLLBACK_SUCCEEDED}" \
    "uiHttpStatus=${UI_HTTP_STATUS}" \
    "apiHttpStatus=${API_HTTP_STATUS}"

  cat >"${VPS_REPORT_DIR}/ui-deploy.md" <<EOF
# VPS UI deployment

- Status: **${status}**
- Message: ${message}
- Target SHA: \`${TARGET_COMMIT}\`
- Previous SHA: \`${PREVIOUS_SHA}\`
- Current SHA: \`$(ops_current_sha 2>/dev/null || printf 'unknown')\`
- UI reload attempted: ${UI_RELOAD_ATTEMPTED}
- Trading restart attempted: false
- UI HTTP: ${UI_HTTP_STATUS}
- API HTTP: ${API_HTTP_STATUS}
- Rollback attempted: ${ROLLBACK_ATTEMPTED}
- Rollback succeeded: ${ROLLBACK_SUCCEEDED}
- Orders sent: false
- Positions changed: false
- Runtime state edited: false
EOF
  chmod 600 "${VPS_REPORT_DIR}/ui-deploy.md"
}

rollback_on_error() {
  local exit_code="$1"
  trap - ERR
  set +e
  ROLLBACK_ATTEMPTED=true
  ops_log "UI deployment failed; rolling source back to ${PREVIOUS_SHA}"

  if [[ "$DEPLOYMENT_STARTED" == true ]]; then
    git -C "$VPS_APP_DIR" checkout --detach --force "$PREVIOUS_SHA"
    (
      cd "$VPS_APP_DIR"
      timeout --preserve-status "${VPS_COMMAND_TIMEOUT:-30m}" npm ci --no-audit --no-fund &&
      timeout --preserve-status "${VPS_COMMAND_TIMEOUT:-30m}" npm run build
    )
    if [[ $? -eq 0 ]]; then
      ops_reload_ui "$VPS_UI_SERVICE_MANAGER" "$VPS_UI_SERVICE"
      if [[ $? -eq 0 ]]; then
        UI_RELOAD_ATTEMPTED=true
        UI_HTTP_STATUS="$(ops_http_code "$VPS_UI_HEALTH_URL" 2>/dev/null || printf '0')"
        API_HTTP_STATUS="$(ops_http_code "$VPS_API_HEALTH_URL" 2>/dev/null || printf '0')"
        if [[ "$UI_HTTP_STATUS" =~ ^2[0-9][0-9]$ && "$API_HTTP_STATUS" =~ ^2[0-9][0-9]$ ]]; then
          ROLLBACK_SUCCEEDED=true
        fi
      fi
    fi
  fi

  write_report "FAILED_ROLLED_BACK" "deployment failed with exit code ${exit_code}"
  exit "$exit_code"
}

trap 'rollback_on_error $?' ERR

ops_log "deploying UI exact SHA ${TARGET_COMMIT}; trading daemon will not be touched"
DEPLOYMENT_STARTED=true
ops_checkout_exact_sha "$TARGET_COMMIT"

ops_run_in_app "npm ci" npm ci --no-audit --no-fund
ops_run_in_app "typecheck" npm run typecheck
ops_run_in_app "UI build" npm run build

UI_RELOAD_ATTEMPTED=true
ops_reload_ui "$VPS_UI_SERVICE_MANAGER" "$VPS_UI_SERVICE"

UI_HTTP_STATUS="$(ops_http_code "$VPS_UI_HEALTH_URL")"
API_HTTP_STATUS="$(ops_http_code "$VPS_API_HEALTH_URL")"
[[ "$UI_HTTP_STATUS" =~ ^2[0-9][0-9]$ ]] || ops_die "UI health failed with HTTP ${UI_HTTP_STATUS}"
[[ "$API_HTTP_STATUS" =~ ^2[0-9][0-9]$ ]] || ops_die "API health failed with HTTP ${API_HTTP_STATUS}"

ops_write_sha_file "${VPS_OPS_STATE_DIR}/ui-last-good.sha" "$TARGET_COMMIT"
write_report "PASS" "UI deployed and health checks passed"
ops_log "UI deployment passed at ${TARGET_COMMIT}; trading daemon restart count: 0"
