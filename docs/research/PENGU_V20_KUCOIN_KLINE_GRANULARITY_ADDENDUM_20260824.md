# PENGU V20 — KuCoin H1 Granularity Normalization Addendum

Status: PRE-REGISTERED BEFORE ANY KUCOIN STRATEGY PERFORMANCE WAS CALCULATED

RESEARCH ONLY. No LIVE/VPS/orders/production changes.

## Context

Frozen V20 candidate remains `COUNTERWIND_VOL_TARGET_FAILURE_EXIT` with pre-registration SHA `ad7cedb3cafaf9f9680e390112f72375d84b50ac`.

Known-venue formal run `32683827489` passed OKX, Binance, Gate diagnostic, and Bitget. KuCoin holdout opening SHA is `8ed0f2b3399e0d24882c5852cb7b336f874f441f`. BTC symbol normalization was frozen at `1a5f75577b426386a5f76179e220c28ba00cf821` (`BTCUSDTM` -> canonical `XBTUSDTM`).

The corrected-symbol KuCoin holdout run `32684789936` still did **not** calculate strategy performance. Contract validation succeeded and the evaluator reached the first Classic Futures Kline request, but KuCoin returned HTTP 400 because the request encoded the H1 granularity as `3600`.

Official KuCoin Classic Futures Kline API `/api/v1/kline/query` expresses `granularity` in minutes; the official H1 request uses `granularity=60`. Therefore this addendum corrects only the API representation of the already-frozen H1 interval.

## Frozen normalization

Exactly one technical request-encoding change is permitted:

- incorrect Classic Futures H1 encoding: `granularity=3600`
- canonical Classic Futures H1 encoding: `granularity=60`

The economic/timeframe meaning remains exactly one hour. No candle interval, strategy, feature, threshold, sizing, fee, funding, evaluation period, or promotion criterion changes.

All other holdout terms remain unchanged:
- PENGU `PENGUUSDTM`;
- BTC reference `XBTUSDTM`;
- official KuCoin Futures public data only;
- H1 grid from `2025-01-01T00:00:00Z` through the final completed H1 before `2026-08-01T00:00:00Z`;
- first eligible evaluation after 168 completed H1 warmup bars at `2025-01-08T00:00:00Z`;
- official PENGU funding history required;
- no synthetic/fill-forward/interpolation/substitute data;
- unchanged frozen V20 Normal/Stress evaluator and strict promotion gates.

No other Kline parameter reinterpretation is allowed after this addendum. If official KuCoin data fail the already-frozen completeness checks, report BLOCKED. If strategy performance is calculated, the result is final for V20 and V20 may not be edited.

## Safety

- `RESEARCH_ONLY`
- ordersSent=false
- liveChanged=false
- vpsChanged=false
- productionChanged=false
