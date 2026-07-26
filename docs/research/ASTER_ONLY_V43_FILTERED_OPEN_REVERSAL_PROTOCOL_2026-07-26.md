# Aster-only V43 Filtered Open Reversal Protocol

## Purpose

V39 Opening Reversal produced six positive Validation trades but reduced Development return. V43 freezes the strong Overnight threshold and separates direction and broad-market opening regimes to determine whether the Development drag can be removed without losing Validation sample size.

## Frozen candidates

324 candidates are declared before execution. Every candidate requires:

- absolute Aster overnight move at least 150 bps;
- same-symbol rolling overnight Z-score at least 1.5;
- overnight move and 09:30–10:30 move in opposite directions;
- fixed TP +1.00% and SL -1.00%;
- conservative Stop-first scoring when both levels occur in one candle.

The candidate dimensions are:

- first-hour confirmation 25 or 75 bps;
- one- or two-hour maximum holding;
- both directions, Long only or Short only;
- maximum absolute five-stock median overnight move 50 / 100 / 150 bps;
- maximum absolute five-stock median first-hour move 50 / 100 bps or unrestricted;
- individual reversal direction aligned with, opposed to, or unrestricted versus the broad first-hour move.

## Routing

- V11-EQ retains first priority.
- V43 runs only when V11-EQ is absent or rejected.
- V19 remains available at 12:30 when V43 has exited and the daily loss lock has not triggered.
- Maximum concurrent Gross is 1.0.
- Maximum concurrent positions is one.
- Hyperliquid is not used.

## Acceptance

At least four V43 Validation trades and eight total Validation trades are required. The router must exceed Normal +72.276908%, P95 +68.080022%, fallback Normal +7.813259% and fallback P95 +7.400908%, while passing Validation, Final reused, July Holdout, PF, DD, concentration and robustness checks.

Development may send at most 50 candidates to Validation. Final reused and July Holdout are audit-only.

## Safety

Research only. Production, LIVE, VPS, credentials, Crypto V96, V11-EQ, V19, V13D, orders and positions are unchanged.
