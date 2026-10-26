# RENDER #4427: protective trigger / hedge-side readback audit (2026-10-27)

## Scope
Research-only; primary GitHub commit `939b59da49ce7960485a2004b0068dc63417ae82`. No production, VPS, LIVE, HP, actual orders, 8-strategy, or dirty-worktree modifications.

## Newly established boundary
Original `recoverIdleProtectedRateBudgetState()` invokes `assertProtectedVenueReadback()`. Its `getOpenOrders()` Aster adapter drops the API's `workingType` and `positionSide` fields. The validator checks order ID, type, BUY side, reduceOnly, original quantity, and stop price, but does **not** check the trigger source or hedge-mode position side.

Using pinned original TS under Node `stripTypeScriptTypes` + VM on the authorized Windows filesystem, synthetic STOP/TP rows with `CONTRACT_PRICE` instead of `MARK_PRICE`, and rows labeled `LONG` while the expected owned position is SHORT, passed recovery and cleared `manualReview`. Wrong STOP order type, BUY/SELL side, price, missing STOP, and an extra active order were rejected as controls.

**Meaning:** a PASS cannot establish that the recovered protective orders use the intended trigger price source or match the intended hedge-mode position side. This is an audit gap, not proof that Aster has ever returned such rows or that a real exchange would accept those combinations.

## Original source identity
GitHub raw actual byte SHA256 pinned to commit `939b59da49ce7960485a2004b0068dc63417ae82`:

- `scripts/disdex-idle-priority-short-protected-rate-budget-recovery.ts`: `70f319371e39e22d0df3b355b079c8336e5d205f022fe6ee752e218f60a4fc09`
- `lib/idle-priority-short-state.ts`: `4f09cb0c7f430ffde65c993b7ac57af8284605eefa89df2d11973bb77ec09f07`
- `config/idlePriorityShortPolicy.ts`: `6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8`
- `lib/aster-v3-client.ts`: `4c245ed0e9bbcdeac4796f19596928d36647fb6f1b0008fdb102a2d2f16b0baf`

## Independent replay
- 2 independent Python launchers in each of normal / `-O` / `-OO`; six child processes exit 0.
- 12 cases each, 72/72 expected outcomes; all six canonical result hashes identical.
- Canonical SHA256: `b0e14d424c7f9beee3df90bbc890a3a01419f6a8f8d05dfcec14ba6b0212a7a5`.
- Audit Python script SHA256: `a94d766773b321a6d977e22d7b8a57a8cb9cc9b62c870e55467c57a92f0b987f`.
- Results and per-case status are in the companion JSON.

## Safety / evidence limitations
Synthetic readback only; no Aster authenticated inventory/receipts, no Native8 parity, no genuine 13 GateProof, no order authorization. This audit does not establish real hedge-mode acceptance, real wrong trigger-source orders, or any production incident. No future exit information was used for entry priority.

Status: `NEED_NATIVE_ALLOCATOR`, `order_authorized=false`. Owner `IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH`, route `IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT`, Gross `0.25x`.

Next: trace operator caller, Aster readback source identity and as-of freshness, position mode, order remaining quantity and positionSide/workingType receipt, plus Native8 owner-priority and shared reservation. Keep Fail Closed.
