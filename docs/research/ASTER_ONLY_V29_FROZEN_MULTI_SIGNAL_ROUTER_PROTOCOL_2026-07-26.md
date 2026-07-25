# Aster-only V29 Frozen Multi-Signal Router Protocol

## Goal

Combine previously frozen, economically different near-candidates without retuning their parameters. The router must clear the full V22 baseline rather than merely increase trade count.

## Frozen components

- V11-EQ primary at 10:30 New York;
- 11:30 micro Z-score fade: `TIME_SLOT_ZSCORE_FADE__T2__SLOT_1130__H1__NONE`;
- 11:30 micro Basis acceleration fade: `BASIS_ACCELERATION_FADE__T25__SLOT_1130__H1__COOLDOWN`;
- frozen 12:30 V19: `TIME_SLOT_ZSCORE_FADE__T2__SLOT_1230__H2__NONE`;
- 12:30 Opening Range / volume: `OPENING_RANGE_VOLUME__B10__V1.25__L15__S2__H2`;
- 13:30 Breadth lag: `BREADTH_LAG__B25__L15__S3__H2`.

No component threshold, holding period or exit rule is retuned in V29.

## Frozen policy tournament

Eighteen policies are declared before execution:

- micro choice: none, Z2 or acceleration;
- mid-session choice: V19 priority, Opening Range priority or maximum observable estimated edge;
- late Breadth: disabled or enabled.

## Architecture

- AsterDEX only;
- Hyperliquid is not used;
- exact trailing period 2025-07-25 through 2026-07-24;
- AMZN, META, MSFT, NVDA and TSLA;
- V11-EQ has first priority;
- maximum concurrent Gross 1.0;
- maximum one concurrent Stock position;
- sequential intraday entries are allowed only after the earlier position exits;
- daily Stock loss lock at -2%;
- Normal 40 bps, P95 44 bps and Severe 100 bps round trip;
- fixed Net Edge gate at least 10 bps after cost.

## Acceptance

A policy must satisfy every condition:

- exact-year Normal above +72.276908%;
- exact-year P95 above +68.080022%;
- non-V11 fallback Normal above +7.813259%;
- non-V11 fallback P95 above +7.400908%;
- Validation at least eight routed Normal trades;
- Validation at least seven non-V11 fallback trades;
- Validation Normal/P95 positive and PF at least 1.20;
- Final chronological and July Normal/P95 positive;
- full-year PF at least 1.50;
- maximum DD no worse than -15%;
- at least 50 Normal trades;
- maximum one-symbol share of positive profit at most 40%;
- best-trade-removed and best-month-removed Normal/P95 positive;
- Severe fail-closed non-negative.

Development may send at most six policies to Validation. Validation may select at most one. Final and July are audit-only and are not used for policy selection.

## Safety

Research only. Production, LIVE, VPS, credentials, orders, positions, Crypto V96, V11-EQ, V19 and V13D remain unchanged.