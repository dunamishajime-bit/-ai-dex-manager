# Quality102 Causal V4 LIVE-Ready Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make the validated Quality102 Causal V4 + REV Long ret14>=24% selector fully runnable from current 1H OHLCV while keeping LIVE fail-closed until proof-backed readiness passes.

**Architecture:** Preserve the historical replay selector unchanged. Add a V4 live signal path that generates HIGH_VOL and S34 candidates from closed 1H candles, applies frozen pre-evaluation development metrics, V4 feature gates, one-slot ordering, then the REV Long loss gate. Reuse the existing strict planner, MTM reduction, reconciliation, state and execution layers.

**Tech Stack:** TypeScript/Node 24, Python causal parity helpers, Aster 1H market data, existing strict portfolio planner.

**Spec:** `docs/superpowers/specs/2026-09-04-quality102-causal-v1-live-design.md`

## Final verification
- 90/90 final V4 loss-gate identities reproduced exactly from the 103 feature-selected rows.
- Exact MTM NORMAL: 3,204,452.91664423 JPY / PF 3.58872414 / DD -9.79910652%.
- Exact MTM SEVERE: 919,049.65821696 JPY / PF 2.56513419 / DD -16.16574496%.
- Gross: Q102 <=0.5x / Crypto <=2.0x / Total <=2.5x / conflicts=0.
- Historical Q102 proof flags remain fail-closed; V4 uses separate capability readiness.

## Global Constraints
- V4 benchmark: NORMAL 3,204,452.92 JPY, PF 3.588724, DD -9.7991%.
- Quality102 gross <=0.5x, Crypto gross <=2.0x, Total gross <=2.5x.
- No fixed historical trade timestamps, no future data, no synthetic/test orders.
- V12/PENGU/V52 keep base priority; existing exact-MTM reduction/reconciliation stays intact.
- REV Long must reject ret14 < 0.24 after one-slot selection with no backfill.
- LIVE readiness flags may become true only from code/evidence, never by manual bypass.

---

### Task 1: Freeze V4 development model
- [x] Add the 31 pre-evaluation development metrics (2025-03-01..2025-08-01) as tracked model data.
- [x] Add tests proving the model contains only the approved 31 keys and no trade timestamps.
- [x] Verify V4 feature-gate parity against the 90-trade research selection.

### Task 2: Causal S34 live generator
- [x] Write failing tests for PB/MR/REV/BRK candidate generation from closed 1H candles.
- [x] Implement signal-time ret14, strength, margin, family-specific exits and V4 gating.
- [x] Keep BRK fail-closed if required causal inputs cannot be proven from the live candle stream.

### Task 3: V4 live signal integration
- [x] Write failing tests covering HIGH_VOL + S34 competition, layer priority and post-one-slot REV loss gate.
- [x] Extend the signal builder to emit V4 candidates without changing historical replay APIs.
- [x] Preserve one active Q102 slot and current execution/exit semantics.

### Task 4: Readiness and runtime wiring
- [x] Replace HIGH_VOL-only acknowledgement with the explicit Causal V4 selector mode.
- [x] Make readiness derive from implemented/proven components; retain fail-closed on missing evidence.
- [x] Update runtime/selftests without arming LIVE or sending any order.

### Task 5: Verification and push
- [x] Run Python S34/BRK tests, selector/pipeline selftests, runner/state/runtime tests and strict contracts.
- [x] Re-run the exact-MTM V4 benchmark and require the known NORMAL/SEVERE/Gross results.
- [x] Run `git diff --check`, inspect staged files, commit only tracked source/test/audit/plan files.
- [x] Push the branch and verify local SHA equals remote SHA.
- [x] Report any remaining VPS/credential/environment-only step as the minimal Codex handoff.
