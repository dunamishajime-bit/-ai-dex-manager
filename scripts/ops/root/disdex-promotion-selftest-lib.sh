#!/usr/bin/env bash

# Full promotion failure-injection harness. It is sourced only by the fixed
# trading-promote-selftest action and rewrites every mutable path into /tmp.
# It never connects to Aster, systemd, or production approval/state paths.

write_fake_systemctl() {
  local path="$1"
  cat > "$path" <<'SCRIPT'
#!/usr/bin/env bash
set -Eeuo pipefail
cmd="${1:-}"; shift || true
service="${1:-}"
case "$cmd" in
  is-active)
    cat "$DISDEX_TEST_SERVICE_STATE"
    ;;
  show)
    property=""
    for arg in "$@"; do
      case "$arg" in
        --property) shift || true ;;
        MainPID|Result|ExecMainStatus|NRestarts) property="$arg" ;;
      esac
    done
    if [[ "$service" == "$DISDEX_TEST_TRADING_SERVICE" ]]; then
      case "$property" in
        MainPID) cat "$DISDEX_TEST_SERVICE_PID" ;;
        NRestarts) cat "$DISDEX_TEST_SERVICE_RESTARTS" ;;
        Result) printf 'success\n' ;;
        ExecMainStatus) printf '0\n' ;;
      esac
    else
      case "$property" in
        Result) printf 'success\n' ;;
        ExecMainStatus) printf '0\n' ;;
        *) printf '0\n' ;;
      esac
    fi
    ;;
  reset-failed) exit 0 ;;
  stop)
    printf 'inactive\n' > "$DISDEX_TEST_SERVICE_STATE"
    printf '0\n' > "$DISDEX_TEST_SERVICE_PID"
    ;;
  start)
    if [[ "$service" == "$DISDEX_TEST_TRADING_SERVICE" ]]; then
      if [[ "$DISDEX_TEST_SCENARIO" == "service-start" ]]; then
        printf 'active\n' > "$DISDEX_TEST_SERVICE_STATE"
        printf '4242\n' > "$DISDEX_TEST_SERVICE_PID"
        exit 1
      fi
      printf 'active\n' > "$DISDEX_TEST_SERVICE_STATE"
      printf '4242\n' > "$DISDEX_TEST_SERVICE_PID"
      exit 0
    fi
    if [[ "$service" == "$DISDEX_TEST_APPROVAL_UNIT" ]]; then
      printf '{"productionCommitSha":"%s","kind":"parity"}\n' "$DISDEX_TEST_NEW_SHA" > "$DISDEX_TEST_PARITY_FILE"
      printf '{"approvedCommitSha":"%s","kind":"override"}\n' "$DISDEX_TEST_NEW_SHA" > "$DISDEX_TEST_OVERRIDE_FILE"
      printf '{"approvedCommitSha":"%s","kind":"crypto"}\n' "$DISDEX_TEST_NEW_SHA" > "$DISDEX_TEST_CRYPTO_STATE_FILE"
      printf '{"approvedCommitSha":"%s","kind":"stock"}\n' "$DISDEX_TEST_NEW_SHA" > "$DISDEX_TEST_STOCK_STATE_FILE"
      [[ "$DISDEX_TEST_SCENARIO" != "before-switch" ]]
      exit
    fi
    if [[ "$service" == "$DISDEX_TEST_PREFLIGHT_UNIT" ]]; then
      count="$(cat "$DISDEX_TEST_PREFLIGHT_COUNT")"
      count=$((count + 1))
      printf '%s\n' "$count" > "$DISDEX_TEST_PREFLIGHT_COUNT"
      current="$(readlink -f "$DISDEX_TEST_CURRENT")"
      if [[ "$DISDEX_TEST_SCENARIO" == "post-switch-preflight" && "$current" == "$DISDEX_TEST_NEW_RELEASE" ]]; then
        exit 1
      fi
      exit 0
    fi
    exit 1
    ;;
  *) exit 2 ;;
esac
SCRIPT
  chmod 0700 "$path"
}

write_fake_journalctl() {
  local path="$1"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$path"
  chmod 0700 "$path"
}

