# Aster-only V16 Relative-Value Pair Tournament Protocol

## Purpose

Test whether a same-exchange, market-neutral Aster Stock-perpetual pair can replace the cross-exchange V13D while keeping all collateral on AsterDEX.

V16 uses two Aster positions, but total Gross remains 1.0: one 0.5-Gross Long and one 0.5-Gross Short. It does not require a separate Hyperliquid balance, and its capital-hour calculation counts one Aster Gross unit rather than two separately funded venue legs.

This is research only. Production, LIVE, VPS, Crypto V96, V11-EQ, V13D, credentials, orders and positions are unchanged.

## Frozen inputs

- Aster Stock perpetuals: AMZN, META, MSFT, NVDA and TSLA;
- Yahoo public 60-minute underlying-equity history as the historical cash proxy;
- Aster 30-minute trade candles and actual Funding;
- period: 2025-07-01 inclusive through 2026-07-01 exclusive;
- V11 data source commit: `0fad24c105a7f0f61af6042ba04a8b1386ffec7c`;
- V13D source commit: `dbfd7e026a81343a23ab97d202761f7f9bbe5755`;
- frozen one-year V13D benchmark: workflow `30117325883`, artifact `8605974635`, digest `sha256:6f2ff3b5fd6b3429da436d2bef1887f3fe407e424319212013655ce6ad7c60bc`.

## Entry times

Only causal observations at these New York times may be used:

- 11:30;
- 12:30;
- 13:30.

A candidate either uses one fixed time or enters at the first chronological eligible time. It cannot inspect later times and then choose the best earlier opportunity.

## Fixed pair families

Exactly five relative-value metrics are declared before the run:

1. raw cash/Aster Basis spread;
2. 20-day same-time Basis-residual spread;
3. same-time standardized Basis-residual spread;
4. one-hour Basis-shock spread;
5. Funding-aligned residual spread.

At entry, the lowest metric symbol is bought and the highest metric symbol is sold. No symbol is selected from future returns.

Thresholds are fixed as follows:

- raw Basis, residual and shock spread: 80 / 120 / 160 bps;
- z-score spread: 2 / 3 / 4 standard deviations;
- Funding-aligned residual spread: 80 / 120 / 160 bps.

Each candidate combines one family/threshold with four entry policies, one- or two-hour maximum holding, and either fixed-time or 50%-spread-convergence exit.

Total candidates: 240.

No new family, threshold, slot, holding time or exit may be introduced after seeing V16 results on this history.

## Execution model

- AsterDEX only;
- Long leg Gross 0.5;
- Short leg Gross 0.5;
- total Gross 1.0;
- no Hyperliquid position;
- no cash-equity execution;
- maximum one pair per day;
- maximum holding one or two hours;
- no overnight inventory;
- actual Aster Funding on both legs included;
- pair stop when the signal spread expands to 1.5 times its entry value;
- pair loss stop at -1.0%;
- pair take-profit at +0.75%;
- convergence candidates exit when the same-pair metric spread falls to 50% of entry or crosses.

## Cost gate

Round-trip cost scenarios for total Gross 1.0:

- Forward median: 24 bps;
- Normal: 40 bps;
- P95: 44 bps;
- Severe: 100 bps.

Entry is rejected when:

- estimated round-trip cost exceeds 60 bps; or
- one-half of the observable pair metric spread minus estimated cost is below 10 bps.

The Severe scenario deliberately fails closed.

## Chronological discipline

- first 50% of aligned sessions: Development;
- next 25%: Validation;
- final 25%: final reused-history diagnostic;
- Development retains at most 20 candidates;
- Validation may select one winner;
- final diagnostics run once;
- no final-period retuning.

The final period is not an independent Holdout because related Stock research has already examined it.

## Historical replacement target

A candidate reaches the historical target only if:

- Development and Validation pass;
- Validation has at least five accepted Normal pairs;
- final chronological Normal and P95 returns are positive;
- full Normal and P95 returns are each at least V13D;
- Severe is non-negative through the cost gate;
- Normal net bps per Aster capital-hour is at least the two-venue V13D capital efficiency.

A historical pass remains Shadow-only and requires untouched Pyth/IEX plus Aster order-book Forward evidence before Production.
