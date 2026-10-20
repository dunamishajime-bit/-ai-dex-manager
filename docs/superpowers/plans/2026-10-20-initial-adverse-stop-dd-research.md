# Initial Adverse-Stop DD Research Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Identify and test causal initial-adverse-stop and recovery/re-entry controls that improve the fixed eight-logic portfolio's maximum MTM drawdown at both 10bps and 30bps, while preserving accounting and the existing strategy contracts.

**Architecture:** Use the fixed 2026-10-17 H1 price-model replay as an immutable research baseline. First generate a directional, horizon-based loss-path diagnostic from the accepted baseline ledger. Then run predeclared causal overlay candidates through the same integrated engine in the requested order, carrying forward only candidates that pass the fixed DD/OOS/accounting gate. No rejected entry is promoted and no Production path is touched.

**Tech Stack:** Python 3, existing legacy integrated BT engine, JSONL ledgers/events, unittest, SHA256 manifests, isolated Git worktree.

**Spec:** User request dated 2026-10-20: “全ロジック初期逆行STOP改善・統合DD削減BT研究”.

## Global Constraints

- Baseline is the fixed 2025-08-10 through 2026-08-10 eight-logic H1 price-model replay.
- Initial capital is ¥10,000, monthly deposits are zero, and compounding is retained.
- Evaluate 10bps and 30bps independently; do not mix cost cases or state.
- Use causal bar data only; no look-ahead, future P/L selection, or rejected-entry promotion.
- Preserve existing entry, priority, Gross, funding, fee, and accounting behavior outside the declared overlay.
- Production, VPS, LIVE, HP, operator artifacts, and real orders are out of scope.
- Research outputs belong under `DisDex_AI_Files/01_BT_Research` and must include provenance and SHA256.

## Review Focus

- Directional return semantics: long and short adverse/favorable excursions must be mirrored and tested.
- Same-bar ordering: a stop armed on a completed bar is checked before that bar can update MFE.
- Missing bars: an internal gap must fail closed for the affected overlay, not be interpolated.
- Re-entry holdoff: a stop-triggered same-symbol/same-direction retry must respect the declared holdoff without blocking opposite direction.
- Integrated path: early exits must alter later Gross/capital state only through the existing engine, not by adding or removing trades after the fact.

### Task 1: Baseline and loss-path diagnostics

**Files:**
- Create: `scripts/dd-reduction/task9_initial_adverse_stop_20261020.py`
- Test: `tests/dd_reduction/test_task9_initial_adverse_stop.py`
- Output: `DisDex_AI_Files/01_BT_Research/2026-10-20_dd-reduction-initial-adverse-stop/`

**Interfaces:**
- Consumes: existing fixed baseline replay, source bars, and accepted `portfolio-trades.jsonl`.
- Produces: baseline parity result, per-trade horizon metrics at 1/2/3/4/6/12/24 hours, LONG/SHORT split, loss causes, MFE/MAE/giveback, DD window and contribution summaries.

- [ ] Write failing unit tests for directional excursion, horizon lookup, and causal stop trigger semantics.
- [ ] Run the focused tests and confirm the expected missing-module failures.
- [ ] Implement pure diagnostic helpers and fixed-baseline control execution.
- [ ] Run focused tests, then baseline parity and data-quality checks.

### Task 2: V12 LONG and V12 SHORT candidate grid

**Files:**
- Modify: `scripts/dd-reduction/task9_initial_adverse_stop_20261020.py`
- Test: `tests/dd_reduction/test_task9_initial_adverse_stop.py`

**Interfaces:**
- Consumes: Task 1 diagnostics and existing integrated engine wrapper.
- Produces: predeclared V12 LONG and SHORT candidates for -1/-1.5/-2/-3% with 3/6/12h windows, MFE gates, ATR alternatives, and re-entry holdoffs.

- [ ] Add failing tests for MFE-gated initial stop, ATR floor/cap, and direction symmetry.
- [ ] Implement the V12 LONG phase and run 10/30bps integrated candidates.
- [ ] Select only a candidate meeting both-cost DD/OOS/accounting gates; otherwise carry baseline unchanged.
- [ ] Repeat for V12 SHORT using the selected LONG cumulative baseline.

### Task 3: Q102, Idle, FET, HYPE, V52 cumulative phases

**Files:**
- Modify: `scripts/dd-reduction/task9_initial_adverse_stop_20261020.py`
- Test: `tests/dd_reduction/test_task9_initial_adverse_stop.py`

**Interfaces:**
- Consumes: cumulative baseline and phase result contract from Task 2.
- Produces: one result bundle per logic phase, with candidate/accepted/rejected reason and cumulative baseline lineage.

- [ ] Add failing tests for strategy scoping and PENGU-preservation.
- [ ] Implement Q102 LONG/SHORT, Idle LONG/SHORT, FET, HYPE, and V52 predeclared phase grids.
- [ ] Run each phase at 10/30bps and OOS; carry forward only accepted candidates.
- [ ] Record no-candidate phases explicitly rather than forcing a change.

### Task 4: Final manifest, report, and reproducibility

**Files:**
- Modify: `scripts/dd-reduction/task9_initial_adverse_stop_20261020.py`
- Create: `docs/research`-style report under the output root

**Interfaces:**
- Consumes: all phase ledgers, diagnostics, and candidate results.
- Produces: comparison JSON, report, per-phase manifests, SHA256 index, first-divergence metadata, and final accepted cumulative set.

- [ ] Verify all baseline controls, accounting, data quality, and deterministic rerun hashes.
- [ ] Run full focused tests and repository diff checks.
- [ ] Create a research branch, commit only the research script/tests/plan, and push the branch.
- [ ] Report exact remote SHA, artifact hashes, status, and any phase that had no accepted candidate.

## Acceptance Gate

A candidate is eligible for cumulative adoption only if it improves integrated maximum MTM DD by at least 0.10 percentage points at both 10bps and 30bps, accounting is PASS, OOS net PnL remains positive, and OOS PF is at least 90% of the phase baseline. A DD improvement that materially damages final equity or PF is reported as a comparison candidate and is not auto-adopted.
