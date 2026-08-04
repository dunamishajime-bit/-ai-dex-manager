#!/usr/bin/env bash

# Fixed operator-approved LIVE policy for the V96 + V52 release boundary.
# This is sourced after systemd EnvironmentFile values so stale VPS overrides
# cannot silently restore the historical Gross 2.5 / SHADOW configuration.

disdex_apply_v96_v52_fixed_live_policy() {
  export DISDEX_V96_MAX_GROSS=1
  export DISDEX_V96_INITIAL_PENGU_GROSS=1.15
  export DISDEX_V96_MAX_DAILY_LOSS_PCT=5

  export PENGU_DUAL_LS_V1_MODE=LIVE
  export PENGU_DUAL_LS_V1_ENABLED=true
  export PENGU_DUAL_LS_V1_LIVE_TRADING_ENABLED=true
  export PENGU_DUAL_LS_V1_LIVE_EXECUTION_ENABLED=true
  export PENGU_DUAL_LS_V1_MAX_GROSS=0.75
  export PENGU_DUAL_LS_V1_PORTFOLIO_GROSS_CAP=1
  export PENGU_DUAL_LS_V1_MAX_DAILY_LOSS_PCT=5
}

disdex_assert_v96_v52_fixed_live_policy() {
  [[ "${DISDEX_V96_MAX_GROSS:-}" == "1" ]] || {
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
  [[ "${PENGU_DUAL_LS_V1_MODE:-}" == "LIVE" ]] || {
    printf 'fixed policy mismatch: PENGU_DUAL_LS_V1_MODE\n' >&2
    return 1
  }
  [[ "${PENGU_DUAL_LS_V1_ENABLED:-}" == "true" ]] || {
    printf 'fixed policy mismatch: PENGU_DUAL_LS_V1_ENABLED\n' >&2
    return 1
  }
  [[ "${PENGU_DUAL_LS_V1_LIVE_TRADING_ENABLED:-}" == "true" ]] || {
    printf 'fixed policy mismatch: PENGU_DUAL_LS_V1_LIVE_TRADING_ENABLED\n' >&2
    return 1
  }
  [[ "${PENGU_DUAL_LS_V1_LIVE_EXECUTION_ENABLED:-}" == "true" ]] || {
    printf 'fixed policy mismatch: PENGU_DUAL_LS_V1_LIVE_EXECUTION_ENABLED\n' >&2
    return 1
  }
  [[ "${PENGU_DUAL_LS_V1_MAX_GROSS:-}" == "0.75" ]] || {
    printf 'fixed policy mismatch: PENGU_DUAL_LS_V1_MAX_GROSS\n' >&2
    return 1
  }
  [[ "${PENGU_DUAL_LS_V1_PORTFOLIO_GROSS_CAP:-}" == "1" ]] || {
    printf 'fixed policy mismatch: PENGU_DUAL_LS_V1_PORTFOLIO_GROSS_CAP\n' >&2
    return 1
  }
  [[ "${PENGU_DUAL_LS_V1_MAX_DAILY_LOSS_PCT:-}" == "5" ]] || {
    printf 'fixed policy mismatch: PENGU_DUAL_LS_V1_MAX_DAILY_LOSS_PCT\n' >&2
    return 1
  }
}
