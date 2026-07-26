# Aster-only V41 Calm Overnight Residual Router Protocol

## Purpose

V40 nearly matched the Development baseline while producing sufficient Validation observations. V41 tests whether losses are concentrated on broad-market overnight shock sessions by adding one frozen market-regime gate to the same cross-sectional residual logic.

## Frozen candidates

216 candidates are declared before execution across:

- residual continuation or residual reversal;
- minimum overnight residual 50 / 100 / 150 bps;
- minimum first-hour residual confirmation 25 / 50 / 75 bps;
- rolling residual Z-score none or 1.5;
- one- or two-hour maximum holding;
- maximum absolute five-stock median overnight move 50 / 100 / 150 bps.

No V40 threshold is refined from its result. The only new dimension is the broad-market overnight regime cap.

## Signal

For each session:

1. Calculate each stock's Aster move from the prior US close to 09:30 New York.
2. Subtract the five-stock median overnight move.
3. Calculate the 09:30–10:30 first-hour move and subtract the five-stock median first-hour move.
4. Reject the session when the absolute broad overnight median exceeds the frozen regime cap.
5. Trade the strongest qualifying individual residual continuation or reversal at 10:30.

TP and SL remain fixed at 1.00%. Same-candle TP/SL ambiguity is scored conservatively as Stop first.

## Routing

- V11-EQ retains first priority.
- V41 runs only when V11-EQ is absent or rejected.
- V19 remains available at 12:30 when V41 has already exited and the daily loss lock has not triggered.
- Maximum concurrent Gross is 1.0.
- Maximum concurrent positions is one.
- Hyperliquid is not used.

## Acceptance

At least four V41 Validation trades and eight total Validation trades are required. The router must exceed:

- Normal +72.276908%;
- P95 +68.080022%;
- fallback-only Normal +7.813259%;
- fallback-only P95 +7.400908%.

It must also pass Validation, Final reused, July Holdout, PF, DD, concentration, best-trade-removal and best-month-removal checks.

## Selection discipline

Development may send at most 40 candidates to Validation. Validation selects at most one candidate. Final reused and July Holdout are audit-only and cannot select or retune a candidate.

## Safety

Research only. Production, LIVE, VPS, credentials, Crypto V96, V11-EQ, V19, V13D, orders and positions are unchanged.
