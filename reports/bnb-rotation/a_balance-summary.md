# BNB Rotation Backtest - A_BALANCE

- btc_sma: 90
- candidate_sma: 40
- rebalance_bars: 11
- avax_mom_threshold: 0.25
- sol_overheat_limit: 0.35
- target_alloc: 0.995
- fee_rate: 0.003
- runtime_config: {"strategy_mode":"A_BALANCE","fee_rate":0.003,"target_alloc":0.995,"engine":"RECLAIM_HYBRID_V1","strategy_id":"reclaim_plus_avax_sol_aux_alloc040_relaxed_baseline","max_concurrent_positions":1,"max_trade_size_pct":40,"stable_reserve_pct":5,"hard_stop_loss_pct":8,"max_slippage_bps":90,"quote_providers":["paraswap","openocean"],"price_providers":["coingecko","coincap","binance","cache"],"symbols":{"btc":"BTCUSDT","core":["ETHUSDT","SOLUSDT"],"avax":"AVAXUSDT"}}

## Strategy Snapshot
- {"mode":"A_BALANCE","btcSma":90,"candidateSma":40,"rebalanceBars":11,"avaxMomThreshold":0.25,"solOverheatLimit":0.35,"targetAlloc":0.995,"feeRate":0.003,"symbols":{"btc":"BTC","core":["ETH"],"avax":"AVAX"}}

## Summary
- CAGR: 42.28%
- Max DD: -49.99%
- Win Rate: 36.49%
- PF: 1.45
- Trades: 74
- Exposure: 33.59%

## Symbol Contribution
- ETH: 17653.63
- SOL: 20384.28
- AVAX: -7917.09

## Files
- C:\Users\dis\-ai-dex-manager\reports\bnb-rotation\a_balance-trade_log.csv
- C:\Users\dis\-ai-dex-manager\reports\bnb-rotation\a_balance-equity_curve.csv
- C:\Users\dis\-ai-dex-manager\reports\bnb-rotation\a_balance-monthly_returns.csv
- C:\Users\dis\-ai-dex-manager\reports\bnb-rotation\a_balance-performance_summary.json