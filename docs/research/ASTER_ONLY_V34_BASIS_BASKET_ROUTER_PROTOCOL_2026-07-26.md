# Aster-only V34 Basis Basket Router Protocol

## Purpose

Test whether the V19 fallback can be improved by replacing its single Top-1 stock-perpetual position with a diversified two- or three-leg AsterDEX basket while keeping total Gross at 1.0.

## Frozen architecture

- venue: AsterDEX only;
- V11-EQ remains first priority;
- fallback decision: 12:30 New York;
- symbols: AMZN, META, MSFT, NVDA and TSLA;
- basket size: two or three legs;
- total concurrent Gross: 1.0 shared across all legs;
- maximum holding: one, two or three hours;
- TP +0.75% and SL -1.00% per leg;
- no Hyperliquid and no external hedge collateral;
- one basket event per market session.

## Candidate grid

648 candidates are declared before execution across:

- basket size 2 / 3;
- Z threshold 1.5 / 2.0 / 2.5;
- minimum residual 25 / 35 / 50 bps;
- holding 1 / 2 / 3 hours;
- equal or signal-score weighting;
- both directions, premium-only or discount-only;
- weighted-average or minimum-leg cost edge gate.

## Selection discipline

Development can send at most 60 candidates to Validation. Validation selects at most one candidate. Final reused and July Holdout are audit-only and cannot select or retune a candidate.

## Acceptance

A winner must simultaneously:

- exceed the frozen V22 router Normal +72.276908% and P95 +68.080022%;
- exceed the frozen V19 fallback-only Normal +7.813259% and P95 +7.400908%;
- have at least eight Validation router trades and four basket trades;
- keep Validation, Final reused and July Holdout Normal/P95 positive;
- keep Normal PF at least 1.5 and DD no worse than -15%;
- keep positive-profit concentration at or below 40%, calculated across underlying legs rather than basket labels;
- remain positive after removing the best trade and best month;
- fail closed under Severe 100 bps cost.

## Limitations

The data uses Yahoo 60-minute cash history and Aster 30-minute candle/Funding history. It cannot reconstruct live spread, depth, queue position or exact post-only fills. The historical window has already been inspected and is not an independent Holdout.

## Safety

Research only. Production, LIVE, VPS, credentials, Crypto V96, V11-EQ, V19, V13D, orders and positions must not change.
