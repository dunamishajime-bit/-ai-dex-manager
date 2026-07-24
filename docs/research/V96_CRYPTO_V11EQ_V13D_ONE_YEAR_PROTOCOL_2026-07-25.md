# V96 Crypto + V11-EQ + V13D One-Year Backtest Protocol

## Fixed period

- Start inclusive: 2025-07-01 00:00 UTC
- End exclusive: 2026-07-01 00:00 UTC
- Calendar span: 365 days

## Portfolio architecture

- Crypto V96 sleeve Gross cap: 1.0
- Stock sleeve Gross cap: 1.0
- Portfolio Gross cap: 2.0
- No sleeve lending
- V13D has first priority at 10:00 New York
- V11-EQ is evaluated at 10:30 New York only when V13D did not open
- Maximum one Stock position
- Crypto and Stock do not cancel, replace, or preempt each other
- Daily loss lock: -2% at completed-event resolution

## Frozen strategy lineage

- Crypto research base: `17d2acd512dac75f6c9b7c427cb4995b6ab8c81b`
- V11 source: `0fad24c105a7f0f61af6042ba04a8b1386ffec7c`
- V13D source: `dbfd7e026a81343a23ab97d202761f7f9bbe5755`

## V11-EQ observable historical proxy

The signal and exit logic remain the frozen V11 candidate:

- Candidate: `BOTH__FLAT__CONVERGENCE__ABS_TOP1`
- Both premium-short and discount-long
- Signal Basis floor: 50 bps
- Top1 only
- Basis convergence at 15 bps or zero-cross
- Basis stop at 1.5x entry Basis
- Otherwise exit 15:30 New York

The historical EQ proxy applies these observable or scenario-resolved checks before entry:

- Entry Basis remains at least 50 bps
- The originally selected symbol remains absolute-Basis Top1 at entry
- Cash and Aster entry clocks differ by no more than 1.5 seconds
- Absolute Basis has not expanded adversely by more than 10 bps
- Estimated round-trip cost is no more than 60 bps
- Estimated cost / Entry Basis is no more than 75%
- Estimated Net Edge = Entry Basis - 15 bps - estimated round-trip cost is at least 10 bps

For each cost scenario, its V11 round-trip cost is treated as known before entry. This is an optimistic assumption whenever real cost deterioration cannot be detected in advance.

## Inputs unavailable historically

The V11 dataset cannot reconstruct:

- live bid/ask spread;
- order-size depth and slippage;
- sub-second freshness beyond source timestamps;
- two-second adverse moves;
- post-only queue position;
- partial fills or at least 90% fill.

Therefore the main result is labelled an **observable historical proxy**, not a full V11-EQ backtest.

A separate strict fail-closed lower bound rejects all V11-EQ entries because those required inputs are unavailable. That lower bound is equivalent to Crypto V96 + V13D under the same Normal scenario and daily-loss routing.

## Cost scenarios

- Forward median Stock / Crypto Normal: V11 12 bps one-way; V13D 10 bps cycle
- Normal: V11 20 bps one-way; V13D 16 bps cycle
- Stock P95 / Crypto Normal: V11 22 bps one-way; V13D 26 bps cycle
- Severe: V11 50 bps one-way; V13D 45 bps cycle; Crypto Severe

## Interpretation constraints

- V11 and V13D use overlapping reused history and are not independent Holdout evidence.
- V13D still relies on a strict candle fill proxy.
- Crypto V96 includes the fixed historical PENGU sequence.
- Production, LIVE, VPS, credentials, orders, and real positions are not changed by this workflow.