setup_promotion_selftest_sandbox() {
  local scenario="$1"
  local old_sha="1111111111111111111111111111111111111111"
  local new_sha="2222222222222222222222222222222222222222"
  promotion_selftest_mode=true
  promotion_selftest_scenario="$scenario"
  promotion_selftest_root="$(mktemp -d /tmp/disdex-promotion-selftest.${scenario}.XXXXXX)"
  TRADING_ROOT="$promotion_selftest_root/trading"
  TRADING_RELEASES="$TRADING_ROOT/releases"
  TRADING_CURRENT="$TRADING_ROOT/current"
  SHARED_ROOT="$promotion_selftest_root/shared"
  SHARED_APPROVAL_ROOT="$SHARED_ROOT/approval"
  SHARED_STATE_ROOT="$SHARED_ROOT/state"
  PARITY_FILE="$SHARED_APPROVAL_ROOT/disdex-v96-parity.json"
  OVERRIDE_FILE="$SHARED_APPROVAL_ROOT/disdex-v96-operator-override.json"
  CRYPTO_STATE_FILE="$SHARED_STATE_ROOT/crypto-v96/runner-live.json"
  STOCK_STATE_FILE="$SHARED_STATE_ROOT/stock/runner-live.json"
  PROMOTION_ROOT="$promotion_selftest_root/transactions"
  PROMOTION_LOCK="$promotion_selftest_root/promotion.lock"
  mkdir -p "$TRADING_RELEASES/$old_sha" "$TRADING_RELEASES/$new_sha" \
    "$SHARED_APPROVAL_ROOT" "$(dirname "$CRYPTO_STATE_FILE")" "$(dirname "$STOCK_STATE_FILE")" \
    "$promotion_selftest_root/bin"
  printf '%s\n' "$old_sha" > "$TRADING_RELEASES/$old_sha/.disdex-release-sha"
  printf '%s\n' "$new_sha" > "$TRADING_RELEASES/$new_sha/.disdex-release-sha"
  ln -s "$TRADING_RELEASES/$old_sha" "$TRADING_CURRENT"
  printf '{"productionCommitSha":"%s","kind":"parity"}\n' "$old_sha" > "$PARITY_FILE"
  printf '{"approvedCommitSha":"%s","kind":"override"}\n' "$old_sha" > "$OVERRIDE_FILE"
  printf '{"operatorOverride":{"approvedCommitSha":"%s"},"kind":"crypto"}\n' "$old_sha" > "$CRYPTO_STATE_FILE"
  printf '{"approvedCommitSha":"%s","kind":"stock"}\n' "$old_sha" > "$STOCK_STATE_FILE"
  printf 'inactive\n' > "$promotion_selftest_root/service-state"
  printf '0\n' > "$promotion_selftest_root/service-pid"
  printf '0\n' > "$promotion_selftest_root/service-restarts"
  printf '0\n' > "$promotion_selftest_root/preflight-count"
  export DISDEX_TEST_SERVICE_STATE="$promotion_selftest_root/service-state"
  export DISDEX_TEST_SERVICE_PID="$promotion_selftest_root/service-pid"
  export DISDEX_TEST_SERVICE_RESTARTS="$promotion_selftest_root/service-restarts"
  export DISDEX_TEST_PREFLIGHT_COUNT="$promotion_selftest_root/preflight-count"
  export DISDEX_TEST_TRADING_SERVICE="$TRADING_SERVICE"
  export DISDEX_TEST_SCENARIO="$scenario"
  export DISDEX_TEST_PARITY_FILE="$PARITY_FILE"
  export DISDEX_TEST_OVERRIDE_FILE="$OVERRIDE_FILE"
  export DISDEX_TEST_CRYPTO_STATE_FILE="$CRYPTO_STATE_FILE"
  export DISDEX_TEST_STOCK_STATE_FILE="$STOCK_STATE_FILE"
  export DISDEX_TEST_CURRENT="$TRADING_CURRENT"
  export DISDEX_TEST_OLD_SHA="$old_sha"
  export DISDEX_TEST_NEW_SHA="$new_sha"
  export DISDEX_TEST_NEW_RELEASE="$TRADING_RELEASES/$new_sha"
  export DISDEX_TEST_APPROVAL_UNIT="${APPROVAL_PREFIX}@${new_sha}.service"
  export DISDEX_TEST_PREFLIGHT_UNIT="${PREFLIGHT_PREFIX}@${new_sha}.service"
  SYSTEMCTL="$promotion_selftest_root/bin/systemctl"
  JOURNALCTL="$promotion_selftest_root/bin/journalctl"
  write_fake_systemctl "$SYSTEMCTL"
  write_fake_journalctl "$JOURNALCTL"
  promotion_transaction_dir=""
  promotion_rollback_armed=false
  promotion_success=false
  promotion_target_sha=""
  promotion_old_sha=""
  promotion_lock_fd=""
  printf '%s' "$new_sha"
}

