# Aster-only V44 Confidence-Tiered Open Router Protocol

## Purpose

Combine a high-confidence residual-continuation core with a smaller Opening Reversal auxiliary position. The goal is to preserve the annual edge found in V42 while increasing chronological Validation observations without allowing the less stable reversal family to dominate capital.

## Frozen core

The core is fixed before execution:

`R100__ONMAX100__OPENMAX10000__LONG_ONLY__REL_ANY__DOM1`

It keeps:

- minimum overnight residual 100 bps;
- broad overnight median no more than 100 bps;
- rolling residual Z-score at least 1.5;
- first-hour residual at least 25 bps;
- Long only;
- one-hour holding;
- Gross 1.0.

## Frozen auxiliary grid

288 policies are declared before execution across:

- Opening Reversal first-hour confirmation 25 or 75 bps;
- one- or two-hour holding;
- both directions or Long only;
- broad overnight cap 100 or 150 bps;
- reversal direction versus broad first-hour move: unrestricted, same or opposite;
- auxiliary Gross 0.25 / 0.50 / 0.75;
- core-first or maximum-estimated-edge selection.

Opening Reversal retains the 150 bps overnight threshold, rolling Z-score 1.5 and fixed TP/SL at 1.00%. Same-candle ambiguity is Stop first.

## Routing and capital

- V11-EQ retains first priority.
- When V11-EQ is absent or rejected, the core and auxiliary signal are evaluated at 10:30.
- Only one is selected.
- Core Gross is 1.0; auxiliary Gross is the frozen fraction.
- V19 remains available at 12:30 when the selected trade has exited and the daily loss lock has not triggered.
- Maximum concurrent Gross is 1.0 and maximum concurrent positions is one.
- Hyperliquid is not used.

## Acceptance

At least four auxiliary-family Validation trades and eight total Validation trades are required. The router must exceed Normal +72.276908%, P95 +68.080022%, fallback Normal +7.813259% and fallback P95 +7.400908%, while passing Validation, Final reused, July Holdout, PF, DD, concentration and robustness checks.

## Safety

Research only. Production, LIVE, VPS, credentials, Crypto V96, V11-EQ, V19, V13D, orders and positions are unchanged.
