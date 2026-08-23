# PENGU Short V15 pre-registration

RESEARCH ONLY. No LIVE/VPS/orders/production changes.

## Candidate
`COUNTERWIND_CLOSE_PROBATION_COST_FLOOR_RESUME`

Exactly one candidate. No threshold sweep.

## Why V15 exists
V14 produced genuine Normal logical-event win-rate improvement on both OKX and Binance without changing event count, but failed the predeclared robustness gate because its intrabar normal-fee break-even stop becomes a losing exit under Severe execution costs and can cut a later large winner. V15 changes execution/state semantics, not the signal thresholds.

## Frozen lifecycle
- Preserve every baseline PENGU entry opportunity, direction, original gross and original exit lifecycle.
- Eligibility remains the existing counterwind condition used since V11: `btcEma168Distance >= 0 OR btcReturn24h >= 0`.
- Reuse the exact ATR progression-failure state machine:
  - `unit = min(entry ATR24 ratio, hardStopPct / 2)`
  - arm at `+1 unit` MFE
  - success at `+2 units`, capped by the existing hard stop
  - failure when, before success, an H1 close falls back to `+0.5 unit` or less.
- On progression failure: keep the full position; enter probation. No partial close, no added gross, no re-entry leg.
- Probation absolute deadline remains the pre-existing V12/V14 18h (= 72h maxHold / 4) from original entry.
- All probation decisions are H1-close-confirmed; no intrabar protective stop is used.
- At each completed H1 bar during probation, process in this order:
  1. **Resume thesis** if PENGU closes below the running low-water mark, remains below EMA72, and BTC 24h return >= 0. If true, keep the untouched baseline trade outcome/lifecycle.
  2. Otherwise, if the H1 close no longer contains enough short profit to cover the predeclared worst-case round-trip transaction-cost budget, exit at the next H1 open.
- The cost-cover floor is not fitted to BT results. It is derived mechanically from existing research execution assumptions:
  - base fee per side = 0.0006
  - severe slippage per side = 0.0035 (same 35bps max-slippage assumption)
  - `worstCostPerSide = BASE_FEE_PER_SIDE + STRESS_SLIPPAGE_PER_SIDE`
  - short cost-cover price = `entryPrice / (1 + 2 * worstCostPerSide)`.
  - If probation close >= cost-cover price and thesis has not resumed, exit next open.
- If neither resume nor cost-floor failure occurs before 18h, exit at the first open at/after the 18h deadline.
- Event count must remain exactly baseline. True logical-event win rate is the primary win-rate metric.

## Bitget data-quality handling frozen before V15 performance
The previous V13/V14 attempts exposed only data-quality behavior, not Bitget strategy metrics. The V3 history-candle endpoint returns at most 100 rows per request. V15 therefore fetches 1H data in forward, non-overlapping <=99-hour windows, limit=100, deduplicates by timestamp, and never synthesizes/fills missing candles. After retrieval:
- record all non-hourly gaps;
- if an exchange/listing gap exists, trim only to the continuous tail after the last real gap;
- require at least 10,000 continuous PENGU 1H rows and aligned BTC rows before any strategy replay;
- record trimStart and gap list.
This is frozen technical handling and must not depend on strategy performance.

## Anti-overfit gates
Development/diagnostic venues: OKX, Binance, Gate.
Final performance-unobserved holdout: Bitget. No Bitget V15 strategy metrics may be inspected before this pre-registration commit exists.

Strict PASS for OKX/Binance/Bitget:
- baseline logical events >=20
- candidate logical events == baseline
- progression-failure modified events >=2
- Normal event win rate >= baseline +5 percentage points
- Normal Return/PF/DD all non-worse
- Severe event win rate >= baseline
- Severe Return/PF/DD all non-worse
- reverting the single best modified event to baseline leaves Normal and Severe Return delta >=0
- >=3/4 chronological folds non-worse in event win rate
- >=3/4 folds non-worse in Return

Gate diagnostic PASS:
- same event count
- Normal and Severe event win rate/Return/PF/DD all non-worse. No +5pp requirement because Gate has only one modified event in the observed one-year sample.

Final promotion requires OKX strict PASS + Binance strict PASS + Gate diagnostic PASS + untouched Bitget strict PASS.

No parameter changes after Bitget V15 performance is first calculated.
