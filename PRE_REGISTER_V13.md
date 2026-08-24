# PENGU Short V13 pre-registration

Status: RESEARCH ONLY. No LIVE/VPS/orders/production changes.

## Candidate
`COUNTERWIND_SOFT_DERISK_RAPID_RELOAD`

Exactly one candidate. No threshold sweep.

## Rationale
V12 external diagnostics showed that the Gate failure was not caused by a losing rapid re-entry. The only Gate rapid re-entry was profitable, while the parent baseline short was a larger winner that V12 prematurely closed in full at progression failure. V13 therefore changes the risk architecture, not the signal thresholds.

## Frozen structure
- Preserve every baseline PENGU entry opportunity and direction.
- Only for the same counterwind shorts used by V11/V12: `btcEma168Distance >= 0 OR btcReturn24h >= 0`.
- Keep the exact V11/V12 ATR progression-failure state machine unchanged:
  - `unit = min(entry ATR24 ratio, hardStopPct / 2)`
  - arm at `+1 unit` MFE
  - progression success at `+2 units`, capped by current hard stop
  - progression failure if, before success, close falls back to `+0.5 unit` or less.
- On progression failure: DO NOT fully exit.
  - retain 50% of the original short gross under the original PENGU exit lifecycle;
  - close the other 50% at the same next-open failure exit used by V11/V12.
- Reload only the removed 50% if the frozen V12 structural reload occurs:
  - within the first quarter of the existing 72h short max-hold = 18h from original entry;
  - BTC 24h return >= 0;
  - PENGU close breaks the running low-water mark;
  - PENGU close remains below EMA72.
- Reload gross is exactly the removed half of the original gross. No new ATR sizing and no gross increase above the original position.
- If no reload occurs, the retained 50% continues under the original exit lifecycle.
- Logical event return is the sum of retained-half PnL + removed-half first-leg PnL + optional reloaded-half PnL. Event count must remain exactly equal to baseline. Leg count may increase.

## Anti-overfit evaluation
Development/diagnostic venues: OKX, Binance, Gate. Gate is no longer treated as untouched because V12 performance has already been observed there.

Final untouched holdout: Bitget PENGUUSDT perpetual. No Bitget PENGU performance data may be fetched before this pre-registration commit exists.

Strict venue promotion gate for OKX/Binance/Bitget:
- baseline events >= 20
- candidate logical events == baseline events
- modified progression-failure events >= 2
- Normal event win rate >= baseline + 5 percentage points
- Normal return >= baseline
- Normal PF >= baseline
- Normal closed-event DD no worse than baseline
- Severe event win rate no worse than baseline
- Severe return >= baseline
- Severe PF >= baseline
- Severe closed-event DD no worse than baseline
- after reverting the single best modified event to baseline, Normal and Severe return improvement must remain >= 0
- at least 3/4 chronological folds must have non-worse event win rate
- at least 3/4 folds must have non-worse return

Gate diagnostic requirement:
- same logical event count as baseline
- Normal and Severe win rate/return/PF/DD all non-worse; no +5pp requirement because Gate has only one V12-modified event in the observed one-year period.

Final promotion requires OKX strict PASS + Binance strict PASS + Gate diagnostic non-worse + untouched Bitget strict PASS.

No result-dependent parameter changes are allowed after Bitget data is first fetched.
