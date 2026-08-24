# PENGU Short V16 pre-registration

RESEARCH ONLY. No LIVE/VPS/orders/production changes.

## Candidate
`COUNTERWIND_RELATIVE_THESIS_PROBATION`

Exactly one candidate. No threshold sweep and no parameter search.

## Diagnosis that motivates V16
The frozen V15 event diagnostic was defined before this candidate and did not change strategy behavior. It showed one timestamp-level failure reproduced on OKX, Binance, Gate, and Bitget: the 2026-02-20 04:00 UTC Short was a positive baseline event on every venue but V15's absolute cost-floor probation converted it to approximately flat/slightly negative. At the V15 cost-floor decision, PENGU still underperformed BTC over the same 24h window on all four venues. The diagnostic also showed that cost-floor exits are useful when the relative thesis has actually reversed, so V16 does not remove the cost floor.

The structural hypothesis is therefore: **an absolute rebound back toward transaction-cost cover is not, by itself, evidence that a counterwind relative-weakness Short thesis has failed. The financial cost floor may terminate probation only after PENGU is no longer weaker than BTC on the existing 24h relative-return feature.**

The zero boundary is not fitted: `relativeReturn24h = PENGU_24h_return - BTC_24h_return`; `< 0` means PENGU remains relatively weaker, `>= 0` means that relative-weakness thesis is no longer present.

## Frozen lifecycle
Everything in V15 remains unchanged except the single cost-floor decision condition below.

- Preserve every baseline PENGU logical event, direction, original gross, and original exit lifecycle.
- Eligibility remains the existing counterwind condition: `btcEma168Distance >= 0 OR btcReturn24h >= 0`.
- Reuse the exact frozen V15 ATR progression-failure state machine:
  - `unit = min(entry ATR24 ratio, hardStopPct / 2)`
  - arm at `+1 unit` MFE
  - success at `+2 units`, capped by the existing hard stop
  - failure when, before success, an H1 close falls back to `+0.5 unit` or less.
- On progression failure keep the full position and enter probation. No partial close, no added gross, no added trade/event.
- Absolute probation deadline remains 18h from the original entry (= existing 72h maxHold / 4).
- H1-close-confirmed thesis resumption remains unchanged and has first priority: PENGU closes below the running low-water mark, remains below EMA72, and BTC 24h return >= 0. If true, preserve the untouched baseline lifecycle.
- V15 worst-case transaction-cost cover price remains unchanged:
  - `worstCostPerSide = BASE_FEE_PER_SIDE + STRESS_SLIPPAGE_PER_SIDE`
  - short `costCoverPrice = entryPrice / (1 + 2 * worstCostPerSide)`.
- **The only V16 change:** a cost-floor exit is allowed only when both are true on the completed H1 bar:
  1. `bar.close >= costCoverPrice`, and
  2. `features.relativeReturn24h >= 0`.
- If the cost floor is reached while `relativeReturn24h < 0`, stay in probation; this is not a new entry or re-entry.
- If no thesis resumption or eligible cost-floor exit occurs before the existing 18h deadline, exit at the first open at/after that deadline exactly as V15.
- Normal/Severe fee and slippage assumptions remain unchanged.

## Sequential anti-overfit evaluation
Known development/diagnostic venues: OKX, Binance, Gate, Bitget. Bitget is no longer treated as untouched because its V15 performance and event diagnostics have now been observed.

Development strict PASS for OKX, Binance, and Bitget remains exactly the V15 contract:
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

Gate remains a diagnostic non-worse gate because only one modified event exists in the observed one-year Gate sample:
- same event count
- Normal and Severe event win rate/Return/PF/DD all non-worse.

**KuCoin Futures is reserved as the new performance-unobserved final holdout. KuCoin PENGU strategy performance must not be fetched or calculated unless all four known-venue gates above pass after this pre-registration SHA exists.** API/contract availability may be verified before the SHA; strategy metrics may not.

KuCoin holdout data contract, frozen before performance:
- contract: `PENGUUSDTM` perpetual and `BTCUSDTM` reference
- H1 candles only; official public KuCoin API; no synthetic/fill-forward candles
- raw history begins at 2025-01-01 00:00 UTC because current official futures H1 history is documented from 2025-01-01
- require 168 completed H1 bars of warmup before the first eligible evaluation bar, mechanically matching the longest existing EMA168 feature
- evaluation ends at 2026-08-01 00:00 UTC, matching the existing research cutoff
- deduplicate by timestamp, record all gaps, and trim to a continuous common PENGU/BTC interval only by a predeclared data-quality rule; never choose a trim from strategy performance
- use official public KuCoin funding history when complete for the evaluation interval; if the required funding history is technically unavailable/incomplete, the KuCoin performance holdout is BLOCKED rather than silently changing the cost model.

KuCoin strict PASS uses the same strict contract as OKX/Binance/Bitget above. Final V16 promotion requires OKX PASS + Binance PASS + Gate diagnostic PASS + Bitget PASS + untouched KuCoin PASS.

If known-venue development fails, KuCoin strategy performance remains unopened and V16 promotion is FALSE. No V16 rule change is allowed after any V16 result is observed; a subsequent idea requires a new candidate and new pre-registration.
