# Aster-only V42 Idiosyncratic Open Residual Protocol

## Purpose

V41 exceeded the annual Normal/P95 lines for a high-threshold candidate but missed Validation sample requirements by one candidate-specific trade. V42 does not reduce the Z-score, holding period or cost assumptions. It tests whether broad-market opening conditions and residual direction can retain four or more Validation observations while removing the small Development drag.

## Frozen candidates

432 candidates are declared before execution across:

- minimum overnight residual 50 or 100 bps;
- maximum absolute five-stock median overnight move 50 or 100 bps;
- maximum absolute five-stock median first-hour move 25 / 50 / 100 bps or unrestricted;
- both directions, Long only or Short only;
- individual first-hour residual aligned with, opposed to, or unrestricted versus the broad first-hour move;
- minimum individual residual dominance ratio 1.0 / 1.5 / 2.0.

Every candidate keeps:

- residual continuation only;
- rolling residual Z-score at least 1.5;
- first-hour residual at least 25 bps;
- one-hour maximum holding;
- fixed TP +1.00% and SL -1.00%;
- conservative Stop-first same-candle scoring.

## Routing

- V11-EQ retains first priority.
- V42 runs only when V11-EQ is absent or rejected.
- V19 remains available at 12:30 when V42 has exited and the daily loss lock has not triggered.
- Maximum concurrent Gross is 1.0.
- Maximum concurrent positions is one.
- Hyperliquid is not used.

## Acceptance

The frozen hurdles remain:

- router Normal above +72.276908%;
- router P95 above +68.080022%;
- fallback Normal above +7.813259%;
- fallback P95 above +7.400908%;
- at least eight total Validation trades and four candidate-specific Validation trades;
- positive Validation, Final reused and July Holdout Normal/P95;
- PF, DD, concentration and best-trade/month-removal checks.

Development may send at most 60 candidates to Validation. Final reused and July Holdout cannot select or retune a candidate.

## Safety

Research only. Production, LIVE, VPS, credentials, Crypto V96, V11-EQ, V19, V13D, orders and positions are unchanged.
