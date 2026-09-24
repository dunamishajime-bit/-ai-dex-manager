# Raw-data Integrated BT Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild V12, PENGU, Q102, FET, and V52 from raw market data and current production contracts, then run a deterministic one-year ¥10,000 + ¥10,000×12 compounding portfolio BT without using recovered trade ledgers.

**Architecture:** A raw-data layer downloads/loads immutable bar and funding bundles and emits a validated manifest. Five strategy generators emit normalized candidates from those bars; a single portfolio engine applies next-bar execution, fees/funding/slippage, Gross reservations, deposits, compounding, exits, and mark-to-market. A validation layer rejects look-ahead, duplicate, missing-data, cap, accounting, and determinism violations before a report is written.

**Tech Stack:** TypeScript/Node for Production-contract strategy adapters and tests; Python for raw-data validation, deterministic portfolio replay, manifests, and report generation; Aster public Futures REST for crypto bars/funding; raw stock OHLCV cache for V52; Node `tsx`; Python `unittest`.

**Spec:** `docs/superpowers/specs/2026-09-24-raw-data-integrated-bt-design.md`

## Global Constraints

- Never use recovered V12/PENGU/Q102/FET/V52 trade ledgers as event input.
- Do not change VPS, Production, systemd, UI, Aster account state, or LIVE orders.
- Crypto raw data must come from Aster public Futures API `https://fapi.asterdex.com`.
- V52 stock data must be treated as a separate raw source; do not claim it is Aster data.
- Initial capital is `¥10,000`; monthly deposit is `¥10,000` for 12 dates; total contributed is `¥130,000`; compounding is ON.
- Signal features may use data through the signal bar only; entries use the documented next-bar execution rule.
- Rejected candidates do not create trades, PnL, or PENGU Q60/DD17 state.
- No parameter tuning to expected historical output values.
- Missing raw source, ambiguous Production contract, or failed validation is fail closed.

## Review Focus

- Aster pagination and UTC boundaries: test that no missing/duplicate bar or post-period row enters a decision.
- V12 Rank3 score timing: test score `0.70` inclusion and no score/value from a later bar.
- Compounding/accounting: test that deposits, fees, funding, and return scaling are applied exactly once.
- Cross-strategy reservations: test that pending/reserved/candidate Gross cannot exceed the current cap and that rejected entries do not alter state.
- Extreme returns: test that large raw moves are reported and audited, not silently clipped or multiplied twice.

### Task 1: Raw data bundle and validation

**Files:**
- Create: `scripts/research/raw_data/models.py`
- Create: `scripts/research/raw_data/aster_fetch.py`
- Create: `scripts/research/raw_data/validate_bundle.py`
- Create: `tests/test_raw_data_bundle.py`
- Create: `docs/research-results/raw-data-v12-pengu-q102-fet-v52-20260924.json`

**Interfaces:**
- `Bar(symbol: str, ts_ms: int, open: float, high: float, low: float, close: float, volume: float)`
- `Funding(symbol: str, ts_ms: int, rate: float)`
- `fetch_aster_bundle(symbols: list[str], start_ms: int, end_ms: int, interval: str = "1h") -> dict`
- `validate_bundle(bundle: dict) -> dict` returns counts, gaps, duplicates, ranges, and SHA-256 manifest.

- [ ] **Step 1: Write failing tests** for duplicate timestamps, invalid OHLC, non-monotonic rows, funding after decision time, and exact one-year boundary handling.
- [ ] **Step 2: Run** `python -m unittest tests.test_raw_data_bundle` and verify the expected validation functions are missing.
- [ ] **Step 3: Implement** the models, Aster public REST pagination, funding retrieval, raw stock-bar loader, UTC normalization, and SHA-256 manifest. Do not include credentials or signed endpoints.
- [ ] **Step 4: Run** the tests and require `PASS`; add a fixture proving a valid bundle passes with zero duplicates and zero invalid rows.
- [ ] **Step 5: Commit** `feat: add raw market bundle and validation`.

