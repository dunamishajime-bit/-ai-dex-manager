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

## Documented FX substitute when FRED is network-blocked

The fresh-data runner uses the official ECB daily JPY/EUR divided by USD/EUR cross, with an observation only available after the end of its UTC observation date. The acquisition manifest declares `provider=ECB_DAILY_CROSS_NOT_FRED` and saves both original currency legs and their source hash; it never calls this series FRED DEXJPUS. Results are therefore not directly identical to a FRED-only historical deposit conversion. The GitHub-hosted runner and the authorized VPS both timed out when fetching FRED in the 2026-09-27 source connectivity checks. Re-run with `--fx-source fred` once FRED becomes accessible to compare both official reference series.
