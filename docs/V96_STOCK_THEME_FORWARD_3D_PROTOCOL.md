# V96 Stock Theme Forward 3-Day Protocol

## Frozen window

- Start: 2026-07-22 01:00 UTC / 10:00 JST
- End: 2026-07-25 01:00 UTC / 10:00 JST
- Universe: fixed 22 Aster stock perpetual symbols declared in the workflow
- Themes: AI and Semiconductor
- Collection interval: 60 seconds within scheduled chunks

## Evidence

- Funding rate
- Mark price and index price
- Mark-index premium
- Open Interest
- best bid/ask and Spread
- order-book depth and 5/10/25 bps imbalance
- last price
- liquidation events

## Validation policy

The three-day window may validate only:

1. endpoint and WebSocket reliability;
2. symbol synchronization and missing-data rate;
3. market-liquidity feasibility;
4. isolation from V96 BTC/ETH/BNB/SOL/PENGU allocation;
5. gross-cap clipping contract.

Three days cannot validate profitability or authorize Production. Historical directional and market-neutral rules remain rejected. No threshold may be retuned during the collection window.

## Safety

- mode: SHADOW
- orderSubmissionAllowed: false
- current V96 weights mutable: false
- stock-theme requested Gross cap: 0.10
- total portfolio Gross cap: 2.0
- Production, LIVE, VPS and order routes unchanged
