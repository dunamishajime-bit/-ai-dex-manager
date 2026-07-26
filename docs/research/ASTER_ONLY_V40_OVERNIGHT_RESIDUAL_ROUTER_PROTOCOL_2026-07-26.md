# Aster-only V40 Overnight Residual Router Protocol

## Purpose

Remove the broad five-stock overnight market move and trade only stock-specific residual continuation or reversal between the previous US close, 09:30 and 10:30 New York.

## Frozen candidates

72 candidates are declared before execution:

- residual continuation or residual reversal;
- minimum overnight residual 50 / 100 / 150 bps;
- minimum first-hour residual confirmation 25 / 50 / 75 bps;
- rolling residual Z-score none or 1.5;
- one- or two-hour maximum holding.

Each stock's residual is calculated against the five-stock median. The first-hour confirmation is also calculated against the five-stock median. Entry is at 10:30 New York with fixed 1.00% TP and SL; same-candle ambiguity is Stop first.

## Routing

V11-EQ has priority. V40 runs only when V11-EQ is absent or rejected. V19 remains available at 12:30 when V40 has exited and the daily loss lock has not triggered. Maximum concurrent Gross is 1.0, maximum concurrent positions is one and Hyperliquid is not used.

## Acceptance

At least four candidate-specific Validation trades and eight total Validation trades are required. Router Normal must exceed +72.276908%, P95 +68.080022%, fallback Normal +7.813259% and fallback P95 +7.400908%, with all Validation, Final, July, PF, DD, concentration and robustness checks passing.

## Safety

Research only. Production, LIVE, VPS, credentials, Crypto V96, V11-EQ, V19, V13D, orders and positions are unchanged.
