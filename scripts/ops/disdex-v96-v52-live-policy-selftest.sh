#!/usr/bin/env bash
set -Eeuo pipefail

umask 077
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
policy="$root/scripts/ops/disdex-v96-v52-live-policy.sh"
[[ -f "$policy" && ! -L "$policy" ]]
# shellcheck source=scripts/ops/disdex-v96-v52-live-policy.sh
source "$policy"

# Deliberately simulate stale and unsafe VPS EnvironmentFile entries.
export DISDEX_V96_MAX_GROSS=2.5
export DISDEX_V96_INITIAL_PENGU_GROSS=0.15
export DISDEX_V96_MAX_DAILY_LOSS_PCT=2
export DISDEX_V96_V52_REQUIRED_INITIAL_LEVERAGE=1
export DISDEX_V96_V52_MAX_INITIAL_MARGIN_FRACTION=1
export DISDEX_V96_V52_MIN_AVAILABLE_BALANCE_FRACTION=0
export DISDEX_V52_CRYPTO_GROSS_CAP=2.5
export DISDEX_V52_STOCK_GROSS_CAP=0
export DISDEX_V52_PORTFOLIO_GROSS_CAP=1
export DISDEX_V52_RESERVED_FIRST_STOCK_GROSS=0
export DISDEX_V52_MINIMUM_SECOND_STOCK_GROSS=0
export DISDEX_V52_MAX_CONCURRENT_STOCK_POSITIONS=1
export PENGU_DUAL_LS_V1_MODE=SHADOW
export PENGU_DUAL_LS_V1_ENABLED=false
export PENGU_DUAL_LS_V1_LIVE_TRADING_ENABLED=false
export PENGU_DUAL_LS_V1_LIVE_EXECUTION_ENABLED=false
export PENGU_DUAL_LS_V1_MAX_GROSS=0.10
export PENGU_DUAL_LS_V1_PORTFOLIO_GROSS_CAP=2.5
export PENGU_DUAL_LS_V1_MAX_DAILY_LOSS_PCT=2

disdex_apply_v96_v52_fixed_live_policy
disdex_assert_v96_v52_fixed_live_policy

printf 'DISDEX_V96_V52_FIXED_LIVE_POLICY_SELFTEST_PASS\n'
printf 'staleEnvironmentOverridden=true\n'
printf 'v96CryptoSleeveGross=%s\n' "$DISDEX_V96_MAX_GROSS"
printf 'stockSleeveGross=%s\n' "$DISDEX_V52_STOCK_GROSS_CAP"
printf 'combinedPortfolioGross=%s\n' "$DISDEX_V52_PORTFOLIO_GROSS_CAP"
printf 'reservedFirstStockGross=%s\n' "$DISDEX_V52_RESERVED_FIRST_STOCK_GROSS"
printf 'minimumSecondStockGross=%s\n' "$DISDEX_V52_MINIMUM_SECOND_STOCK_GROSS"
printf 'maximumConcurrentStockPositions=%s\n' "$DISDEX_V52_MAX_CONCURRENT_STOCK_POSITIONS"
printf 'requiredInitialLeverage=%s\n' "$DISDEX_V96_V52_REQUIRED_INITIAL_LEVERAGE"
printf 'maximumInitialMarginFraction=%s\n' "$DISDEX_V96_V52_MAX_INITIAL_MARGIN_FRACTION"
printf 'minimumAvailableBalanceFraction=%s\n' "$DISDEX_V96_V52_MIN_AVAILABLE_BALANCE_FRACTION"
printf 'initialPenguGrossCap=%s\n' "$DISDEX_V96_INITIAL_PENGU_GROSS"
printf 'maximumDailyLossPct=%s\n' "$DISDEX_V96_MAX_DAILY_LOSS_PCT"
printf 'penguDualMode=%s\n' "$PENGU_DUAL_LS_V1_MODE"
printf 'penguDualEnabled=%s\n' "$PENGU_DUAL_LS_V1_ENABLED"
printf 'penguDualLiveTradingEnabled=%s\n' "$PENGU_DUAL_LS_V1_LIVE_TRADING_ENABLED"
printf 'penguDualLiveExecutionEnabled=%s\n' "$PENGU_DUAL_LS_V1_LIVE_EXECUTION_ENABLED"
printf 'ordersSent=false\n'
printf 'cancelSent=false\n'
printf 'positionChangesSent=false\n'