assert_promotion_selftest_isolated() {
  local path
  [[ "$promotion_selftest_mode" == "true" ]]
  [[ "$promotion_selftest_root" == /tmp/disdex-promotion-selftest.* ]]
  for path in "$TRADING_ROOT" "$TRADING_RELEASES" "$TRADING_CURRENT" "$SHARED_ROOT" \
    "$SHARED_APPROVAL_ROOT" "$SHARED_STATE_ROOT" "$PARITY_FILE" "$OVERRIDE_FILE" \
    "$CRYPTO_STATE_FILE" "$STOCK_STATE_FILE" "$PROMOTION_ROOT" "$PROMOTION_LOCK" \
    "$SYSTEMCTL" "$JOURNALCTL"; do
    [[ "$path" == "$promotion_selftest_root"/* ]] || {
      printf 'promotion selftest path escaped sandbox: %s\n' "$path" >&2
      return 1
    }
  done
}

verify_promotion_selftest_rollback() {
  local expected_old="$TRADING_RELEASES/1111111111111111111111111111111111111111"
  [[ "$(readlink -f "$TRADING_CURRENT")" == "$expected_old" ]]
  grep -q '"productionCommitSha":"1111111111111111111111111111111111111111"' "$PARITY_FILE"
  grep -q '"approvedCommitSha":"1111111111111111111111111111111111111111"' "$OVERRIDE_FILE"
  grep -q '"operatorOverride":{"approvedCommitSha":"1111111111111111111111111111111111111111"}' "$CRYPTO_STATE_FILE"
  grep -q '"approvedCommitSha":"1111111111111111111111111111111111111111"' "$STOCK_STATE_FILE"
  [[ "$(cat "$promotion_selftest_root/service-state")" == "inactive" ]]
  [[ "$(cat "$promotion_selftest_root/service-pid")" == "0" ]]
}

run_promotion_selftest_scenario() {
  local scenario="$1"
  local sha status output output_file
  setup_promotion_selftest_sandbox "$scenario" >/dev/null
  sha="2222222222222222222222222222222222222222"
  assert_promotion_selftest_isolated
  output_file="$promotion_selftest_root/promotion-output.log"
  set +e
  ( set -e; execute_promotion "$sha" ) >"$output_file" 2>&1
  status=$?
  set -e
  output="$(cat "$output_file")"
  if [[ "$scenario" == "snapshot-tamper" ]]; then
    [[ "$status" == "70" ]] || { printf '%s\n' "$output" >&2; return 1; }
    grep -q 'DISDEX_V96_V52_PROMOTION_ROLLBACK_FAILED' <<< "$output"
    [[ "$(cat "$promotion_selftest_root/service-state")" == "inactive" ]]
    [[ "$(cat "$promotion_selftest_root/service-pid")" == "0" ]]
    find "$PROMOTION_ROOT" -mindepth 1 -maxdepth 1 -type d | grep -q .
    rm -rf "$promotion_selftest_root"
    printf 'promotionSelftest=%s PASS exitCode=70 transactionRetained=true\n' "$scenario"
    return 0
  fi
  [[ "$status" != "0" && "$status" != "70" ]] || { printf '%s\n' "$output" >&2; return 1; }
  grep -q 'DISDEX_V96_V52_PROMOTION_ROLLBACK_PASS' <<< "$output"
  verify_promotion_selftest_rollback
  rm -rf "$promotion_selftest_root"
  printf 'promotionSelftest=%s PASS currentRestored=true approvalRestored=true cryptoStateRestored=true stockStateRestored=true serviceInactive=true\n' "$scenario"
}

run_all_promotion_selftests() {
  local scenario
  for scenario in before-switch post-switch-preflight service-start snapshot-tamper; do
    run_promotion_selftest_scenario "$scenario"
  done
  printf 'DISDEX_V96_V52_FULL_PROMOTION_FAILURE_INJECTION_SELFTEST_PASS\n'
  printf 'productionPathsTouched=false\nordersSent=false\ncancelSent=false\npositionChangesSent=false\n'
}
