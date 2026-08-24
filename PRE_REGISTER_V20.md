# PENGU Short V20 pre-registration

RESEARCH ONLY. No LIVE/VPS/orders/production changes.

## Candidate
`COUNTERWIND_VOL_TARGET_FAILURE_EXIT`

Parent: frozen V18 `COUNTERWIND_REVERSIBLE_PROBATION_TO_DEADLINE`.

V18 pre-registration SHA: `42bb6297d893125ad3b2de0a9e26dba342852223`.

Exactly one candidate and exactly one structural rule change. No threshold sweep, duration sweep, parameter search, feature-combination search, or venue-specific rule.

## Diagnostic basis
The completed V18 pre-existing categorical-state diagnostic (run `32682319430`) was diagnostic-only and preserved exact formal V18 parity on OKX, Binance, Gate, and Bitget before inspecting categorical state. It searched only single pre-existing categorical dimensions and reported `sizingState` as the sole single-dimension separator of the shared residual modified Normal loss at entry `2025-01-25T08:00:00Z` from the V18 modified Normal winners across all three strict venues.

The classification itself is not a new strategy threshold. It is a label for the already-existing sizing output from `targetGrossForAtr(signalFeatures.atr24Ratio)`:
- `CAP` when original requested gross equals the existing configured `grossCap`;
- `FLOOR` when original requested gross equals the existing configured `grossFloor`;
- otherwise `VOL_TARGET`.

The shared `2025-01-25T08:00:00Z` residual loss is `VOL_TARGET` on OKX, Binance, and Bitget. The V18 modified Normal winners on those strict venues are not `VOL_TARGET`. Gate Q3 `2026-02-20T04:00:00Z`, which V18 repaired, is `CAP` and therefore remains on the untouched V18 lifecycle.

A broader inspection also found another Bitget `VOL_TARGET` progression-failure event that is already a winner under the untouched V18 lifecycle. Its prospective V20 result has deliberately not been calculated before this pre-registration. V20 accepts that risk rather than adding a post-result secondary condition.

## Exactly one frozen structural change
Everything is identical to frozen V18 except this one branch after the existing progression-failure condition has already been confirmed:

1. Preserve all V18 entry eligibility, signals, logical events, original gross, ATR progression state machine, fees, slippage, funding, hard stop, max hold, cooldown, baseline exit engine, and counterwind eligibility.
2. Determine the original entry `sizingState` only from the already-computed original requested gross and the existing configured gross cap/floor, exactly as defined above.
3. If progression failure occurs and `sizingState == VOL_TARGET`, bypass V18 probation and restore the old V11 progression-failure exit lifecycle: close the full original short at the **next H1 open** after the completed H1 that confirmed progression failure. Use the unchanged Normal/Stress fee and funding model. No re-entry is created.
4. If `sizingState` is `CAP` or `FLOOR`, use frozen V18 exactly: keep the full original position in reversible probation; preserve the existing close-confirmed thesis-resumption condition; otherwise terminate only at the inherited 18h deadline or earlier untouched baseline exit.
5. V20 never extends an event beyond its original baseline lifecycle and never changes event count by adding a leg.

No new numeric constant is introduced. No condition based on failure delay, MFE, MAE, return magnitude, EMA distance, BTC return magnitude, calendar time, venue, or the observed outcome may be added after this registration.

## Anti-overfit evaluation
Known venues remain OKX, Binance, Gate, and Bitget. KuCoin Futures remains the performance-unobserved final holdout and must remain unopened unless every known-venue gate passes.

Strict PASS for OKX, Binance, and Bitget remains unchanged from V18:
- baseline logical events >=20;
- candidate logical events == baseline;
- progression-failure modified events >=2;
- Normal event win rate >= baseline +5 percentage points;
- Normal Return/PF/DD all non-worse;
- Severe/Stress event win rate >= baseline;
- Severe/Stress Return/PF/DD all non-worse;
- reverting the single best modified event to baseline leaves Normal and Severe/Stress Return delta >=0;
- >=3/4 chronological folds non-worse in event win rate;
- >=3/4 chronological folds non-worse in Return.

Gate diagnostic PASS remains unchanged:
- same event count;
- Normal and Severe/Stress event win rate/Return/PF/DD all non-worse;
- the repaired 2026-02-20 Q3 event must remain preserved.

Only if OKX + Binance + Gate diagnostic + Bitget all pass may KuCoin strategy performance be fetched/calculated. KuCoin remains `RESERVED_UNOPENED` during V20 known-venue development.

## Immutability
This document must be committed before any V20 performance replay. The resulting commit SHA is the V20 pre-registration SHA and must be embedded in the V20 evaluator/workflow. No V20 rule change is allowed after any V20 strategy result is observed. A failure requires a newly pre-registered version/structure; the V20 gate may not be relaxed.

## Safety
`RESEARCH_ONLY`.

- LIVE changes: forbidden
- VPS changes: forbidden
- production changes: forbidden
- orders/cancels: forbidden
- synthetic LIVE test orders: forbidden
- KuCoin performance access before all known-venue gates pass: forbidden
