# Aster-only V46 Closing Overlay Protocol

## Purpose

Preserve the V11-EQ plus V19 baseline and add one Aster-only trade after the baseline position has exited, using only the final 90 minutes of the US stock session. This changes the time regime instead of retuning the already inspected opening and Basis signals.

## Frozen candidates

288 candidates are declared before execution across four families:

- day-trend continuation;
- day-exhaustion reversal;
- morning-range breakout;
- cross-sectional day-residual continuation.

Candidate dimensions:

- primary threshold 75 / 125 / 200 bps;
- recent one-hour threshold 25 or 50 bps;
- entry at 14:30 or 15:00 New York;
- no volume requirement or recent-volume ratio at least 1.25;
- both directions, Long only or Short only.

TP is fixed at +0.75% and SL at -1.00%. Same-candle ambiguity is conservatively scored as Stop first. Every trade closes by 16:00 New York.

## Routing

- The original V11-EQ and V19 route is built first and remains unchanged.
- V46 can enter only after the baseline position's recorded exit time.
- A baseline daily loss of -2% or worse blocks V46.
- Maximum concurrent Gross remains 1.0.
- Maximum concurrent positions remains one.
- Hyperliquid is not used.

## Acceptance

At least four V46 Validation trades and eight total Validation trades are required. The router must exceed:

- Normal +72.276908%;
- P95 +68.080022%;
- fallback Normal +7.813259%;
- fallback P95 +7.400908%.

It must also pass Validation, Final reused, July Holdout, PF, DD, concentration, best-trade-removal and best-month-removal checks.

## Safety

Research only. Production, LIVE, VPS, credentials, Crypto V96, V11-EQ, V19, V13D, orders and positions are unchanged.
