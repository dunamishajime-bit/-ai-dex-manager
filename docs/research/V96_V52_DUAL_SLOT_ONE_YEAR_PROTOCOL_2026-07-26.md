# V96 + V52 Dual-Slot One-Year Compounded Portfolio Backtest Protocol

## Fixed period

- Start inclusive: 2025-07-25 00:00 UTC
- End exclusive: 2026-07-25 00:00 UTC
- Calendar span: exactly 365 days
- The V52 trailing-one-year window is authoritative. Crypto V96 is replayed over the same dates.

## Fixed architecture

- Crypto: current V96 Core Volume50 / Turnover7.5 plus reserved PENGU sequence
- Crypto Gross cap: 1.0
- Stock: V52 = V11-EQ + V50 Post-Open Basis dual slot
- Stock combined Gross cap: 1.5
- V11-EQ maximum Gross: 1.0
- V50 maximum Gross: 1.0
- V50 receives only remaining Stock capacity:
  - 1.0 when the Stock sleeve is otherwise free
  - 0.5 when V11-EQ already uses Gross 1.0
- Total account Gross cap: 2.5
- No sleeve lending
- Same-symbol concurrent Stock entries are forbidden
- No forced replacement or preemption

## Compounding and chronology

Crypto V96 completed-return events and Stock Entry/Exit events are merged into one chronological timeline. Returns are applied to one account equity curve event by event. Results are not produced by adding separate sleeve percentages.

The -2% daily loss lock is evaluated on the combined portfolio at completed-event resolution. The triggering event remains in the result; later events on the same UTC day are blocked.

## Stock execution costs

- Forward median: 24 bps round trip
- Normal: 40 bps round trip
- P95: 44 bps round trip
- Severe: 100 bps round trip

Crypto uses the matching V96 Normal or Severe event series.

## Required comparisons

For every scenario report:

- Unified V96 + V52 compounded portfolio
- V96 only
- V52 only
- CAGR
- maximum drawdown
- profit factor
- accepted V11-EQ trades
- accepted V50 trades
- observed Crypto, Stock and total Gross

## Interpretation constraints

- V11-EQ and V50 use reused historical evidence and are not independent Holdout validation.
- Historical Stock execution cannot reconstruct exact bid/ask, depth, queue position, partial fills or sub-second slippage.
- Crypto V96 contains the fixed historical PENGU sequence.
- Production, LIVE, VPS, credentials, orders and real positions are unchanged.
