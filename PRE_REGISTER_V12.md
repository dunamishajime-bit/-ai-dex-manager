# PENGU Short V12 pre-registration

RESEARCH ONLY. This candidate is defined before any Gate PENGU performance data is fetched.

## Single candidate

`RAPID_RISKON_RELATIVE_WEAKNESS_REENTRY`

V12 keeps the frozen V11 progression-failure exit and every current PENGU base opportunity. The only change is the V11 re-entry authorization:

1. Existing V11 conditions still must hold: PENGU re-breaks the failure episode low and closes below EMA72.
2. The re-break must occur within the first quarter of the existing short lifecycle: `PENGU_DUAL_LS_V2.short.maxHoldHours / 4` from the original entry. With the frozen current config this is 72h / 4 = 18h. This is not a swept threshold.
3. At the re-entry signal, `btcReturn24h >= 0`. This is a structural relative-weakness requirement: PENGU must make a fresh low while BTC is non-negative over 24h.

No RSI threshold changes. No ATR threshold sweep. No entry filtering. No removal of current PENGU base opportunities. No direction changes. Candidate count = 1.

## Evaluation

Development/confirmation venues: OKX and Binance, same 2024-12-24 to 2026-08-01 period and same Normal/Severe costs used for frozen V11.

Untouched final holdout: Gate PENGU_USDT perpetual, same period. Gate data must not be inspected before this pre-registration commit.

## Promotion gate

For each venue independently:
- baseline trades >= 20
- candidate trades >= baseline trades
- >= 2 V12 re-entries
- win rate >= baseline +5 percentage points
- Normal Return >= baseline
- Normal PF >= baseline
- Normal DD no worse
- Severe Return >= baseline
- Severe PF >= baseline
- Severe DD no worse
- improvement remains after removing the single best V12 re-entry
- at least 3/4 chronological folds have non-worse win rate
- at least 3/4 chronological folds have non-worse Return

Final promotion requires OKX AND Binance AND untouched Gate all PASS. If Gate fails, the rule is not adjusted on Gate.

Safety: RESEARCH_ONLY. No LIVE, VPS, orders, or production changes.
