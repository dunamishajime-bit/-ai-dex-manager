# V12 Gate funding-retention addendum — pre-performance technical protocol

Gate's official funding history endpoint rejected historical requests before any Gate V12 performance result was produced with `INVALID_PARAM_VALUE: from time exceeds 180-day limit`.

No Gate V12 performance has been observed.

Therefore, before the first successful Gate V12 replay, the Gate validation is split into two pre-registered checks without changing the V12 trading logic:

## A. One-year price-edge holdout

- warm-up: 2025-07-10T00:00:00Z
- evaluation: 2025-08-01T00:00:00Z through 2026-08-01T00:00:00Z
- use Gate PENGU/BTC 1h candles
- set funding to zero for BOTH baseline and candidate
- retain the same trading fees and stress slippage as all other tests
- purpose: isolate whether the pre-registered V12 direction/exit/re-entry edge survives on the untouched Gate price path
- require the original strict Gate promotion conditions: candidate trades >= baseline, >=2 re-entries, win rate >= baseline +5pp, Normal Return/PF/DD non-worse, Severe Return/PF/DD non-worse, best-reentry removal still non-negative, and >=3/4 chronological folds non-worse for win rate and Return

## B. Actual-Gate-funding sub-holdout

- warm-up: 2026-02-01T00:00:00Z
- evaluation: 2026-03-01T00:00:00Z through 2026-08-01T00:00:00Z
- use actual Gate PENGU funding returned by the official endpoint plus Gate PENGU/BTC 1h candles
- V12 trading rule is unchanged
- because this is a shorter technical-cost sensitivity slice, do NOT require an additional +5pp win-rate increase or >=2 re-entries; instead require candidate trades >= baseline and every available Normal/Severe quality metric to be non-worse: win rate, Return, PF, DD. If no V12 re-entry occurs in this slice, the slice is neutral rather than evidence of improvement, but the one-year price-edge gate still must independently PASS.

Final Gate pass requires BOTH A and B to pass. Final V12 promotion still requires OKX AND Binance AND Gate.

No threshold sweep, no candidate changes, no entry filtering, no LIVE/VPS/orders/production changes. Candidate remains `RAPID_RISKON_RELATIVE_WEAKNESS_REENTRY` pre-registered at `2cfe0d7bb829e6cd928cef4871e1f0168c098506`.
