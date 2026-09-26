# Formal five-logic backtest methodology

## Scope

The research runner covers V12, PENGU, Q102, FET, and V52 using the read-only audited production source snapshot identified in `research/formal_five_bt/runtime_source_manifest.json`. The requested UTC period is 2025-08-10 through 2026-08-10. Starting capital is ¥10,000, followed by twelve ¥10,000 monthly contributions. Deposits are accounted for separately from trading returns and converted with an as-of FRED DEXJPUS observation.

This work does not modify the production runtime, VPS deployment, live strategy settings, production data, or live orders.

## Decision and data controls

- Strategy decisions are emitted by the audited runtime functions using completed, time-aligned Aster native perpetual candles. Look-ahead checks reject source events at or after a decision cutoff.
- The runtime shared portfolio planner is exposed through the source bridge and contract-tested. Candidate signals are not advanced into portfolio positions unless their fills and portfolio state can be verified. Decisions, named gates, and reasons are retained in local JSONL outputs.
- Binance, Bybit, OKX, and Aster data can serve only as contemporaneous execution proxies after exact perpetual-contract mapping and archive integrity checks. A book is executable only if it has a valid full snapshot, continuous sequence updates, fresh timestamps, and sufficient depth for the modeled order.
- Fills consume visible depth. Maker execution requires verified trade-through. If an intrabar candle touches stop and target without a known ordering, the adverse stop is selected and flagged. Funding uses the position-side cash-flow sign.
- V52 uses the audited decision schedule and the official NYSE session calendar, including early closes. A listed-equity quote is not treated as a stock-perpetual quote or fill.
- NORMAL and SEVERE execution assumptions are evaluated separately for both proxy-applied and Aster-only data-coverage paths. The first 50 days omit V52; the Aster-only path skips crypto entries when its required Aster execution coverage is absent.
- Missing or invalid data, fees, contract metadata, or execution history blocks a qualified fill. Performance fields stay null whenever verified fills and exits are not established.

## Acceptance and interpretation

The runner writes a source manifest, per-decision gate logs, candidate/order rows, coverage findings, scenario metrics, and deterministic SHA256 output hashes. A signal count is not a trade count. A complete BT comparison requires every counted entry and exit to have attributable, time-causal execution evidence, with costs, funding, margin, and shared portfolio controls accounted for.

Raw market data and detailed market-derived outputs are intentionally excluded from the public repository. The locally retained run report is the source for data-specific coverage and result status. Public artifacts document the method and executable checks; they do not publish market-derived performance figures.

## Reproduction

See `research/formal_five_bt/README.md` for the Python/Node requirements, local-only input layout, commands, four scenarios, and test command. Runtime source and data hashes must match the local run manifest before comparing results.

## Official FX source change (2026-09-27)

Fresh Aster candles/funding for 32 instruments were acquired successfully, but official FRED `DEXJPUS` timed out from both the CI runner and authorized VPS. For the next isolated research replay, the explicitly labeled fallback is the official ECB daily EUR reference rates, `JPY per EUR / USD per EUR`, paired by identical business date. This substitute never masquerades as FRED. It is conservatively unavailable until the final millisecond of the recorded UTC day and both raw ECB legs and derived observations are hash recorded. The run manifest reports the FX provider so returns calculated with an ECB cross are not declared exact parity with a FRED DEXJPUS run.
