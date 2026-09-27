# Formal five-logic backtest engine

This package implements a reproducible research runner for the audited V12, PENGU, Q102, FET, and V52 production decision logic. It does not deploy code, place orders, or change the live runtime.

## Result status

The runner fails closed. A candidate signal is not a fill. If a same-time execution book, continuous venue sequence, applicable fee, contract mapping, or required market session cannot be verified, the candidate remains skipped or `NOT_VERIFIABLE`; unavailable P&L metrics remain null. Do not treat null as a zero return.

Market data, candidate-level decisions, ledgers, and result reports belong in the ignored local `research-runs/formal-five-logic-bt/` directory and are intentionally not included in Git.

## Inputs and sources

- Strategy OHLC and funding use Aster's native USDT perpetual instruments. Alternate-venue candles never replace Aster strategy inputs.
- Binance, Bybit, OKX, or Aster historical order-book archives may be considered for same-time execution only after instrument mapping, a valid snapshot, a continuous update sequence, and freshness checks pass.
- JPY contributions use the last FRED DEXJPUS observation available as of each contribution event.
- V52 session gates use official NYSE regular-session dates and early closes. Underlying equity bars alone do not establish Aster stock-perpetual execution prices or fills.
- Raw provider responses and detailed market-derived files are local-only. Respect each source's access terms and redistribution limits.

## Running

Use Python 3.12 with `requirements.txt`, Node.js 24, the exact audited runtime-source snapshot, and locally acquired data. Acquisition and signal-scan output directories must remain local and must match the runtime SHA recorded in `runtime_source_manifest.json`.

```powershell
python -m research.formal_five_bt.acquire --data-root <local-data>
python -m research.formal_five_bt.signal_scan --data-root <local-data> --output-root <local-scans-parent>/baseline-signal-scan --strategies V12 PENGU FET
python -m research.formal_five_bt.signal_scan --data-root <local-data> --output-root <local-scans-parent>/baseline-signal-scan-q102 --strategies Q102
python -m research.formal_five_bt.engine --data-root <local-data> --scan-root <local-scans-parent> --l2-root <local-l2> --output-root <local-run>
```

The engine emits `NORMAL_PROXY_APPLIED`, `SEVERE_PROXY_APPLIED`, `NORMAL_ASTER_DATA_ONLY`, and `SEVERE_ASTER_DATA_ONLY`. A complete economic comparison is available only when the run manifest reports verified fills and closed trades. The engine also stores per-decision gates, candidate/order lifecycle rows, coverage diagnostics, and SHA256 hashes under the local output directory.

Run tests with:

```powershell
python -m unittest discover -s tests/formal_five_bt -v
```

The accepted behavior, methodology, and audited-source scope are documented in `docs/research/formal-five-logic-bt-spec.md`, `docs/research/formal-five-logic-bt-methodology.md`, and `research/formal_five_bt/runtime_source_manifest.json`.

## User-requested V52 Yahoo price-only research path (2026-09-27)

V52 can now be evaluated **separately** with Yahoo Finance historical 60-minute
prices, without requiring historical order-book snapshots for a *modeled* fill.
This is deliberately not a verified Aster stock-perpetual execution or a
production strategy change. Missing, stale, or out-of-session quotes do not
produce a modeled fill. The initial 50-day V52 omission remains in effect.

First acquire the five stock-reference series into the same ignored, local
data root (Yahoo historical hourly retention and API availability may vary):

```powershell
python -m research.formal_five_bt.yahoo_acquire --output-root <local-data> --start 2025-08-10 --end-exclusive 2026-08-11
```

The engine reads `<local-data>/normalized/yahoo/60m/{AMZN,META,MSFT,NVDA,TSLA}.jsonl`
by default. It consumes **actual historical V52 SIGNAL decision rows**
and checks the accompanying `signal-scan-manifest.json` for the exact audited
runtime SHA; a calendar schedule or Yahoo price move is **not** a V52 signal.
Place the audited scan at
`<local-scans-parent>/baseline-signal-scan-v52/decisions/V52.jsonl`
with its sibling scan manifest, or supply `--v52-signal-file <local-V52.jsonl>`
and `--v52-yahoo-root <local-Yahoo-60m-dir>`.

For signals that pass the audited source gate, a fill is modeled immediately
at the last completed, same-session Yahoo hourly close at the signal time.
If the bar is older than 15 minutes, missing, or only available in the
future, that candidate is not filled. All such entries are tagged
`MODELED_PRICE_FILL` and `fill_verified=false`; fees, funding, exits, and
combined performance remain unavailable until the audited order and risk
replay is implemented. The four formal scenarios still preserve
`NOT_VERIFIABLE` performance fields instead of manufacturing returns.

Run the offline regression checks:

```powershell
python -m unittest discover -s tests/formal_five_bt -p 'test_yahoo_*.py' -v
```

## Separately provenanced V52 hourly basis research input

A stock-perpetual-price + Yahoo-equity-price model can produce V50 research
candidates without requiring historical order-book data. It is **not the
original fully verified LIVE decision**: historical spread/depth and
second-resolution basis checks remain unavailable. The model uses the
SHA-matched historical V50 policy and completed same-session hourly bars.

Acquire the official public Aster stock-perpetual 1h series and the Yahoo
reference 60m series into the same local-only data root, restore the historical
runtime snapshot, and produce the price-only research scan:

```sh
python -m research.formal_five_bt.restore_snapshot
python -m research.formal_five_bt.aster_stock_acquire --data-root <local-data>
python -m research.formal_five_bt.yahoo_acquire --output-root <local-data>
python -m research.formal_five_bt.v52_price_only_scan --data-root <local-data> --output-root <local-v52-research>
```

Supply `--v52-research-scan-root <local-v52-research>` to the integrated
engine. It verifies the research model, audited runtime SHA, full decision
stream SHA256, manifest row/count reconciliation, one selected stock per
window, and absence of any asserted verified fill or realized P&L.

Selected research rows are included in the four scenario **decision-gates**
files and independently counted by month in
`V52_V50_PRICE_RESEARCH`. They do **not** inflate formal LIVE
`candidate_signals`, `verified_fills`, closed trades, portfolio profit or
DD. A separate portfolio allocation and conservative entry/exit lifecycle
will be required before reporting modeled V52 return. If the supplied model
fails provenance checks, its research input is reported `NOT_VERIFIABLE`
without contaminating the remaining strategy tracks.
