# Implementation Handoff — V12 Top2 + PENGU V20/V8 + V52 Top2 + Q102 1.0x/1-slot

## Target strategy

`V12_TOP2_1.5 + PENGU_V20_V8 + V52_TOP2 + Q102_1.0_1SLOT`

Research evidence: `research/q102_1p0_1slot_lump100k_1y_20260911.json`
Historical six-case contract: `research/bt_top2_v8_q102_comparison_contract_20260910.json`

## Validated one-year baseline

- Period: 2025-08-10T00:00:00Z to 2026-08-10T00:00:00Z
- Capital: JPY 100,000 lump sum; no contributions; compounded
- NORMAL: JPY 63,349,871.26015618; PF 3.46130115; DD -14.33740242%
- SEVERE: JPY 6,464,329.97779967; PF 2.35473078; DD -19.94193393%
- Q102: 1.0x maximum gross, one slot, 71 episodes
- Shared Crypto Gross <= 2.0x; Total Gross <= 2.5x
- Gross conflicts: 0
- Research checks: 28/28 PASS
- Safety: research only; no orders, LIVE mutation, VPS mutation, or production mutation

## Current production-state delta

Current inspected production config already has:
- V12 Top2, aggregate gross cap 1.5x, per-position cap 1.0x, max positions 2
- PENGU Dual LS V2 / Short V20 with Recovery V8 supplemental Long
- V52 Top2
- Shared Crypto Gross 2.0x
- Total Gross 2.5x
- Shared Crypto Daily Loss 5%

Current Quality102 production config still exposes `strategyGrossCap: 0.5` in:
- `lib/disterminal-live-config.ts`
- `lib/server/quality102-runtime-observability.ts`
- related runtime/config tests

Target delta: make Quality102 1.0x maximum gross with exactly one active slot end-to-end. Do not implement this as a UI-only/config-only change.

## Required implementation semantics

- Q102 selector remains causal/fail-closed; do not restore a historical fixed selector.
- Q102 maximum concurrent positions = 1.
- Q102 requested/allowed strategy gross cap = 1.0x.
- Shared crypto gross remains <= 2.0x and total gross remains <= 2.5x.
- Base strategies keep priority over Q102 when shared capacity conflicts.
- Preserve the proven MTM resize/yield behavior so a higher-priority V12/PENGU/V52 admission can reduce Q102 rather than violate shared caps.
- No duplicate Q102 ownership, no second Q102 slot, no synthetic/test orders, no weakening of fail-closed behavior.
- Keep PENGU Recovery V8 as supplemental Long; do not replace Short V20.
- Keep the 24h cooldown after a PENGU hard stop.
- Do not change V12/PENGU/V52 signal definitions as part of this delta.

## Acceptance checks

1. Update all production policy/config/runtime surfaces that currently assume Q102 0.5x.
2. Trace the effective cap through planner, shared-risk admission, executor sizing, persisted state, reconciliation, observability, UI, systemd/env/deploy config, and restart recovery.
3. Add tests proving Q102 <= 1.0x, Q102 active positions <= 1, Crypto Gross <= 2.0x, Total Gross <= 2.5x, and gross conflicts = 0.
4. Add regression coverage for Q102 MTM resize when a higher-priority Base entry arrives.
5. Update stale tests/UI that assert or display 0.5x.
6. Run focused tests plus build/typecheck and the relevant production preflight/self-tests.
7. Before any LIVE restart, perform Aster read-only reconciliation: positions, open orders, protective orders, shared lock/ownership, runner state, and stale/duplicate daemons.
8. Fail closed on any mismatch. Do not clear the Kill Switch merely to make tests pass.

## Deployment boundary

This branch is research/handoff evidence. Implementation must be performed against the current production lineage, preserving unrelated dirty work. LIVE enablement/restart is a separate gated step after verification.