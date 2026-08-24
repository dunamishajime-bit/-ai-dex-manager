# PENGU Short V17 pre-registration

RESEARCH ONLY. No LIVE/VPS/orders/production changes.

## Candidate
`CONFIRMED_PROGRESS_FAIL_STRESS_COVER_PROBATION`

Exactly one candidate. No threshold sweep, no parameter grid, no venue-specific rule.

## Diagnosis that motivates V17
Frozen V15/V16 diagnostics showed that the shared Q3 failure on 2026-02-20 04:00 UTC is created by the progression-failure lifecycle, not by the original PENGU entry. The event arms and fails inside the same H1 entry bar (`failureDelayHours=0`), then a later transient rebound causes probation exit even though the untouched baseline trade later wins materially on OKX, Binance, Gate, and Bitget.

The same diagnostics show a separate useful behavior: several progression failures occurring only after the armed state survives into later bars belong to baseline losing events. V15 reduces those losses substantially but often exits at the next open after a close-confirmed cost-floor breach, turning a mechanically available stress-cost buffer into a small realized loss. Two other progression-failure events are already converted from baseline loss to win by the frozen 18h probation deadline.

V17 therefore changes the state machine rather than fitting price thresholds:

1. **A progression arm and failure cannot be confirmed in the same H1 bar.** The armed state must exist from a prior completed H1 bar before failure can be declared. This avoids treating an unsequenced single-bar excursion/giveback as a confirmed lifecycle failure.
2. **After a confirmed failure, protect the full position at the already-declared worst-case round-trip transaction-cost cover price instead of waiting for a later close and next-open exit.** This is derived from the existing Severe execution budget, not from backtest PnL.

## Frozen lifecycle
Everything not explicitly changed below remains the frozen V15 structure.

- Preserve every baseline PENGU logical event, direction, original requested gross, and original exit lifecycle unless a confirmed progression failure modifies it.
- Eligibility remains the existing counterwind condition: `btcEma168Distance >= 0 OR btcReturn24h >= 0`.
- Progression unit remains `min(entry ATR24 ratio, hardStopPct / 2)`.
- Arm remains at `+1 unit` MFE.
- Progression success remains at `+2 units`, capped by the existing hard stop.
- **Confirmation rule:** record `armedAtCursor` when the arm is first reached. Failure (`H1 close <= +0.5 unit` before success) is eligible only when `cursor > armedAtCursor`. If arm and giveback happen inside the same H1 bar, keep the original position and continue the state machine; do not enter probation on that bar.
- On confirmed failure keep the full original position. No partial close, no added gross, no new trade/event.
- Probation begins from the next H1 bar after the confirmed failure.
- Worst-case cost cover remains mechanically derived from the pre-existing execution assumptions:
  - `BASE_FEE_PER_SIDE = 0.0006`
  - `STRESS_SLIPPAGE_PER_SIDE = 0.0035`
  - `worstCostPerSide = BASE_FEE_PER_SIDE + STRESS_SLIPPAGE_PER_SIDE`
  - short `stressCoverPrice = entryPrice / (1 + 2 * worstCostPerSide)`.
- During probation, a protective buy-stop is active at `stressCoverPrice`.
  - If a probation bar opens at or above the stop, fill conservatively at that bar open.
  - Otherwise, if the bar high reaches/exceeds the stop, fill at `stressCoverPrice`.
  - This stop is evaluated before any close-confirmed thesis-resumption decision for that bar because an intrabar protective stop would already have executed in real time.
- If the protective stop does not execute, close-confirmed thesis resumption remains exactly the V15 rule: PENGU closes below the running low-water mark, remains below EMA72, and BTC 24h return >= 0. On resumption, keep the untouched original baseline lifecycle.
- The frozen 18h absolute probation deadline remains unchanged. If reached without stop or resumption, exit at the first open at/after 18h exactly as V15.
- Normal/Severe fees, slippage assumptions, funding treatment, event accounting, folds, and max-hold logic remain unchanged.

## Sequential anti-overfit evaluation
Known development/diagnostic venues: OKX, Binance, Gate, Bitget.

Strict PASS for OKX/Binance/Bitget is unchanged from V15/V16:
- baseline logical events >=20
- candidate logical events == baseline
- confirmed progression-failure modified events >=2
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
- Gate is not required to have >=2 modified events because the observed one-year sample has very few progression failures.

## Reserved untouched holdout
KuCoin Futures remains the performance-unobserved final holdout. No KuCoin PENGU strategy performance may be fetched or calculated unless OKX + Binance + Gate diagnostic + Bitget all pass V17 after this pre-registration SHA exists.

If the known-venue development gate fails, KuCoin remains unopened. If it passes, the previously frozen KuCoin data contract applies without modification: official public H1 PENGUUSDTM/BTCUSDTM data, 168-bar warmup, common continuous interval, no synthetic candles, evaluation end 2026-08-01 00:00 UTC, and official funding history or fail-closed BLOCKED if funding coverage is incomplete.

Final promotion requires all known-venue gates plus untouched KuCoin strict PASS. No rule change is allowed after any V17 performance result is observed; another idea requires a new pre-registration.
