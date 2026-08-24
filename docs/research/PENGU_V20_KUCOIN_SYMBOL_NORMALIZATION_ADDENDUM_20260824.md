# PENGU V20 — KuCoin BTC Symbol Normalization Addendum

Status: PRE-REGISTERED BEFORE ANY KUCOIN STRATEGY PERFORMANCE WAS CALCULATED

RESEARCH ONLY. No LIVE/VPS/orders/production changes.

## Context

Frozen V20 candidate remains `COUNTERWIND_VOL_TARGET_FAILURE_EXIT` with pre-registration SHA `ad7cedb3cafaf9f9680e390112f72375d84b50ac`.

Known-venue formal run `32683827489` passed OKX, Binance, Gate diagnostic, and Bitget. KuCoin holdout opening was authorized at SHA `8ed0f2b3399e0d24882c5852cb7b336f874f441f`.

The first KuCoin technical holdout run `32684353006` did **not** calculate any strategy performance and did not fetch H1 candles or funding history. It stopped during contract-identity validation because the frozen BTC reference identifier `BTCUSDTM` does not exist on KuCoin Futures (`404000`).

Official KuCoin contract naming identifies the BTC-USDT perpetual swap as `XBTUSDTM`. This addendum corrects only that exchange-specific symbol identifier. It does not change the economic reference asset (BTC), venue, perpetual contract family, data period, granularity, funding model, strategy, rule, threshold, sizing, cost model, or promotion gate.

## Frozen normalization

Exactly one technical identifier change is permitted:

- invalid/nonexistent KuCoin identifier: `BTCUSDTM`
- canonical KuCoin BTC-USDT perpetual identifier: `XBTUSDTM`

PENGU remains exactly `PENGUUSDTM`.

All other KuCoin holdout contract terms remain unchanged:
- official KuCoin Futures public data only;
- H1 candles only;
- raw history from `2025-01-01T00:00:00Z`;
- 168 completed H1 warmup bars before first eligible evaluation at `2025-01-08T00:00:00Z`;
- cutoff `2026-08-01T00:00:00Z`;
- official PENGU funding history required;
- no synthetic/fill-forward/interpolation/substitute venue data;
- same frozen V20 Normal/Stress evaluator and strict promotion gates.

No other symbol or data-source substitution is allowed after this addendum. If the corrected canonical `XBTUSDTM` contract or required KuCoin history cannot satisfy the already-frozen completeness checks, the holdout is BLOCKED. If strategy performance is calculated, that result is final for V20 and V20 may not be edited.

## Safety

- `RESEARCH_ONLY`
- ordersSent=false
- liveChanged=false
- vpsChanged=false
- productionChanged=false
