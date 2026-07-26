# Aster-only V19 Fallback Profit Extension Result

## Final status

`KEEP_V19_FALLBACK_AND_START_UNTOUCHED_SHADOW_VALIDATION`

No historically validated replacement or additive fallback improved the frozen V19 router while satisfying the raised chronological sample requirements.

## Frozen baseline

V11-EQ primary plus frozen V19 fallback:

- exact-year Normal: +72.276908%;
- exact-year P95: +68.080022%;
- Normal PF: 4.656080;
- P95 PF: 4.349727;
- Normal trades: 85;
- P95 trades: 82;
- Normal DD: -4.313048%;
- P95 DD: -4.734913%.

The V19 fallback component itself produced:

- Normal: +7.813259% from 24 trades;
- P95: +7.400908% from 22 trades;
- Normal PF: 2.545675;
- Normal DD: -1.192669%.

## V23 replacement tournament

- 336 predeclared fallback candidates;
- 39 Development survivors;
- zero Validation survivors;
- status: `ASTER_ONLY_V23_NO_VALIDATED_FALLBACK_IMPROVEMENT`.

The only Development survivor reaching eight routed Validation trades was an intraday shock candidate, but it returned -4.263893% Normal and -3.579275% P95 with PF 0.289463.

The profitable high-quality candidates generally reproduced the existing V19 pattern and had only two to four Validation trades.

Evidence:

- workflow run: `30174221747`;
- artifact: `8623768547`;
- artifact SHA-256: `3e2941f42a64fff9d3a17bd08c0fb1ea4b9ac55feef0aa5440e35e35faec0933`;
- CI backtest and safety validation: success.

## V24 V19 plus 13:30 late fallback

The route preserved V19 priority and evaluated a 13:30 secondary only on unused days.

- 84 predeclared candidates;
- 4 Development survivors;
- zero Validation survivors;
- status: `ASTER_ONLY_V24_NO_VALIDATED_LATE_FALLBACK`.

None of the four Development survivors generated an accepted secondary trade in the Validation segment. Therefore the late fallback could not increase Validation sample or profit.

Evidence:

- workflow run: `30174395358`;
- artifact: `8623808218`;
- artifact SHA-256: `e6bf363b49e7fe9876bb4fce68a7425f647d6deb4e6675e855c9652aaaa53060`;
- CI backtest and safety validation: success.

## V25 11:30 micro plus frozen V19

The route allowed a one-hour 11:30 micro trade and retained the frozen 12:30 V19 decision after the micro exit. Maximum concurrent Gross remained 1.0.

- 42 predeclared candidates;
- 7 Development survivors;
- zero Validation survivors;
- status: `ASTER_ONLY_V25_NO_VALIDATED_EARLY_MICRO`.

Closest sample candidate:

`TIME_SLOT_ZSCORE_FADE__T2__SLOT_1130__H1__NONE`

- Validation Normal: +2.858443%;
- Validation P95: +3.203686%;
- Normal PF: 3.687418;
- Normal DD: -1.056456%;
- routed Validation trades: 6;
- accepted micro trades: 2.

It improved the baseline Validation return but failed the frozen minimums of eight routed trades and four micro trades.

Highest Validation return candidate:

`BASIS_ACCELERATION_FADE__T25__SLOT_1130__H1__COOLDOWN`

- Validation Normal: +3.444623%;
- Validation P95: +3.833604%;
- Normal PF: 7.927438;
- Normal DD: -0.492587%;
- routed Validation trades: 5;
- accepted micro trades: 1.

It was profitable but even more sample-deficient.

Evidence:

- workflow run: `30174546042`;
- artifact: `8623843442`;
- artifact SHA-256: `15c67d6ab1c5c50a0373ccb00b3d87c386ebea36064c090f2a0469a66d7b1bb2`;
- CI backtest and safety validation: success.

## Decision

Do not change Production V19 from this historical search.

Further threshold or family searching on the same five-symbol history would optimize directly against already observed Validation/final/July data. The valid next evidence is no-order Forward Shadow collection for the two profitable near candidates while frozen V19 remains unchanged.

A candidate may be reconsidered only after accumulating untouched evidence with at least:

- eight routed evaluation trades;
- four candidate-specific trades;
- positive Normal and P95 after observable costs;
- PF at least 1.20;
- no deterioration of V19 execution or V11-EQ priority.

## Safety

Research only. Production, LIVE, VPS, Crypto V96, V11-EQ runtime, V19 runtime, V13D, credentials, orders and positions were not changed.
