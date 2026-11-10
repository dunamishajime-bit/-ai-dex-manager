# Canonical post-causal DD concentration — 2026-11-11

## Basis

Corrected canonical current-implementation replay after the V52 strategy-capital scope fix, plus the causally-supported CAUSAL_THREE gate set.

Canonical baseline:
- 10bps: JPY 887,336.06; DD -56.31%; 537 fills; Win 57.36%; PF 1.222
- 30bps: JPY 321,161.96; DD -63.20%; 537 fills; Win 56.24%; PF 1.168

CAUSAL_THREE:
- 10bps: JPY 1,585,699.80; DD -41.35%; 540 fills; Win 59.63%; PF 1.431
- 30bps: JPY 579,086.35; DD -50.60%; 539 fills; Win 58.26%; PF 1.322

## Maximum DD window

CAUSAL_THREE 10bps:
- Peak: 2026-07-12 01:05 UTC, JPY 2,151,911.28
- Trough: 2026-09-22 11:00 UTC, JPY 1,262,041.43
- DD: -41.35%
- Window: 72.41 days
- Not recovered before 2026-10-01 end

CAUSAL_THREE 30bps:
- Same peak/trough timestamps
- DD: -50.60%
- Not recovered before period end

## Loss concentration inside CAUSAL_THREE max-DD window

10bps strategy net PnL:
- Q102: -JPY 704,721, 17 closed fills, 23.5% win
- IDLE: -JPY 161,526, 24 fills, 37.5% win
- HYPE: -JPY 148,710, 8 fills, 12.5% win
- PENGU: -JPY 47,765, 10 fills, 40.0% win
- FET: +JPY 122,713
- V52: +JPY 251,003

Largest route concentrations:
- IDLE_TAO_BREAKDOWN_SHORT_RELWEAK2: -JPY 289,959, 9 fills, 11.1% win
- PENGU SHORT_V20: -JPY 202,204, 5 fills, 20.0% win
- Q102 HIGH_VOL ARBUSDT: -JPY 166,401, 2 fills, 0% win
- HYPE_TREND_LONG_PINNED: -JPY 148,710, 8 fills, 12.5% win
- Q102 NEAR BRK48: -JPY 115,264, 1 fill
- Q102 HIGH_VOL SUIUSDT: -JPY 91,706, 1 fill
- Q102 AVAX MR24: -JPY 82,968, 3 fills, 33.3% win
- Q102 RENDER BRK168: -JPY 82,109, 2 fills, 0% win

Largest individual loss:
- 2026-09-10 FETUSDT Q102 PB168 LONG: -JPY 163,139 at 10bps, HARD_STOP.

## Full-period weak routes after CAUSAL_THREE

10bps normalized return-sum weak routes:
- HIGH_VOL ARBUSDT: -9.67%, n=2, 0% win
- UNI MR72: -9.45%, n=5, 20% win
- Q102 FET PB72: -9.29%, n=2
- V4 REC_X12_TIME_12H: -8.08%, n=8, 12.5% win
- IDLE_RENDER_RELATIVE_SHORT: -7.83%, n=31, 45.2% win
- RENDER BRK168: -6.74%, n=3, 0% win
- HIGH_VOL SUIUSDT: -6.04%, n=1

30bps also shows:
- HYPE_TREND_LONG_PINNED: -9.30% normalized return sum, n=49, 26.5% win
- IDLE_TAO_BREAKDOWN_SHORT_RELWEAK2: -5.55%, n=24, 50% win but very loss-skewed

## Research priority

Do not delete routes from target-period performance alone.

Next causal research order:
1. IDLE TAO breakdown short — find train/validation/forward entry-quality gate.
2. PENGU SHORT_V20 — find causal market-regime filter separate from RECOVERY_V8 gate.
3. HYPE trend long — entry redesign/filter is high priority because full-period 30bps is structurally weak.
4. Q102 concentration — study FET PB, HIGH_VOL ARB/SUI, NEAR BRK, AVAX MR using pre-period/validation/forward only; avoid symbol-specific target-period deletion.
5. V4 REC_X12_TIME_12H weakness is noted, but V4 current-policy replay is not unbiased OOS evidence, so do not tune it using this target year.

All new gates must be selected/frozen outside the target-year evaluation slice, then replayed unchanged on the corrected canonical simulator.
