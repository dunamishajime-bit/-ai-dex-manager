# PENGU Short V14 pre-registration

RESEARCH ONLY. No LIVE/VPS/orders/production changes.

## Candidate
`COUNTERWIND_PROBATION_BREAKEVEN_RESUME`

Exactly one candidate. No threshold sweep.

## Structural hypothesis
V13 proved that soft de-risk can improve Return/PF/DD but does not improve logical-event win rate. Gate V12 diagnostics proved the only rapid re-entry was profitable while full early exit cut a much larger baseline winner. V14 therefore preserves the full original position and changes only the failure lifecycle.

## Frozen lifecycle
- Preserve every baseline entry opportunity, direction, gross and original PENGU exit logic.
- Only counterwind shorts are eligible: the existing V11/V12 condition `btcEma168Distance >= 0 OR btcReturn24h >= 0`.
- Use the exact existing ATR progression state machine unchanged:
  - unit = min(entry ATR24 ratio, current 8% hard stop / 2)
  - arm at +1 unit MFE
  - progression succeeds at +2 units, capped by the existing hard stop
  - progression failure occurs if, before success, close falls back to +0.5 unit or less.
- On progression failure, do NOT exit or resize. Enter probation with full original gross.
- Probation absolute deadline = first quarter of existing 72h short max hold = 18h from original entry. This is inherited from V12; no search.
- During probation:
  - place a full-position protective stop at fee-adjusted break-even for the actual base fee: `entryPrice / (1 + 2 * BASE_FEE_PER_SIDE)` for a short. No PnL threshold is tuned from BT results.
  - if price touches the break-even stop before thesis resumption, exit the event at that stop.
  - thesis resumes if, before the 18h deadline, PENGU closes below the running low-water mark, remains below EMA72, and BTC 24h return >= 0. On resumption, cancel probation protection and use the untouched original baseline trade outcome/lifecycle.
  - if the 18h deadline is reached without stop or resumption, exit at the next available open.
- No re-entry leg is created. Event count must exactly equal baseline. This directly evaluates true event win rate, not leg win rate.

## Evaluation
Development/diagnostic: OKX, Binance, Gate.
Final performance-unobserved holdout: Bitget PENGUUSDT perpetual. A prior V13 technical attempt fetched Bitget raw history but failed continuity validation before any Bitget strategy metrics were calculated or exposed. Only data-quality information (an early listing-period missing hour) was observed.

Bitget technical handling is frozen before V14 performance: trim each symbol to the continuous tail beginning immediately after the last detected hourly gap; do not fill/synthesize candles; require >=10,000 continuous PENGU 1h rows. Record the trim timestamp and gaps. This is data-quality handling only.

Strict PASS for OKX/Binance/Bitget:
- baseline logical events >=20
- candidate logical events == baseline events
- progression-failure modified events >=2
- Normal event win rate >= baseline +5 percentage points
- Normal Return/PF/DD all non-worse
- Severe event win rate/Return/PF/DD all non-worse
- reverting the single best modified event to baseline leaves Normal and Severe Return delta >=0
- >=3/4 chronological folds non-worse in event win rate
- >=3/4 folds non-worse in Return

Gate diagnostic PASS:
- same event count
- Normal and Severe event win rate/Return/PF/DD all non-worse (no +5pp requirement due limited modified-event count).

Final promotion = OKX strict PASS AND Binance strict PASS AND Gate diagnostic PASS AND Bitget strict PASS.

No parameter changes after Bitget V14 performance is calculated.
