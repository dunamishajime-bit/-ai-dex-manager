# 2026-10-27 V12 V4 C/D + RENDER eight-strategy research BT — evidence

**RESEARCH ONLY — not the production Q102 target-SHA economic certificate, not exchange L2 parity.**

10bps: **294,927,901.13 JPY** final, 1,286 closed trades, max MTM DD -14.8442%, PF 4.6378.

30bps: **175,582,530.86 JPY** final, 1,283 closed trades, max MTM DD -14.7484%, PF 3.7182.

Source study 2026-10-27; period 2025-08-10 through 2026-08-10; initial capital 10,000 JPY, monthly contribution 0. Modeled 8 sleeves V12/Q102/PENGU/IDLE/RESIDUAL/V52/HYPE_LONG/FET.

Full evidence for both costs:
- `trades.jsonl.gz`: one closed modeled trade per line, exact raw ledger SHA-256 from the research report.
- `candidate-decisions.jsonl.gz`: all decisions/rejections.
- `portfolio-events.jsonl.gz`: wallet/portfolio event stream.
- `mtm.jsonl.gz`: mark-to-market equity and drawdown trace.
- `crypto-candidates.jsonl.gz`: chronological input opportunities.
- `integrated-summary.json`, `result.json`, `metrics.json`, `quantity-production-vectors.json`, `portfolio-price-model-summary.json`: original outcome and quantity/fee evidence.
- `strategy-monthly-route-analysis.json`: independent trade count breakdown, win rate and route composition from closed trade files.
- Root `manifest.json`: original paths, SHA-256 for every copied source, compressed asset hashes, source candidate SHA and limitations.

Both representative ledgers exactly match original reported raw SHA-256 and recorded closed-trade counts. Three repeated research replays are preserved on the owner PC; only canonical representative runs are committed, to prevent byte-identical redundant data.

**Important source gap:** the original generation wrapper `bt_v12_v4_cd_render_wrapper.py` is no longer found at its reported path; the native 8 engine source and original source commit are recorded, but fully independent fresh signal regeneration from current Production source is not proven. The old Q102 live SHA is not the target `ef1ab178e26a7bf5bddb6473467765edba242e1d`; the archived historical Q102 trade stream must not be relabelled as exact new-SHA economics.

To inspect: `gzip -dc 10bps/trades.jsonl.gz`; validate against `manifest.json` rawSha256.
