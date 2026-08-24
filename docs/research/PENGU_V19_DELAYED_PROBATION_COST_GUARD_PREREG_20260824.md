# PENGU V19 — DELAYED PROBATION COST GUARD — PRE-REGISTRATION

Status: PRE-REGISTERED BEFORE ANY V19 PERFORMANCE REPLAY

## Candidate

`COUNTERWIND_DELAYED_PROBATION_COST_GUARD`

Parent: frozen V18 `COUNTERWIND_REVERSIBLE_PROBATION_TO_DEADLINE`

V18 pre-registration SHA: `42bb6297d893125ad3b2de0a9e26dba342852223`

## Diagnostic basis

The formal V18 remaining-loss diagnosis identified one Normal event that is simultaneously:

- still a V18 loss,
- actually modified by V18,
- aligned on OKX, Binance, and Bitget,
- and responsible for the same residual strict-venue win-rate shortage pattern.

That event entered progression-failure probation only after the arm/failure lifecycle had unfolded across multiple completed H1 candles. By contrast, the Gate 2026-02-20 Q3 winner that V17 incorrectly terminated enters progression failure on the entry H1 itself. The latter contains same-H1 path ambiguity: H1 OHLC cannot establish a unique intrabar arm/failure/stop ordering. V18 correctly preserves that event by making the probation reversible.

This motivates a categorical lifecycle distinction, not a new numeric threshold: a protective cost guard may be used only when progression failure is confirmed on a later H1 than the entry H1. Same-entry-H1 failures keep the untouched V18 reversible lifecycle.

## Exactly one structural rule change

Relative to V18, add exactly one branch:

1. Capture the H1 cursor where the existing progression-failure condition becomes true.
2. Define `delayedProbation = failureCursor > entryIndex`.
3. If `delayedProbation == false`, use V18 exactly: no intermediate cost exit; deadline and close-confirmed thesis-resume logic are unchanged.
4. If `delayedProbation == true`, arm one protective stop using the already-existing predeclared worst-case round-trip cost-cover price from the V15/V18 lineage:
   `costCoverPrice = entryPrice / (1 + 2 * (BASE_FEE_PER_SIDE + STRESS_SLIPPAGE_PER_SIDE))`.
5. The stop is active only after progression failure has been confirmed. It must not claim an impossible historical fill on the failure candle. Starting with the next H1 after the failure-confirming candle, if the bar reaches/reclaims `costCoverPrice`, close the short using conservative stop execution: if the H1 opens at or above the stop, fill at the H1 open; otherwise fill at `costCoverPrice` when the H1 high reaches it. Funding and Normal/Stress costs remain exactly as in the frozen evaluator.
6. Existing V18 deadline check and close-confirmed thesis-resume logic remain unchanged. No re-entry, entry filter, sizing, hard stop, max hold, fee, slippage, funding, feature, or venue rule changes are allowed.

This is one lifecycle change: **restore a conservative cost-protection guard only for multi-H1-confirmed progression failures, while keeping same-H1 ambiguous failures fully reversible.**

## No tuning / no search

- Candidate count: exactly 1.
- Threshold sweep: forbidden.
- Grid search: forbidden.
- No alternative failure-delay cutoffs may be tried. The distinction is strictly `failureCursor > entryIndex` versus same-entry-H1 failure.
- No alternative cost price may be tried. Use the existing worst-case round-trip `costCoverPrice` formula above.
- No post-result V19 edits are allowed.

## Frozen known-venue evaluation

Run V19 once on already-opened venues only: OKX, Binance, Gate, Bitget.

For both Normal and Stress, preserve the existing frozen promotion framework. In particular:

- trades remain comparable to frozen baseline,
- Normal win-rate improvement must be at least +5.0 percentage points on each strict venue OKX, Binance, and Bitget,
- Normal Return, PF, and max DD must be non-worse than baseline,
- Stress WR, Return, PF, and max DD must be non-worse than baseline,
- leave-one-best / robustness condition remains non-worse,
- chronological fold requirements remain unchanged,
- Gate diagnostic must remain non-worse,
- Gate 2026-02-20 Q3 winner must remain preserved.

No criterion may be relaxed after results.

## KuCoin holdout lock

KuCoin strategy performance remains `RESERVED_UNOPENED` during all V19 known-venue work.

Only if V19 passes every frozen known-venue requirement may the exact preregistered V19 be opened on KuCoin once as the untouched final holdout. V19 may not be edited after KuCoin is observed.

## Safety

`RESEARCH_ONLY`.

- LIVE changes: forbidden
- VPS changes: forbidden
- production changes: forbidden
- orders/cancels: forbidden
- synthetic LIVE test orders: forbidden
