#!/usr/bin/env bash

# Fixed operator-approved LIVE policy for the V96 + V52 release boundary.
# This is sourced after systemd EnvironmentFile values so stale VPS overrides
# cannot silently restore an incompatible Gross, leverage, monitoring or SHADOW setup.

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

  export PENGU_DUAL_LS_V1_MODE=LIVE
  export PENGU_DUAL_LS_V1_ENABLED=true
  export PENGU_DUAL_LS_V1_LIVE_TRADING_ENABLED=true
  export PENGU_DUAL_LS_V1_LIVE_EXECUTION_ENABLED=true
  export PENGU_DUAL_LS_V1_MAX_GROSS=0.75
  export PENGU_DUAL_LS_V1_PORTFOLIO_GROSS_CAP=1.5
  export PENGU_DUAL_LS_V1_MAX_DAILY_LOSS_PCT=5
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
  [[ "${PENGU_DUAL_LS_V1_MODE:-}" == "LIVE" ]] || {
    printf 'fixed policy mismatch: PENGU_DUAL_LS_V1_MODE\n' >&2
    return 1
  }
  [[ "${PENGU_DUAL_LS_V1_ENABLED:-}" == "true" ]] || return 1
  [[ "${PENGU_DUAL_LS_V1_LIVE_TRADING_ENABLED:-}" == "true" ]] || return 1
  [[ "${PENGU_DUAL_LS_V1_LIVE_EXECUTION_ENABLED:-}" == "true" ]] || return 1
  [[ "${PENGU_DUAL_LS_V1_MAX_GROSS:-}" == "0.75" ]] || return 1
  [[ "${PENGU_DUAL_LS_V1_PORTFOLIO_GROSS_CAP:-}" == "1.5" ]] || return 1
  [[ "${PENGU_DUAL_LS_V1_MAX_DAILY_LOSS_PCT:-}" == "5" ]] || return 1
}
