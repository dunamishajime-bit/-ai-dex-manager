# RENDER #4427 — Protected Venue Readback Timestamp / As-of Audit (2026-10-27)

## Scope and verdict

**RESEARCH_ONLY — NEW_FINDING_VENUE_TIMESTAMP_FRESHNESS_UNBOUND — NEED_NATIVE_ALLOCATOR — order_authorized=false.**

The pinned original `recoverIdleProtectedRateBudgetState()` / `assertProtectedVenueReadback()` checks protective position/order fields, but does not bind their exchange `updateTime` to a trusted as-of timestamp or enforce causal order between position and protective orders. The original CLI's Aster adapters discard `updateTime` for **both** `getPositions()` and `getOpenOrders()`, although the pinned `AsterPositionRiskRow` and `AsterOrderResponse` types expose it.

A controlled, synthetic venue adapter executed the original TypeScript in Node's `stripTypeScriptTypes` + VM on the owner's Windows PC. With an otherwise valid RENDER SHORT position and STOP/TP, the recovery returned PASS and cleared `manualReview` when the position, STOP, or TP had an ancient timestamp; a timestamp one year **after the synthetic audit clock**; an inverted STOP/position causal order; or no update timestamps. The controls with an incorrect STOP price, missing STOP, or non-null pending state were rejected. This establishes a **readback freshness / causal-proof gap**, not that Aster actually supplied stale or future data, nor that the LIVE operator invoked this recovery.

## Exact original source pin (GitHub raw bytes, commit 939b59da49ce7960485a2004b0068dc63417ae82)

- `scripts/disdex-idle-priority-short-protected-rate-budget-recovery.ts`: SHA256 `70f319371e39e22d0df3b355b079c8336e5d205f022fe6ee752e218f60a4fc09`
- `lib/idle-priority-short-state.ts`: SHA256 `4f09cb0c7f430ffde65c993b7ac57af8284605eefa89df2d11973bb77ec09f07`
- `config/idlePriorityShortPolicy.ts`: SHA256 `6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8`
- `lib/aster-v3-client.ts`: SHA256 `4c245ed0e9bbcdeac4796f19596928d36647fb6f1b0008fdb102a2d2f16b0baf`

All four were fetched on the owner's PC through `gh api` at the exact pinned commit and verified as raw bytes before the experiment. The test does not import an unpinned module or rely on Python `assert` for its expected outcomes.

## Reproduction

Script: `scripts/dd-reduction/audit_render4427_venue_freshness_20261027.py`.

Independent Python launcher processes: two normal, two `-O`, two `-OO`; each spawned 12 independent Node test cases using the pinned original TS methods. All 72/72 cases passed their expected outcome; six processes exited 0. All six independently produced the same canonical JSON SHA256:

`88cdf343e2a344595d431e3aea9d61b4c2e07d9414ed9daf8e5aaf029a0e7528`

Synthetic clock: `1700000000000` ms. The `future_*` cases use synthetic clock +365 days; the `stale_*` cases use timestamp 1 ms; the `stop_before_entry` case uses STOP updateTime 1000 ms, position updateTime 2000 ms. None are genuine Aster timestamps or receipts.

## Required proof before any adoption

Read-only trace of actual operator caller, Aster adapter fields, genuine signed venue position/order inventory with source identity and timestamps, consistent snapshot/as-of proof, protective order remaining quantity and status, position mode and hedge side, venue receipt provenance, pending/account-lock reconciliation, and Native8 allocator ownership. Do not treat synthetic receipts or self-reported roots as production proof. No order authorization.

Owner: `IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH`; Route: `IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT`; Gross: `0.25x`.

No VPS/LIVE/Production/HP/orders/8-logics/old IDLE Core `_overlay_block` or dirty worktree changes. PC research writes confined to `C:/Users/dis/render4427-research-only/`; `C:/tmp` was not accessed.
