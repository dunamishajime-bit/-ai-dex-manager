# Formal Five-Logic Backtest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and run a reproducible, source-parity backtest for V12, PENGU, Q102, FET, and V52 over 2025-08-10 through 2026-08-10, with shared portfolio controls, validated market data, NORMAL/SEVERE execution cases, and both proxy-applied and Aster-only initial-gap comparisons.

**Architecture:** Keep the backtest isolated under `research/formal_five_bt/`, importing or faithfully porting only decision/risk behavior from the audited runtime SHA `e1b58060d6263a3af7ced51bec854d3e211d2f35`. Separate source acquisition and validation from strategy decisions, deterministic portfolio replay, and report generation. Store raw market data and data-bearing outputs outside Git; commit the engine, tests, schemas, source manifest, and a rights-safe methodology report.

**Tech Stack:** Python for historical-data normalization, event replay, validation, and reports; existing TypeScript live modules and deterministic contract fixtures for production-parity checks; pytest/unittest per available environment; existing Node/TypeScript self-tests only where required by imported runtime contracts.

**Spec:** `docs/research/formal-five-logic-bt-spec.md`

## Global Constraints

- Do not modify VPS files, LIVE strategies, production data, live orders, deployment configuration, or service state.
- Use the running VPS Production Runtime SHA `e1b58060d6263a3af7ced51bec854d3e211d2f35` as source of truth; do not use old BT engines, saved fills, or saved execution results as results inputs.
- Test dates are 2025-08-10 through 2026-08-10 UTC; initial capital is ¥10,000; deposit ¥10,000 on each monthly anniversary from 2025-09-10 through 2026-08-10; total contributions are ¥130,000.
- Separate external deposits from investment returns and use FRED DEXJPUS values available as-of each deposit and valuation timestamp.
- Reproduce the audited live strategy, sizing, shared allocator, margin, drawdown, order lifecycle, fees, funding, slippage, and exits; mark unverified behavior and data explicitly.
- Run NORMAL and SEVERE under PROXY_APPLIED and ASTER_DATA_ONLY; V52 remains omitted from the initial 50 days in both.
- Run V12 variants only after the unchanged baseline is validated; keep HC1.75 fixed and account for profitable baseline trades displaced.
- Do not commit raw market data or detailed market-derived logs/ledgers to the public GitHub repository without publication rights; do not change repository visibility.

## Review Focus

- A decision at a candle boundary must never see that candle's future close, volume, funding, or book update; prove with a timestamp-shift/look-ahead test.
- Missing, stale, discontinuous, or cross-venue-mismatched data must block a modeled fill and surface NOT_VERIFIABLE rather than contribute favorable P&L.
- An intrabar bar touching both protective stop and target must resolve adversely and be flagged in the ledger.
- A deposit must change equity but not profit, return, peak-to-trough DD, or win/loss attribution at the deposit instant.
- A V52 order must not fill outside NYSE sessions or after an official early close, and must not run on stock-perp proxy data during the initial 50-day gap.

---

### Task 1: Freeze the live-source snapshot and verified manifest

**Files:**
- Create: `research/formal_five_bt/runtime_source_manifest.json`
- Create: `research/formal_five_bt/manifest.py`
- Create: `research/formal_five_bt/runtime_source_snapshot/` (local-only, ignored; do not commit duplicated production sources)
- Create: `tests/formal_five_bt/test_runtime_manifest.py`

**Interfaces:**
- Produces a manifest loader consumed by every run; required keys: `runtime_sha`, `units`, `files`, `config_allowlist`, `extraction_utc`, and `secrets_excluded`.

- [x] Write a failing test that accepts the audited SHA and requires every listed source file to have a 64-character SHA256 while rejecting secret-like keys/values.
- [x] Run the test and confirm it fails because the manifest loader was absent.
- [x] Snapshot only allowlisted decision, risk, and execution source files from the active VPS release; never copy `.env`, credentials, account state, or user records. Recompute file SHA256 values locally and record provenance.
- [x] Implement the manifest loader, source hashing, and secret-field rejection.
- [x] Run `python -m unittest discover -s tests/formal_five_bt -p 'test_runtime_manifest.py' -v`; expected: all manifest contract tests pass.

### Task 2: Normalize and validate market data and calendars

**Files:**
- Create: `research/formal_five_bt/market_data.py`
- Create: `research/formal_five_bt/sources.py`
- Create: `research/formal_five_bt/calendars.py`
- Create: `tests/formal_five_bt/test_market_data.py`
- Create: `tests/formal_five_bt/test_sources_and_calendar.py`

