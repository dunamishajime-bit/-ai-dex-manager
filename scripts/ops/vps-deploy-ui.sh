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
ops_require_command tar
ops_require_command readlink
ops_require_env TARGET_COMMIT
ops_validate_sha "$TARGET_COMMIT"
ops_require_atomic_layout
ops_require_absolute_path VPS_SOURCE_REPO_DIR
ops_require_absolute_path VPS_UI_RELEASES_DIR
ops_require_absolute_path VPS_UI_CURRENT_LINK
ops_require_absolute_path VPS_UI_SHARED_ENV_FILE
ops_require_absolute_path VPS_OPS_STATE_DIR
ops_require_absolute_path VPS_REPORT_DIR
ops_require_env VPS_UI_SERVICE_MANAGER
ops_require_env VPS_UI_SERVICE
ops_require_env VPS_UI_HEALTH_URL
ops_require_env VPS_API_HEALTH_URL
ops_validate_service_name "$VPS_UI_SERVICE"
[[ -f "$VPS_UI_SHARED_ENV_FILE" ]] || ops_die "VPS_UI_SHARED_ENV_FILE does not exist"

mkdir -p "$VPS_REPORT_DIR"
chmod 700 "$VPS_REPORT_DIR" 2>/dev/null || true
ops_acquire_global_lock
ops_assert_source_repository
ops_assert_clean_source_tree
ops_assert_service_working_directory "$VPS_UI_SERVICE_MANAGER" "$VPS_UI_SERVICE" "$VPS_UI_CURRENT_LINK"

PREVIOUS_RELEASE="$(ops_link_target "$VPS_UI_CURRENT_LINK" 2>/dev/null || true)"
PREVIOUS_SHA="$(ops_link_release_sha "$VPS_UI_CURRENT_LINK" 2>/dev/null || true)"
[[ -n "$PREVIOUS_RELEASE" && -n "$PREVIOUS_SHA" ]] || ops_die "UI current link is not initialized to a valid release"
ops_validate_sha "$PREVIOUS_SHA"

NEW_RELEASE=""
CURRENT_SWITCHED=false
ROLLBACK_ATTEMPTED=false
ROLLBACK_SUCCEEDED=false
UI_RELOAD_ATTEMPTED=false
UI_HTTP_STATUS=0
API_HTTP_STATUS=0

