# HYPE RENDER TAO Production LIVE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Follow `superpowers:verification-before-completion` before claiming any production result.

**Goal:** Integrate the user-adopted HYPE LONG, TAO Idle SHORT, and RENDER Idle SHORT rules into the current d6 Production lineage without regressing existing Q102, V12 V4, PENGU, FET, V52, DOT, TIA, or JUP behavior; verify the code and venue-safety paths; and deploy only after all safety gates pass.

**Architecture:** Keep the pure policy module as the single threshold source, add runner adapters at the existing candidate and exit lifecycle boundaries, and reuse durable protective-order/read-back/state-recovery primitives. The integrated release is based on current d6, not a wholesale checkout of the older research branch.

**Tech Stack:** TypeScript, Node test/tsx, existing Aster execution adapters, systemd on XServer VPS, signed read-only venue diagnostics.

**Spec:** `docs/implementation/CODEX_HYPE_RENDER_TAO_USER_ADOPTED_CUTOVER_HANDOFF_20261022.md`

## Global Constraints

- No test orders, manual entries, forced position closures, or protective-order deletion.
- Preserve current d6 state, Q102 three exits, V12 V4, PENGU, FET, V52, and existing DOT/TIA/JUP behavior.
- Use completed, contiguous M5 data only; missing/stale/invalid data fail closed for the affected new candidate.
- Use actual average fill price and quantity; reduce-only, idempotent, read-back-before-replace stop lifecycle.
- Keep Shared Risk, Margin Guard, Kill Switch, account lock, shared rate budget, ownership and rollback gates intact.

## Review Focus

- Candidate path: HYPE gate, TAO gate, RENDER veto, priority and reservation ordering.
- Exit path: HYPE early adverse/profit protection and RENDER profit protection with existing trailing precedence.
- Partial fill, restart/reconcile, duplicate stop, same-symbol ownership, and unknown execution handling.
- Production lineage, operator/certification SHA binding, and no stale runner/watchdog authority.

## Task Checklist

- [ ] Read the handoff, policy, config, current d6 runner code, and existing protective-order helpers.
- [ ] Capture a read-only VPS/Aster baseline before code or release changes.
- [ ] Add failing tests for the live adapter boundaries, then implement minimal wiring.
- [ ] Add persistence, read-back, partial-fill, restart and race regression coverage.
- [ ] Run focused and full relevant tests, type checks, build and source/BT evidence checks.
- [ ] Commit and push the integrated release; verify remote SHA and CI success.
- [ ] Stage an immutable VPS release and perform exact-SHA preflight with current positions/orders preserved.
- [ ] Apply operator/certification gates only from valid evidence; switch atomically if all gates pass.
- [ ] Observe multiple health cycles and perform final signed read-only venue/runtime audit.

---

## Execution Notes

Keep research BT claims separate from live venue lifecycle claims. Natural HYPE/TAO/RENDER entry or exit may remain unobserved; never fabricate that evidence.
