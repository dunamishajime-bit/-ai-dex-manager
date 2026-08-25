#!/usr/bin/env bash

# Fixed operator-approved LIVE policy for the V96 + V52 release boundary.
# This is sourced after systemd EnvironmentFile values so stale VPS overrides
# cannot silently restore an incompatible Gross, leverage, monitoring or SHADOW setup.

disdex_apply_v96_v52_shared_runtime_paths() {
  local shared_repo="/home/deploy/ai-dex-manager-v96-paper"
  local shared_state="$shared_repo/.runtime-state/disdex-v13d-v11eq-v96"
  local shared_approval="$shared_repo/.runtime-approval"
  local shared_kill_switch="$shared_state/kill-switch.json"

  export DISDEX_V13D_V11EQ_V96_COMBINED_STATE_ROOT="$shared_state"
  export DISDEX_V13D_V11EQ_V96_STATE_DIR="$shared_state"
  export DISDEX_V13D_V11EQ_V96_KILL_SWITCH_FILE="$shared_kill_switch"
  export DISDEX_V52_ASTER_ONLY_STATE_DIR="$shared_state/stock"
  export DISDEX_V52_ASTER_ONLY_KILL_SWITCH_FILE="$shared_kill_switch"
  export DISDEX_V96_STATE_DIR="$shared_state/crypto-v96"
  export DISDEX_V96_KILL_SWITCH_FILE="$shared_kill_switch"
  export PENGU_DUAL_LS_V2_STATE_DIR="$shared_state/crypto-v96/pengu-dual-ls-v2-final"
  export PENGU_DUAL_LS_V2_KILL_SWITCH_FILE="$shared_kill_switch"
  export DISDEX_V96_V52_MARGIN_GUARD_STATE_DIR="$shared_state/margin-risk"
  export DISDEX_V96_V52_MARGIN_GUARD_STATE_FILE="$shared_state/margin-risk/guard-live.json"
  export DISDEX_V96_FORWARD_EVIDENCE_FILE="$shared_approval/disdex-v96-forward.json"
  export DISDEX_V96_EXECUTION_PARITY_FILE="$shared_approval/disdex-v96-parity.json"
  export DISDEX_V96_OPERATOR_OVERRIDE_FILE="$shared_approval/disdex-v96-operator-override.json"
}

disdex_assert_v96_v52_shared_runtime_paths() {
  local expected_state="/home/deploy/ai-dex-manager-v96-paper/.runtime-state/disdex-v13d-v11eq-v96"
  local expected_kill_switch="$expected_state/kill-switch.json"
  [[ "${DISDEX_V13D_V11EQ_V96_COMBINED_STATE_ROOT:-}" == "$expected_state" ]] || return 1
  [[ "${DISDEX_V13D_V11EQ_V96_STATE_DIR:-}" == "$expected_state" ]] || return 1
  [[ "${DISDEX_V13D_V11EQ_V96_KILL_SWITCH_FILE:-}" == "$expected_kill_switch" ]] || return 1
  [[ "${DISDEX_V52_ASTER_ONLY_KILL_SWITCH_FILE:-}" == "$expected_kill_switch" ]] || return 1
  [[ "${DISDEX_V96_KILL_SWITCH_FILE:-}" == "$expected_kill_switch" ]] || return 1
  [[ "${PENGU_DUAL_LS_V2_KILL_SWITCH_FILE:-}" == "$expected_kill_switch" ]] || return 1
}

disdex_apply_v96_v52_fixed_live_policy() {
  export DISDEX_V96_MAX_GROSS=1.5
  export DISDEX_V96_INITIAL_PENGU_GROSS=1.15
  export DISDEX_V96_MAX_DAILY_LOSS_PCT=5
  export DISDEX_V96_V52_REQUIRED_INITIAL_LEVERAGE=5
  export DISDEX_V96_V52_MAX_INITIAL_MARGIN_FRACTION=0.70
  export DISDEX_V96_V52_MIN_AVAILABLE_BALANCE_FRACTION=0.20
  export DISDEX_V96_V52_PREORDER_MARGIN_GUARD_ENABLED=true
  export DISDEX_V96_V52_MARGIN_GUARD_SCRIPT=scripts/disdex_v96_v52_margin_guard_runtime.py

  export DISDEX_V52_CRYPTO_GROSS_CAP=1.5
  export DISDEX_V52_STOCK_GROSS_CAP=1.5
  export DISDEX_V52_PORTFOLIO_GROSS_CAP=2.5
  export DISDEX_V52_V11_GROSS_CAP=1
  export DISDEX_V52_V50_GROSS_CAP=1
  export DISDEX_V52_RESERVED_FIRST_STOCK_GROSS=1
  export DISDEX_V52_MINIMUM_FIRST_STOCK_GROSS=0.5
  export DISDEX_V52_MINIMUM_SECOND_STOCK_GROSS=0.25
  export DISDEX_V52_MAX_CONCURRENT_STOCK_POSITIONS=2
  export DISDEX_V52_MAX_DAILY_LOSS_PCT=3.5

  export PENGU_DUAL_LS_V1_ENABLED=false
  export PENGU_DUAL_LS_V1_LIVE_TRADING_ENABLED=false
  export PENGU_DUAL_LS_V1_LIVE_EXECUTION_ENABLED=false
  export PENGU_DUAL_LS_V2_MODE=LIVE
  export PENGU_DUAL_LS_V2_ENABLED=true
  export PENGU_DUAL_LS_V2_LIVE_TRADING_ENABLED=true
  export PENGU_DUAL_LS_V2_LIVE_EXECUTION_ENABLED=true
  export PENGU_DUAL_LS_V2_MAX_GROSS=0.9375
  export PENGU_DUAL_LS_V2_PORTFOLIO_GROSS_CAP=1.5
  export PENGU_DUAL_LS_V2_MAX_DAILY_LOSS_PCT=5
}

