# Aster-only V45 Sequential Core Reversal Protocol

## Purpose

V44 preserved strong annual returns but still selected only one 10:30 signal. V45 uses the same information causally in two non-overlapping time slots: the high-confidence residual core from 10:30 to no later than 11:30, followed by a delayed Opening Reversal from 11:30 to no later than 12:30.

## Frozen core

The core remains:

`R100__ONMAX100__OPENMAX10000__LONG_ONLY__REL_ANY__DOM1`

It uses Gross 1.0 and a one-hour maximum holding period.

## Frozen delayed-reversal grid

288 candidates are declared before execution across:

- first-hour confirmation 25 or 75 bps;
- both directions, Long only or Short only;
- broad overnight cap 100 or 150 bps;
- reversal direction versus the broad first-hour move: unrestricted, same or opposite;
- delayed-reversal Gross 0.25 / 0.50 / 0.75 / 1.0;
- same-symbol reuse allowed or blocked.

The reversal signal is calculated using information available at 10:30, but its simulated order enters at 11:30. It exits by 12:30. TP and SL remain 1.00% and same-candle ambiguity is Stop first.

## Routing

- V11-EQ retains first priority.
- If V11-EQ is absent or rejected, the 10:30 core may enter.
- The 11:30 reversal may enter only after the core has actually exited.
- V19 may enter at 12:30 only when every prior position has exited and the daily loss lock has not triggered.
- Maximum concurrent Gross is 1.0 and maximum concurrent positions is one.
- Hyperliquid is not used.

## Acceptance

At least four core/reversal Validation trades and eight total Validation trades are required. The router must exceed Normal +72.276908%, P95 +68.080022%, fallback Normal +7.813259% and fallback P95 +7.400908%, while passing Validation, Final reused, July Holdout, PF, DD, concentration and robustness checks.

## Safety

Research only. Production, LIVE, VPS, credentials, Crypto V96, V11-EQ, V19, V13D, orders and positions are unchanged.