### Task 2: V12 Top3 raw-data generator

**Files:**
- Create: `scripts/research/raw_data/v12_rebuild.py`
- Create: `tests/test_v12_raw_rebuild.py`
- Create: `docs/research-results/v12-top3-raw-rebuild-20260924.json`

**Interfaces:**
- `generate_v12_candidates(bars: dict[str, list[Bar]], contract: dict, mode: str) -> list[dict]`
- `normalize_v12_trade(candidate: dict, fill: dict) -> dict`
- `run_v12_raw_rebuild(bundle_path: Path, output_path: Path) -> dict`

- [ ] **Step 1: Write failing tests** for Top3 selection, Rank3 `0.10x`, score threshold `0.70`, maximum three positions, aggregate cap reservation, next-bar fill, and no future-bar access.
- [ ] **Step 2: Run** `python -m unittest tests.test_v12_raw_rebuild` and verify RED because the generator does not exist.
- [ ] **Step 3: Implement** the V12 feature/ranking/entry/exit replay from current Production policy files, using the contract snapshot and raw bars only. Record `signalTs`, `entryTs`, `symbol`, `rank`, `score`, `requestedGross`, `acceptedGross`, `entryPrice`, `exitPrice`, `fees`, `funding`, `slippage`, `exitReason`, and source hashes.
- [ ] **Step 4: Run** tests and inspect the generated ledger for rank distribution, score minimum, duplicate position IDs, and gross maxima.
- [ ] **Step 5: Commit** `feat: rebuild v12 top3 ledger from raw data`.

### Task 3: New PENGU raw-data generator

**Files:**
- Create: `scripts/research/raw_data/pengu_rebuild.py`
- Create: `tests/test_pengu_raw_rebuild.py`
- Modify: `scripts/research/reconstructed_integrated_bt/ledger.ts`

**Interfaces:**
- `generate_pengu_candidates(bars: dict[str, list[Bar]], funding: list[Funding], mode: str) -> list[dict]`
- `apply_pengu_q60_dd17_h72(state: dict, closed_trade: dict) -> dict`
- `normalize_pengu_trade(candidate: dict, fill: dict) -> dict`

- [ ] **Step 1: Write failing tests** for `COMBINED_FILTERED`, entry Gross `1.0`, same-route 60h quarantine, realized DD `-17%` with 72h new-entry pause, and preservation of existing protection during pause.
- [ ] **Step 2: Run** `python -m unittest tests.test_pengu_raw_rebuild` and verify RED.
- [ ] **Step 3: Implement** the raw PENGU signal/route/exit replay using Aster PENGU/BTC bars and funding; update Q60/DD17 only from accepted filled and closed trades.
- [ ] **Step 4: Run** tests and require standalone NORMAL/SEVERE counts to be produced from raw signals, not copied ledger counts.
- [ ] **Step 5: Commit** `feat: rebuild pengu q60 dd17 h72 from raw data`.

### Task 4: Q102 Causal V4, FET BRK48, and V52 raw generators

**Files:**
- Create: `scripts/research/raw_data/q102_rebuild.py`
- Create: `scripts/research/raw_data/fet_rebuild.py`
- Create: `scripts/research/raw_data/v52_rebuild.py`
- Create: `tests/test_remaining_raw_rebuilds.py`

**Interfaces:**
- `generate_q102_candidates(raw_bundle: dict, mode: str) -> list[dict]`
- `generate_fet_candidates(raw_bundle: dict, mode: str) -> list[dict]`
- `generate_v52_candidates(stock_bars: dict, mode: str) -> list[dict]`

- [ ] **Step 1: Write failing tests** for Q102 Causal V4 one-slot/future-leak protection, FET BRK48 priority/preemption eligibility, V11 identity preservation, and V52 current threshold/cost gates.
- [ ] **Step 2: Run** `python -m unittest tests.test_remaining_raw_rebuilds` and verify RED.
- [ ] **Step 3: Implement** each generator against raw bars/features and current Production contract; do not read recovered event ledgers or fixed replay CSVs as trades.
- [ ] **Step 4: Run** tests and validate each output's source hashes, event uniqueness, and mode independence.
- [ ] **Step 5: Commit** `feat: rebuild q102 fet and v52 from raw data`.

