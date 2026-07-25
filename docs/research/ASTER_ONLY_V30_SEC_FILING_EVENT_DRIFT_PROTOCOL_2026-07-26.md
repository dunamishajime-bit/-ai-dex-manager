# Aster-only V30 SEC Filing Event Drift Protocol

## Goal

Add a genuinely new public information source to the Aster-only router: SEC filing events. The study tests whether price action immediately after publicly disseminated quarterly and earnings-result filings can add enough return and Validation sample to clear the frozen V22 baseline.

## Event source

- SEC `data.sec.gov/submissions/CIK##########.json`;
- AMZN, META, MSFT, NVDA and TSLA CIKs are frozen;
- eligible forms are 10-Q, 10-K and 8-K filings containing Item 2.02;
- to prevent look-ahead, an event becomes tradable only on the first aligned U.S. session strictly after the SEC filing date;
- candidates may use only the first event session or the first two event sessions.

## Economic families

1. filing-reaction continuation;
2. filing-reaction reversal;
3. filing-day QQQ beta-residual continuation;
4. filing-day Opening Range / relative-volume continuation.

## Frozen tournament

- 640 candidates declared before execution;
- exact trailing period 2025-07-25 through 2026-07-24;
- V11-EQ remains primary;
- event trade is evaluated only when V11-EQ is not accepted;
- a one-hour event trade may finish before the frozen 12:30 V19 decision;
- maximum concurrent Gross 1.0;
- maximum one concurrent Stock position;
- maximum holding one or two hours;
- TP +1.00%, SL -0.75%;
- daily Stock loss lock -2%;
- Normal 40 bps, P95 44 bps and Severe 100 bps round trip;
- fixed Net Edge gate at least 10 bps after cost.

## Acceptance

A winner must satisfy all conditions:

- routed Normal above +72.276908%;
- routed P95 above +68.080022%;
- Validation at least eight routed Normal trades;
- Validation at least four event-specific Normal trades;
- Validation routed and event-specific Normal/P95 positive;
- Validation routed PF at least 1.20;
- Final chronological and July Normal/P95 positive;
- full-year routed PF at least 1.50;
- maximum DD no worse than -15%;
- at least 50 Normal trades;
- maximum one-symbol positive-profit concentration at most 40%;
- best-trade-removed and best-month-removed Normal/P95 positive;
- Severe fail-closed non-negative.

Development sends at most 60 candidates to Validation. Validation selects at most one. Final and July remain audit-only.

## Safety

Research only. Production, LIVE, VPS, credentials, orders, positions, Crypto V96, V11-EQ, V19 and V13D remain unchanged.