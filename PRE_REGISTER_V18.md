# PENGU Short V18 pre-registration

RESEARCH ONLY. No LIVE/VPS/orders/production changes.

## Candidate
`COUNTERWIND_REVERSIBLE_PROBATION_TO_DEADLINE`

Exactly one candidate. No threshold sweep, duration sweep, or parameter search.

## Diagnosis that motivates V18
Frozen V17 Gate trajectory diagnostic on the shared 2026-02-20 04:00 UTC event showed:
- progression failure on the entry bar;
- temporary structural-failure state at +5h and +6h;
- structural reclaim already fails at +7h;
- relative weakness returns at +8h;
- the frozen Short thesis-resumption condition becomes true at +9h;
- the original baseline event later finishes strongly positive.

Therefore neither one-bar nor two-bar structural reclaim is sufficient evidence of irreversible Short thesis failure. Choosing 3, 4, or another confirmation-bar count from this trajectory would be fitted. V18 instead gives the already-existing 18h probation window its literal lifecycle meaning: **all intermediate failure evidence is provisional; the original event is allowed to recover during probation. Only the pre-existing probation deadline terminates a still-unrecovered event.**

No new numeric constant is introduced. The 18h window is inherited unchanged from V12/V14-V17 (`72h maxHold / 4`).

## Frozen lifecycle
Everything outside the probation termination semantics remains unchanged from frozen V17.

- Preserve every baseline logical event, direction, original gross, and original baseline exit lifecycle.
- Eligibility remains `btcEma168Distance >= 0 OR btcReturn24h >= 0`.
- Reuse the exact ATR progression state machine unchanged:
  - `unit = min(entry ATR24 ratio, hardStopPct / 2)`
  - arm at `+1 unit` MFE
  - progression success at `+2 units`, capped by the existing hard stop
  - progression failure if, before success, a completed H1 close falls back to `+0.5 unit` or less.
- On progression failure keep the full original position and enter probation. No partial close, extra gross, re-entry leg, or event-count change.
- The existing thesis-resumption condition remains unchanged and is evaluated on each completed H1 bar during probation: PENGU closes below the running low-water mark, remains below EMA72, and BTC 24h return >= 0. If it becomes true before the deadline, cancel probation and preserve the untouched baseline event outcome/lifecycle.
- The existing V17 structural-failure evidence (`cost-cover reached`, `relativeReturn24h >= 0`, `close >= EMA72`) may occur during probation but **does not terminate the event early** in V18. It is provisional evidence only.
- The only V18 terminating rule for an event that has not resumed is the already-existing absolute probation deadline: first open at/after 18h from original entry.
- If the untouched original baseline exit occurs earlier than the 18h deadline, preserve that original baseline exit; V18 never extends beyond the baseline lifecycle.
- Normal/Severe fees, slippage, funding treatment, entry signals, sizing, hard stop, and baseline exit engine remain unchanged.

## Anti-overfit evaluation
Known venues: OKX, Binance, Gate, Bitget. KuCoin Futures remains the performance-unobserved final holdout and must stay unopened unless every known-venue gate passes.

Strict PASS for OKX, Binance, Bitget is unchanged:
- baseline logical events >=20
- candidate logical events == baseline
- progression-failure modified events >=2
- Normal event win rate >= baseline +5 percentage points
- Normal Return/PF/DD all non-worse
- Severe event win rate >= baseline
- Severe Return/PF/DD all non-worse
- reverting the single best modified event to baseline leaves Normal and Severe Return delta >=0
- >=3/4 chronological folds non-worse in event win rate
- >=3/4 folds non-worse in Return.

Gate diagnostic PASS remains:
- same event count
- Normal and Severe event win rate/Return/PF/DD all non-worse.

Only if OKX + Binance + Gate diagnostic + Bitget all pass may KuCoin strategy performance be fetched/calculated. KuCoin data/performance contract remains the one frozen before V16 performance:
- `PENGUUSDTM` perpetual with `BTCUSDTM` reference;
- official public H1 candles only, no synthetic/fill-forward bars;
- history from 2025-01-01 UTC with 168 completed H1 warmup bars before first eligible evaluation;
- evaluation cutoff 2026-08-01 00:00 UTC;
- official funding history required for the interval; incomplete funding blocks the holdout rather than changing the cost model.

No V18 rule change is allowed after any V18 strategy result is observed. A failure requires a new pre-registered structure.