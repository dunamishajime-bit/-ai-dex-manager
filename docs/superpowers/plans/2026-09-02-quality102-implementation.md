# Quality102 causal logic implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the deterministic, causal Quality102 decision logic as a pure runtime module while preserving the existing fail-closed LIVE boundary.

**Architecture:** Keep market-feature calculation, HIGH_VOL rule matching/exit simulation, S34 quality gates, explicit S1/S2 stage membership, and Quality124→Quality102 one-slot routing in a side-effect-free TypeScript pipeline. The existing readiness module remains the authority for provenance, parity, arming, and LIVE activation.

**Tech Stack:** TypeScript, Node self-tests, existing strict portfolio contracts.

**Spec:** `docs/research/quality102-live-implementation-spec-20260901.md` on the implementation-reference branch.

## Global constraints

- Completed 1H bars only; signal at bar `i`, entry at bar `i+1` open.
- No fixed historical timestamps or frozen CSVs in the runtime path.
- S1/S2 stage membership must be supplied explicitly by the upstream source; it is never inferred from row order or final layer counts.
- S34 BRK `strength` is a required upstream value. The implementation enforces its presence and gate but does not invent an unproven calculation formula.
- Existing gross caps, shared account lock, reconciliation, kill switch, and base-strategy priority are unchanged.
- LIVE, VPS, and order execution remain untouched and fail-closed until independent provenance/parity evidence exists.

## Tasks

### 1. RED — causal pipeline contracts

- [x] Add tests for causal feature calculation, no-lookahead, HIGH_VOL grid matching, monthly ranking, exits, explicit stage subset validation, S34 gates, and the synthetic 151→124→102 contract.
- [x] Run the focused test and observe the expected missing-module failure.

### 2. GREEN — pure causal pipeline

- [x] Implement 1H feature calculation and Wilder RSI/ATR.
- [x] Implement HIGH_VOL rule grid matching, monthly eligibility/Wilson ranking, next-hour entry, hard-stop/trailing/72h exits, and normal/stress net formulas.
- [x] Implement explicit stage subset validation and the S34 quality-gate/classification pipeline.
- [x] Implement deterministic chronological one-slot routing and parity diagnostics.

### 3. Regression and safety integration

- [x] Run the new focused self-test and all existing Quality102/strict contract tests.
- [x] Run TypeScript and Python checks relevant to the repository.
- [x] Confirm the readiness capability flags remain fail-closed because the authoritative raw generators and exact BRK strength formula are not present.

### 4. Handoff

- [x] Update the audit record with implementation status and exact remaining provenance blockers.
- [x] Do not activate LIVE or mutate VPS/order state without the missing evidence and access authority.
