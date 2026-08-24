# PENGU V20 — KuCoin H1 Page-Limit Normalization Addendum

Status: PRE-REGISTERED BEFORE ANY KUCOIN STRATEGY PERFORMANCE WAS CALCULATED

RESEARCH ONLY. No LIVE/VPS/orders/production changes.

## Context

Frozen V20 candidate remains `COUNTERWIND_VOL_TARGET_FAILURE_EXIT` with pre-registration SHA `ad7cedb3cafaf9f9680e390112f72375d84b50ac`.

Known-venue formal run `32683827489` passed OKX, Binance, Gate diagnostic, and Bitget. KuCoin holdout opening SHA is `8ed0f2b3399e0d24882c5852cb7b336f874f441f`. BTC symbol normalization was frozen at `1a5f75577b426386a5f76179e220c28ba00cf821`. H1 granularity normalization was frozen at `ffcc138803f7d573d1ae3597288e3c66602c5ee9`.

KuCoin holdout run `32685024323` did **not** calculate strategy performance. Contract validation and market-data access succeeded, but the frozen completeness gate stopped the run because PENGU H1 contained `5800` bars instead of the expected `13848`; `strategyPerformanceCalculated=false`, `kucoinPerformanceObserved=false`, and `finalHoldoutPass=null`.

The missing-grid pattern proves the downloader was advancing farther than the number of candles returned per request. The request window covered 480 H1 timestamps while the observed KuCoin response supplied 200 H1 candles. Across the frozen evaluation span this produced exactly `29 * 200 = 5800` retained candles and skipped the unreturned remainder of each oversized request window.

## Frozen normalization

Exactly one technical pagination change is permitted:

- previous request window: `cursor + 479 * HOUR` (up to 480 H1 timestamps)
- corrected request window: `cursor + 199 * HOUR` (up to 200 H1 timestamps)

This change only prevents the downloader from advancing beyond the maximum number of H1 candles actually returned per KuCoin request. It does not alter candle interval, timestamps, market, strategy logic, features, thresholds, sizing, fees, funding treatment, evaluation period, stress assumptions, or promotion criteria.

All other holdout terms remain unchanged:
- PENGU `PENGUUSDTM`;
- BTC reference `XBTUSDTM`;
- Classic Futures H1 Kline `granularity=60`;
- official KuCoin Futures public data only;
- H1 grid from `2025-01-01T00:00:00Z` through the final completed H1 before `2026-08-01T00:00:00Z`;
- first eligible evaluation after 168 completed H1 warmup bars at `2025-01-08T00:00:00Z`;
- official PENGU funding history required;
- no synthetic/fill-forward/interpolation/substitute data;
- unchanged frozen V20 Normal/Stress evaluator and strict promotion gates.

If the corrected downloader still fails the frozen completeness checks, report BLOCKED. If complete market data are obtained and strategy performance is calculated, that KuCoin result is final for frozen V20 and the strategy may not be edited in response to it.

## Safety

- `RESEARCH_ONLY`
- ordersSent=false
- liveChanged=false
- vpsChanged=false
- productionChanged=false
