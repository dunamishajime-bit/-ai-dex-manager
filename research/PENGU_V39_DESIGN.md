# PENGU Dual-Engine V39

PENGU remains a required Dis-Dex Manager return engine, but Long and Short are no longer forced into one symmetric 72-hour rule.

## Frozen design before results

- Data: Aster public PENGUUSDT/BTCUSDT 1h OHLCV and PENGU funding
- Decisions: every completed 6h block; entry at next 1h open
- Long families: trend continuation and confirmed breakout
- Short families: confirmed breakdown and funding/RSI exhaustion
- Exits: 24h/48h/72h time exits and ATR TP/SL exits
- Long and Short are selected independently on Development and Validation
- Frozen Holdout is read only after each side has a stable neighboring cluster
- No overlapping PENGU positions
- Normal and Severe fee/slippage/funding assumptions
- No fixed historical trade timestamps
- No production, VPS, account, order or live-flag changes

## Promotion requirements

Each side must independently have positive Development, Validation and Frozen Holdout return, PF >= 1.0 in Frozen Holdout, positive Severe Frozen Holdout return, and acceptable drawdown. The combined Long/Short engine must also pass. A side that fails remains disabled rather than being substituted with historical trades.

Order-book imbalance, spread compression, taker flow and basis from the ongoing V19 collection are reserved for a forward-only entry VETO after the historical rule is frozen.