write_report() {
  local status="$1"
  local message="$2"
  local current_release current_sha
  current_release="$(ops_link_target "$VPS_UI_CURRENT_LINK" 2>/dev/null || true)"
  current_sha="$(ops_link_release_sha "$VPS_UI_CURRENT_LINK" 2>/dev/null || true)"
  ops_json_report "${VPS_REPORT_DIR}/ui-deploy.json" \
    "schemaVersion=2" \
    "generatedAt=$(ops_now)" \
    "status=${status}" \
    "message=${message}" \
    "deploymentLayoutMode=${VPS_DEPLOYMENT_LAYOUT_MODE}" \
    "targetCommit=${TARGET_COMMIT}" \
    "previousCommit=${PREVIOUS_SHA}" \
    "previousRelease=${PREVIOUS_RELEASE}" \
    "currentCommit=${current_sha}" \
    "currentRelease=${current_release}" \
    "uiReloadAttempted=${UI_RELOAD_ATTEMPTED}" \
    "tradingRestartAttempted=false" \
    "ordersSent=false" \
    "positionsChanged=false" \
    "runtimeStateEdited=false" \
    "rollbackAttempted=${ROLLBACK_ATTEMPTED}" \
    "rollbackSucceeded=${ROLLBACK_SUCCEEDED}" \
    "uiHttpStatus=${UI_HTTP_STATUS}" \
    "apiHttpStatus=${API_HTTP_STATUS}"

  cat >"${VPS_REPORT_DIR}/ui-deploy.md" <<EOF_MD
# VPS UI atomic deployment

- Status: **${status}**
- Message: ${message}
- Layout: ${VPS_DEPLOYMENT_LAYOUT_MODE}
- Target SHA: \`${TARGET_COMMIT}\`
- Previous SHA: \`${PREVIOUS_SHA}\`
- Current SHA: \`${current_sha:-unknown}\`
- Previous release: \`${PREVIOUS_RELEASE}\`
- Current release: \`${current_release:-unknown}\`
- UI reload attempted: ${UI_RELOAD_ATTEMPTED}
- Trading restart attempted: false
- UI HTTP: ${UI_HTTP_STATUS}
- API HTTP: ${API_HTTP_STATUS}
- Rollback attempted: ${ROLLBACK_ATTEMPTED}
- Rollback succeeded: ${ROLLBACK_SUCCEEDED}
- Orders sent: false
- Positions changed: false
- Runtime state edited: false
EOF_MD
  chmod 600 "${VPS_REPORT_DIR}/ui-deploy.md"
}

rollback_on_error() {
  local exit_code="$1"
  trap - ERR
  set +e
  if [[ "$CURRENT_SWITCHED" == true ]]; then
    ROLLBACK_ATTEMPTED=true
    ops_log "UI deployment failed; restoring current link to ${PREVIOUS_RELEASE}"
    ops_atomic_symlink "$PREVIOUS_RELEASE" "$VPS_UI_CURRENT_LINK"
    UI_RELOAD_ATTEMPTED=true
    if ops_reload_ui "$VPS_UI_SERVICE_MANAGER" "$VPS_UI_SERVICE"; then
      UI_HTTP_STATUS="$(ops_http_code "$VPS_UI_HEALTH_URL" 2>/dev/null || printf '0')"
      API_HTTP_STATUS="$(ops_http_code "$VPS_API_HEALTH_URL" 2>/dev/null || printf '0')"
      if [[ "$UI_HTTP_STATUS" =~ ^2[0-9][0-9]$ && "$API_HTTP_STATUS" =~ ^2[0-9][0-9]$ && "$(ops_link_release_sha "$VPS_UI_CURRENT_LINK" 2>/dev/null)" == "$PREVIOUS_SHA" ]]; then
        ROLLBACK_SUCCEEDED=true
      fi
    fi
  fi
  write_report "FAILED" "atomic UI deployment failed with exit code ${exit_code}"
  exit "$exit_code"
}
trap 'rollback_on_error $?' ERR

ops_log "materializing UI release for exact SHA ${TARGET_COMMIT}; trading daemon will not be touched"
NEW_RELEASE="$(ops_prepare_release "$TARGET_COMMIT" "$VPS_UI_RELEASES_DIR")"
ops_link_shared_path "$VPS_UI_SHARED_ENV_FILE" "${NEW_RELEASE}/.env.local"

ops_run_in_dir "$NEW_RELEASE" "npm ci" npm ci --no-audit --no-fund
ops_run_in_dir "$NEW_RELEASE" "typecheck" npm run typecheck
ops_run_in_dir "$NEW_RELEASE" "UI build" npm run build
[[ "$(ops_release_sha "$NEW_RELEASE")" == "$TARGET_COMMIT" ]] || ops_die "release marker changed during build"

ops_atomic_symlink "$NEW_RELEASE" "$VPS_UI_CURRENT_LINK"
CURRENT_SWITCHED=true
[[ "$(ops_link_release_sha "$VPS_UI_CURRENT_LINK")" == "$TARGET_COMMIT" ]] || ops_die "UI current link did not switch to target SHA"

UI_RELOAD_ATTEMPTED=true
ops_reload_ui "$VPS_UI_SERVICE_MANAGER" "$VPS_UI_SERVICE"
UI_HTTP_STATUS="$(ops_http_code "$VPS_UI_HEALTH_URL")"
API_HTTP_STATUS="$(ops_http_code "$VPS_API_HEALTH_URL")"
[[ "$UI_HTTP_STATUS" =~ ^2[0-9][0-9]$ ]] || ops_die "UI health failed with HTTP ${UI_HTTP_STATUS}"
[[ "$API_HTTP_STATUS" =~ ^2[0-9][0-9]$ ]] || ops_die "API health failed with HTTP ${API_HTTP_STATUS}"

ops_write_sha_file "${VPS_OPS_STATE_DIR}/ui-last-good.sha" "$TARGET_COMMIT"
write_report "PASS" "UI release switched atomically and health checks passed"
ops_log "UI atomic deployment passed at ${TARGET_COMMIT}; trading daemon restart count: 0"
