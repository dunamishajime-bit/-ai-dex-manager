# Aster-only V31 V96-Idle Crypto Fallback Result

## Status

`ASTER_ONLY_V31_NO_VALIDATED_V96_IDLE_CRYPTO_FALLBACK`

No candidate cleared the frozen Development gate. Production and LIVE remain unchanged.

## Tournament

- 558 predeclared candidates;
- exact trailing window 2025-07-25 through 2026-07-24;
- BTC, ETH, BNB, SOL, LINK, AVAX, DOGE and AAVE;
- AsterDEX only;
- maximum Gross 1.0;
- one, two or four-hour holding;
- V96, V11-EQ and V19 occupancy blocked before Entry;
- no forced utilization;
- Normal/P95/Severe fallback round trips 16/24/60 bps.

## Result

- Development survivors: 0;
- Validation survivors: 0;
- CI backtest: success;
- CI safety validation: success.

The strongest candidate was:

`EXHAUSTION_FADE__Z2__B50__V2__H4__R3`

Development result:

- Normal +9.400481%;
- P95 +6.556425%;
- Normal trades 33;
- Normal PF 1.721557;
- Normal DD -4.710455%.

It failed the frozen Development requirements of Normal at least +20%, P95 at least +10% and at least 30 trades simultaneously with the return hurdles. It was not promoted to Validation.

## Important evidence limitation

The frozen V96 portfolio replay produced evidence through 2026-06-30 12:00 UTC, while the V31 market window continued through 2026-07-24. Therefore July V96 occupancy was not fully observable from that frozen replay. V31 had no winner, so this did not change the rejection, but a future candidate must reconstruct a complete V96 period or fail closed on the uncovered interval before any Production consideration.

## Unified baseline diagnostic

The priority-filtered V96 + V11-EQ + V19 baseline over the requested window produced:

- Normal +489.570519%;
- P95 +477.272378%;
- Severe +169.522766%;
- Normal PF 1.994566;
- Normal DD -16.183858%.

This unified number is diagnostic rather than a new Production claim because the V96 evidence stops on 2026-06-30 and the stock/candidate evidence continues into July.

## Evidence

- PR: `#87`;
- workflow run: `30180240170`;
- artifact: `8625373571`;
- artifact SHA-256: `fc2c818718c95473f7c534db2906ba5cf7344fb0d2afc6d1c1612302e4ad6547`.

## Safety

Research only. Production, LIVE, VPS, Crypto V96, V11-EQ, V19, V13D, credentials, orders and positions were not changed.