**Interfaces:**
- `Bar`, `Quote`, `BookObservation`, `FundingObservation`, and `CoverageIssue` are immutable records carrying exchange, native instrument ID, UTC event time, source time, and content hash.
- `validate_series(records, expected_interval, listed_from, listed_until) -> list[CoverageIssue]` is the sole entry point for dataset verification.
- `deposit_usdt(amount_jpy, at_utc, fx_series) -> FxConversion` uses the last DEXJPUS observation at or before the event time.

- [ ] Write failing tests for duplicate/out-of-order/missing/stale bars, L2 gaps, symbol/contract mismatches, FX future leakage, NYSE holidays and early closes, and stock-perp listing dates.
- [ ] Run the focused tests and confirm expected missing-interface failures.
- [ ] Implement official Aster/Binance/OKX/Bybit, FRED, Alpaca IEX, and official NYSE-calendar adapters, including retry-safe pagination, UTC normalization, immutable raw response hashes, and per-symbol/hour coverage manifests.
- [ ] Keep OHLC signal bars Aster-sourced; use alternate venues only for validated contemporaneous execution/funding proxies. Reject unsupported market/contract mappings.
- [ ] Run `python -m unittest discover -s tests/formal_five_bt -p 'test_market_data.py' -v and the same command for 'test_sources_and_calendar.py'`; expected: all integrity, time alignment, FX as-of, and calendar tests pass.

### Task 3: Port strategy decisions and establish live parity

**Files:**
- Create: `research/formal_five_bt/strategies.py`
- Create: `research/formal_five_bt/strategy_contracts.py`
- Create: `tests/formal_five_bt/test_strategy_parity.py`

**Interfaces:**
- `evaluate(strategy_id, symbol, history_asof, config, portfolio_state) -> DecisionTrace` returns every named gate, pass/fail, reason, signal time, and optional order intent.
- A `DecisionTrace` may emit an order only when all required runtime gates pass and input provenance is verified.

- [ ] Write deterministic golden-vector tests for V12 (all 14 symbols, H1→H2, BTC regime/selectors/HC), PENGU long and short/recovery/quarantine, Q102 CAUSAL_V4 HIGH_VOL/S34 as-of selection, FET BRK48, and V52 V11_EQ/V50_POST_OPEN_BASIS.
- [ ] Run the tests and confirm they fail before adapters exist.
- [ ] Implement adapters using the active VPS snapshot; if a required runtime value or source is unavailable, make that gate explicitly UNVERIFIED and block its unqualified BT orders.
- [ ] Add as-of invariance tests proving future candles and labels cannot alter earlier decisions.
- [ ] Run parity tests; expected: every approved vector matches the live function output and no future data changes earlier traces.

### Task 4: Implement deterministic shared portfolio, fills, and order lifecycle

**Files:**
- Create: `research/formal_five_bt/portfolio.py`
- Create: `research/formal_five_bt/execution.py`
- Create: `tests/formal_five_bt/test_portfolio_execution.py`

**Interfaces:**
- `replay(events, initial_state, scenario) -> ReplayResult` consumes globally ordered strategy, market, contribution, protection, funding, and calendar events.
- `ReplayResult` includes decision log, order log, full trade ledger, equity/margin time series, and coverage failures.

- [ ] Write failing tests for priority/competition, shared gross caps, Margin Guard transitions, realized-event TWR DD governor, leverage/margin, fees, funding, slippage, partial fills/exits, trailing stops, time exits, quarantine, adverse stop/target ambiguity, deposits, and deterministic event ordering.
- [ ] Run focused tests and confirm expected failures.
- [ ] Implement shared limits and priority V52 → PENGU → V12 → Q102 CAUSAL_V4 → any active legacy Q102 → FET exactly from audited policy; implement order-type and protective-order semantics from runtime source.
- [ ] Run portfolio/execution tests; expected: all cases produce stable, complete ledger rows and block invalid fills.

### Task 5: Add scenario execution-cost selection and 50-day coverage paths

**Files:**
- Modify: `research/formal_five_bt/execution.py`
- Create: `research/formal_five_bt/scenarios.py`
- Create: `tests/formal_five_bt/test_scenarios.py`

