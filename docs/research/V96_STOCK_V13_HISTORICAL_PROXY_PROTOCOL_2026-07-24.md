# V96 Stock V13 Historical Proxy Backtest Protocol — 2026-07-24

## Purpose

Run a historical economic-viability test for the frozen V13 Aster/XYZ Maker-Hedge family before relying only on the 20-session Forward collector.

This backtest does not claim exact V13 execution parity because historical candles cannot reconstruct displayed queue priority, cancellations ahead, aggressive-trade direction, exact best bid/ask, or the frozen 250 ms hedge path.

## Fixed data

- Venues: Aster stock perpetuals and XYZ HIP-3 on Hyperliquid
- Universe: AMZN, META, MSFT, NVDA, TSLA
- Fixed data end: 2026-07-24 00:00 UTC
- Sources: Aster public klines and Hyperliquid `candleSnapshot`
- Intervals: 1 minute and 15 minutes
- Hyperliquid limit: most recent 5000 candles per interval
- U.S. regular-session bars only

## Frozen rule

- Cross-venue dislocation threshold: 12 bps
- Initial virtual maker notional: 100 USD
- Maker venue evaluated separately as Aster and XYZ
- Direction: sell the premium venue and buy the discount venue
- One active cycle per symbol
- No threshold, symbol, interval, cost, or direction optimization
- Minimum maker-bar notional capacity proxy: 350 USD

## Fill models

### OPEN_CROSS_STRICT

The next bar open must already be at or through the prior completed-bar maker quote. This is the primary historical fill proxy.

It remains incomplete because it cannot prove that the displayed queue ahead was consumed or that the virtual order received a full fill.

### INTRABAR_TOUCH_UPPER

The next bar high or low may touch the prior maker quote. This is an optimistic upper bound and cannot be treated as executable evidence.

## Holding horizons

### 1 minute

The primary economic proxy. Entry is followed by one interval of inventory and a forced close at the next bar open, approximating V13's 60-second maximum inventory age.

### 15 minutes

A longer-history structural persistence diagnostic only. It is not V13 execution parity and cannot override the 1-minute result.

## Costs

Two-Maker lower-cost envelope:

- Forward median: 6 bps
- Normal: 10 bps
- P95: 17 bps
- Severe: 30 bps

Forced-Taker close envelope used for the primary decision:

- Forward median: 10 bps
- Normal: 16 bps
- P95: 26 bps
- Severe: 45 bps

## Decision rule

The primary decision uses the 1-minute `OPEN_CROSS_STRICT` result under forced-Taker costs for both Maker venues.

A positive historical proxy requires both Maker-venue variants to retain:

- positive Normal, P95 and Severe average net bps;
- Normal positive-cycle rate of at least 55%;
- at least 20 strict proxy cycles each.

Even a pass only supports continued Forward execution validation. It never authorizes Production or LIVE.

## Safety

- Research only
- Order submission disabled
- Production unchanged
- LIVE unchanged
- VPS unchanged
- Crypto V96 unchanged
- V11 unchanged
- Existing V13 Forward collector unchanged