### Task 5: Deterministic integrated accounting engine

**Files:**
- Create: `scripts/research/raw_data/integrated_engine.py`
- Create: `tests/test_raw_integrated_engine.py`

**Interfaces:**
- `run_integrated(mode: str, raw_bundle: dict, capital: CapitalContract) -> dict`
- `reserve_entry(state: PortfolioState, candidate: Candidate) -> ReservationResult`
- `settle_exit(state: PortfolioState, position: Position, fill: Fill) -> None`
- `build_source_manifest(bundle: dict, result: dict) -> dict`

- [ ] **Step 1: Write failing tests** for initial plus 12 deposits, next-bar execution, fee/funding once-only, partial fill accounting, shared Gross reservation, FET preemption, rejected trade exclusion, Q60/DD17 state isolation, and NORMAL/SEVERE isolation.
- [ ] **Step 2: Run** `python -m unittest tests.test_raw_integrated_engine` and verify RED.
- [ ] **Step 3: Implement** cash/equity/realized PnL/fees/funding/open Gross/pending reservation/MTM state with deterministic event ordering and no return multiplication twice.
- [ ] **Step 4: Run** tests and assert crypto/stock/total caps at every accepted entry, exact contribution total ¥130,000, and no duplicate position IDs.
- [ ] **Step 5: Commit** `feat: add raw-data integrated portfolio accounting`.

### Task 6: Plausibility audit and deterministic replay

**Files:**
- Create: `scripts/research/raw_data/audit_results.py`
- Create: `tests/test_raw_bt_audit.py`
- Create: `docs/research-results/raw-data-integrated-bt-20260924.md`

- [ ] **Step 1: Write failing tests** for extreme-return attribution, max single-trade contribution, drawdown peak/trough/recovery, monthly equity, and result hash stability.
- [ ] **Step 2: Run** `python -m unittest tests.test_raw_bt_audit` and verify RED.
- [ ] **Step 3: Implement** the audit report with per-trade attribution, raw move versus modeled return, cost breakdown, monthly equity, DD intervals, and comparison to the previous independent result only as a diagnostic.
- [ ] **Step 4: Run** the full raw-data test set twice and require identical result and manifest hashes.
- [ ] **Step 5: Commit** `feat: add raw bt plausibility audit`.

### Task 7: End-to-end run and final verification

**Files:**
- Modify: `docs/research-results/raw-data-v12-pengu-q102-fet-v52-20260924.json`
- Modify: `docs/research-results/raw-data-integrated-bt-20260924.md`

- [ ] **Step 1: Run** the Aster raw-data fetch/validation for the fixed one-year period and save the manifest without secrets.
- [ ] **Step 2: Run** all five raw strategy generators for NORMAL and SEVERE.
- [ ] **Step 3: Run** `integrated_engine.py` twice and compare result/manifest SHA-256.
- [ ] **Step 4: Run** `python -m unittest discover -s tests -p 'test_raw_*.py'` and `node_modules\.bin\tsx.cmd --test tests\pengu_q60_dd17_h72_ledger_contract.test.ts`.
- [ ] **Step 5: Run** `git diff --check`, inspect the final report, verify no VPS/LIVE command was executed, and record either `RAW_DATA_INDEPENDENT_BT_VERIFIED` or `BLOCKED_RAW_SOURCE_OR_PARITY`.
- [ ] **Step 6: Commit** `docs: record raw-data integrated bt results`.

## Handoff

The implementation should proceed with `superpowers:executing-plans` in this
worktree, one task at a time, preserving the commit boundaries above. A task
cannot be marked complete without its RED/GREEN test evidence and its source
provenance output.