disdex_assert_v96_v52_fixed_live_policy() {
  [[ "${DISDEX_V96_MAX_GROSS:-}" == "1.5" ]] || {
    printf 'fixed policy mismatch: DISDEX_V96_MAX_GROSS\n' >&2
    return 1
  }
  [[ "${DISDEX_V96_INITIAL_PENGU_GROSS:-}" == "1.15" ]] || {
    printf 'fixed policy mismatch: DISDEX_V96_INITIAL_PENGU_GROSS\n' >&2
    return 1
  }
  [[ "${DISDEX_V96_MAX_DAILY_LOSS_PCT:-}" == "5" ]] || {
    printf 'fixed policy mismatch: DISDEX_V96_MAX_DAILY_LOSS_PCT\n' >&2
    return 1
  }
  [[ "${DISDEX_V96_V52_REQUIRED_INITIAL_LEVERAGE:-}" == "5" ]] || {
    printf 'fixed policy mismatch: DISDEX_V96_V52_REQUIRED_INITIAL_LEVERAGE\n' >&2
    return 1
  }
  [[ "${DISDEX_V96_V52_MAX_INITIAL_MARGIN_FRACTION:-}" == "0.70" ]] || {
    printf 'fixed policy mismatch: DISDEX_V96_V52_MAX_INITIAL_MARGIN_FRACTION\n' >&2
    return 1
  }
  [[ "${DISDEX_V96_V52_MIN_AVAILABLE_BALANCE_FRACTION:-}" == "0.20" ]] || {
    printf 'fixed policy mismatch: DISDEX_V96_V52_MIN_AVAILABLE_BALANCE_FRACTION\n' >&2
    return 1
  }
  [[ "${DISDEX_V96_V52_PREORDER_MARGIN_GUARD_ENABLED:-}" == "true" ]] || {
    printf 'fixed policy mismatch: DISDEX_V96_V52_PREORDER_MARGIN_GUARD_ENABLED\n' >&2
    return 1
  }
  [[ "${DISDEX_V96_V52_MARGIN_GUARD_SCRIPT:-}" == "scripts/disdex_v96_v52_margin_guard_runtime.py" ]] || {
    printf 'fixed policy mismatch: DISDEX_V96_V52_MARGIN_GUARD_SCRIPT\n' >&2
    return 1
  }
  [[ "${DISDEX_V52_CRYPTO_GROSS_CAP:-}" == "1.5" ]] || return 1
  [[ "${DISDEX_V52_STOCK_GROSS_CAP:-}" == "1.5" ]] || return 1
  [[ "${DISDEX_V52_PORTFOLIO_GROSS_CAP:-}" == "2.5" ]] || return 1
  [[ "${DISDEX_V52_RESERVED_FIRST_STOCK_GROSS:-}" == "1" ]] || return 1
  [[ "${DISDEX_V52_MINIMUM_SECOND_STOCK_GROSS:-}" == "0.25" ]] || return 1
  [[ "${DISDEX_V52_MAX_CONCURRENT_STOCK_POSITIONS:-}" == "2" ]] || return 1
  [[ "${PENGU_DUAL_LS_V1_ENABLED:-}" == "false" ]] || return 1
  [[ "${PENGU_DUAL_LS_V1_LIVE_TRADING_ENABLED:-}" == "false" ]] || return 1
  [[ "${PENGU_DUAL_LS_V1_LIVE_EXECUTION_ENABLED:-}" == "false" ]] || return 1
  [[ "${PENGU_DUAL_LS_V2_MODE:-}" == "LIVE" ]] || {
    printf 'fixed policy mismatch: PENGU_DUAL_LS_V2_MODE\n' >&2
    return 1
  }
  [[ "${PENGU_DUAL_LS_V2_ENABLED:-}" == "true" ]] || return 1
  [[ "${PENGU_DUAL_LS_V2_LIVE_TRADING_ENABLED:-}" == "true" ]] || return 1
  [[ "${PENGU_DUAL_LS_V2_LIVE_EXECUTION_ENABLED:-}" == "true" ]] || return 1
  [[ "${PENGU_DUAL_LS_V2_MAX_GROSS:-}" == "0.9375" ]] || return 1
  [[ "${PENGU_DUAL_LS_V2_PORTFOLIO_GROSS_CAP:-}" == "1.5" ]] || return 1
  [[ "${PENGU_DUAL_LS_V2_MAX_DAILY_LOSS_PCT:-}" == "5" ]] || return 1
}
