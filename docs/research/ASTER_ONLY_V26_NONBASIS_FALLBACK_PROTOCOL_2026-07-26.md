# Aster-only V26 Non-Basis Fallback Protocol

## Goal

Test materially different AsterDEX-only fallbacks for days when V11-EQ is not accepted. This study does not retune V19 Basis Fade.

## Economic families

1. Cash lead / Aster lag continuation
2. Cash and Aster directional disagreement
3. Five-stock cash breadth with Aster lag
4. Cross-sectional cash momentum with lagging Aster leg
5. Overnight cash gap continuation
6. Overnight cash gap reversal

All orders are simulated only on Aster stock perpetuals. Hyperliquid is not used.

## Frozen constraints

- exact trailing window: 2025-07-25 through 2026-07-24;
- symbols: AMZN, META, MSFT, NVDA, TSLA;
- Gross maximum 1.0;
- maximum one Stock position per day in the routed architecture;
- maximum holding one or two hours;
- TP +0.75%, SL -1.00%;
- Normal 40 bps, P95 44 bps, Severe 100 bps round-trip;
- net-edge gate requires at least 10 bps after cost;
- V11-EQ remains the primary route;
- no Production or LIVE promotion from this historical study.

## Selection discipline

- 150 candidates are predeclared before execution;
- Development screens candidates and sends at most 40 to Validation;
- Validation selects at most one candidate;
- Final reused and July Holdout are audit-only and are not used for winner selection;
- the history is reused and is not an independent Holdout.

## Final acceptance

A candidate must:

- pass Development and Validation sample/PF/return gates;
- exceed the frozen V22 router Normal +72.276908% and P95 +68.080022%;
- exceed the frozen V19 fallback-only Normal +7.813259% and P95 +7.400908%;
- keep final chronological and July audit Normal/P95 positive;
- pass every V22 strict hurdle;
- remain Aster-only and research-only.

## Safety

No Production, LIVE, VPS, credentials, orders, positions, Crypto V96, V11-EQ, V19 or V13D state may be changed.
