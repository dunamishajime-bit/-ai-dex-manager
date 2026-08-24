# PENGU V15 regime diagnostic pre-registration

RESEARCH ONLY. No LIVE/VPS/orders/production changes.

## Purpose
Diagnose why frozen V15 `COUNTERWIND_CLOSE_PROBATION_COST_FLOOR_RESUME` improves several chronological folds on OKX/Binance/Bitget but damages the same Q3 region and fails Gate diagnostic.

This run is diagnostic only. It must not change entry signals, position sizing, V15 progression-failure semantics, probation rules, transaction-cost assumptions, exits, or promotion rules.

## Frozen observations
For every V15 progression-failure-modified event on OKX, Binance, Gate, and Bitget, record only information available by the completed H1 bar being inspected:

- original entry timestamp and frozen baseline outcome
- progression-failure timestamp and delay from entry
- V15 probation decision reason: `RESUME`, `COST_FLOOR`, `DEADLINE`, or `ORIGINAL_EXIT`
- entry-signal, progression-failure, and decision snapshots:
  - PENGU 24h return
  - BTC 24h return
  - PENGU-vs-BTC relative 24h return
  - ATR24 ratio
  - 6h volume / prior-36h volume ratio
  - RSI14
  - BTC EMA168 distance
  - PENGU EMA72 distance
- mechanical trajectory deltas from entry signal to progression failure and to probation decision:
  - relative-return acceleration
  - BTC-return acceleration
  - ATR-ratio change
  - volume-ratio change
- V15 candidate account-return delta versus the untouched baseline event

No thresholds are introduced and no candidate is selected by this diagnostic.

## Interpretation contract
The diagnostic may identify a structural failure mode only if it is visible across multiple development/diagnostic venues or is the same timestamp-level event reproduced across venues. A single venue-specific feature value is not enough to define a new rule.

Any later candidate must be a new pre-registered structure, not a parameter adjustment to V12-V15, and must be tested on a performance-unobserved holdout venue after its pre-registration SHA exists.

## Safety
`mode=RESEARCH_ONLY`, `ordersSent=false`, `liveChanged=false`, `vpsChanged=false`, `productionChanged=false`.