**Interfaces:**
- `select_execution_observation(instrument, at_utc, aster, alternatives, scenario, coverage_path) -> ExecutionObservation | SkipReason`.
- Scenario IDs: `NORMAL_PROXY_APPLIED`, `SEVERE_PROXY_APPLIED`, `NORMAL_ASTER_DATA_ONLY`, `SEVERE_ASTER_DATA_ONLY`.

- [ ] Write failing tests for median NORMAL proxy selection, least-favorable SEVERE selection, Aster preference after validated coverage begins, omitted Aster-only gap orders, V52 omission for the initial gap, single-valid-venue labeling, and invalid-data skip behavior.
- [ ] Run the tests to observe the absent scenario behavior.
- [ ] Implement only exchange-provenance-aware selection; never replace Aster signal OHLC with proxy candles.
- [ ] Run scenario tests; expected: all four runs are reproducible and distinct where coverage differs.

### Task 6: Produce complete logs, ledgers, metrics, and data-quality status

**Files:**
- Create: `research/formal_five_bt/reporting.py`
- Create: `research/formal_five_bt/cli.py`
- Create: `tests/formal_five_bt/test_reporting.py`

**Interfaces:**
- CLI: `python -m research.formal_five_bt.cli run --scenario <id> --data-root <path> --output-root <path>`.
- `summarize(result) -> ReportBundle` emits monthly, instrument, strategy, and consolidated profit, PF, win rate, TWR, contribution-adjusted return, closed-event DD, MTM DD, margin and coverage metrics.

- [ ] Write failing tests that require every decision timestamp/gate and every order/partial/exit to have an attributable source row, and require NOT_VERIFIABLE where source coverage fails.
- [ ] Run tests and observe expected failures.
- [ ] Implement deterministic CSV/JSONL/Markdown output plus run ID and SHA256 manifests; store data-bearing outputs beneath the local-only run directory.
- [ ] Run reporting tests; expected: output schema and completeness checks pass for all four scenario IDs.

### Task 7: Run unchanged baseline, then V12 variants

**Files:**
- Create: `scripts/run-formal-five-logic-bt.py`
- Create: `tests/formal_five_bt/test_variant_attribution.py`
- Create locally only: `research-runs/formal-five-logic-bt/<run-id>/`

**Interfaces:**
- `compare_v12_variants(baseline, variant) -> VariantImpact` separates added entries, removed entries, profitable displaced entries, and net realized/unrealized P&L change.

- [ ] Add failing attribution tests where a lower threshold adds losing trades and displaces a profitable baseline trade.
- [ ] Run the test red, then implement exact variants: unchanged gates; volume 0.80/Score 1.00; volume 0.55/Score 0.85; strong-BTC score-gap acceptance to the current neutral threshold; HC1.75 fixed.
- [ ] Acquire, hash, validate, and freeze all available Aster, alternate-venue proxy, Alpaca, FRED, and NYSE data for 2025-08-10 through 2026-08-10; include source URL/route, requested/actual coverage and per-instrument/time completeness.
- [ ] Run unchanged baseline across all four scenario IDs before running any V12 variant; fail closed for any unresolved required-data or parity issue.
- [ ] Run variants only after baseline acceptance; publish added/removed/profitable-displacement attribution in the local report.
- [ ] Run data replay twice with identical inputs; expected: event, ledger, metric, and output hashes match exactly.

### Task 8: Final audit, publication-safe packaging, and delivery

**Files:**
- Create: `reports/formal-five-logic-bt-methodology.md`
- Create: `research/formal_five_bt/README.md`
- Modify only if required: `.gitignore`

**Interfaces:**
- Rights-safe public artifacts include engine, tests, schemas, methodology, source references, source/runtime file hashes, and a no-secret manifest; raw data and data-bearing exact logs/ledgers/results stay local pending written redistribution rights.

- [ ] Verify every spec acceptance criterion against actual commands, logs, hashes, source coverage, and run outputs; list each failed or unverified requirement explicitly.
- [ ] Run `python -m unittest discover -s tests/formal_five_bt -v`, targeted live-source self-tests, Python compile checks, and the repository's relevant test/typecheck commands; record real outputs.
- [ ] Run `git diff --check`, scan staged files for secrets and prohibited data artifacts, and review the full branch diff.
- [ ] Commit completed work on `codex/formal-five-logic-bt-20260926`; push only rights-safe engine/test/methodology artifacts to the authorized GitHub remote. Keep local data-bearing outputs out of the public push unless redistribution rights are verified.
