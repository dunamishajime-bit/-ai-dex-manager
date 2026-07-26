# Aster-only V28 QQQ Beta-Residual Pair Protocol

## Goal

Test whether an AsterDEX-internal 0.5 Long / 0.5 Short pair can exceed the frozen V22 router while avoiding Hyperliquid collateral and keeping total concurrent Gross at 1.0.

## Families

1. QQQ beta-residual pair continuation
2. QQQ beta-residual over-follow reversal
3. Raw cash cross-sectional momentum continuation
4. Opening-range dispersion pair
5. QQQ residual plus Funding-crowd squeeze pair

## Frozen tournament

- 276 candidates;
- exact trailing window 2025-07-25 through 2026-07-24;
- AMZN, META, MSFT, NVDA and TSLA;
- QQQ beta lookbacks 20 and 40 sessions;
- 11:30, 12:30 and 13:30 New York entries where applicable;
- one- or two-hour holds;
- pair TP +0.75%, pair SL -0.75%;
- Long weight 0.5, Short weight 0.5;
- maximum concurrent Gross 1.0;
- V11-EQ remains primary;
- candidate pair is used only when V11-EQ is not accepted;
- Normal 40 bps, P95 44 bps and Severe 100 bps round trip;
- Net Edge gate at least 10 bps after cost.

## Acceptance

The winner must satisfy all of the following:

- routed Normal above +72.276908%;
- routed P95 above +68.080022%;
- fallback-only Normal above +7.813259%;
- fallback-only P95 above +7.400908%;
- Validation routed sample at least eight Normal trades;
- Validation pair sample at least four Normal trades;
- Validation Normal/P95 positive and routed PF at least 1.20;
- final chronological and July Normal/P95 positive;
- every V22 strict check.

Development sends at most 60 candidates to Validation. Validation selects at most one. Final and July are audit-only.

## Safety

Research only. Production, LIVE, VPS, credentials, orders, positions, Crypto V96, V11-EQ, V19 and V13D remain unchanged.