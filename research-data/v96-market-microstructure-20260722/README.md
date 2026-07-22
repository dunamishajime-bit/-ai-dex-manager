# V96 three-day market microstructure data

- Status: ACTIVE
- Symbols: BTCUSDT, ETHUSDT, BNBUSDT, SOLUSDT
- Collection window: 2026-07-22 00:00 UTC through 2026-07-25 00:00 UTC
- Japan time: 2026-07-22 09:00 through 2026-07-25 09:00
- Snapshot interval: 60 seconds
- Scheduled chunk: up to 50 minutes each hour
- Data: Funding, Mark/Index/Premium, Open Interest, order-book depth, spread, 5/10/25 bps depth imbalance, last price, and liquidation events
- Safety: evidence only; order submission disabled; Production/LIVE strategy unchanged

Collected gzip JSONL chunks and per-run summaries are appended under `chunks/` by GitHub Actions.
