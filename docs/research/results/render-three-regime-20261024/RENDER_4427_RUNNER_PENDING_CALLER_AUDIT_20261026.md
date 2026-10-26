# RENDER #4427 — Persisted pending ID → actual runner caller → foreign pending release (2026-10-26)

## New finding (isolated research, not a LIVE incident)

The original `normalizeIdleState()` checks the pending symbol, route, gross, timestamps and that `reservationId` is a string, but does **not** bind that reservation ID to the current lock's lease, strategy, owner, route, symbol or gross. The original `IdlePriorityShortRunner.reconcilePending()` passes the persisted ID to `finalizeEntry()`; when the mocked venue reconciliation confirms **no exposure**, `finalizeEntry()` clears pending state and invokes `lock.releaseReservation(pending.reservationId)`. The original lock implementation releases the matching global pending row without checking membership in the lock document. This extends the previously known isolated API-level release behavior to an actual runner caller and its state validation boundary.

In a deliberately constructed, syntactically valid persisted IDLE state referencing a synthetic `V12_V4` pending reservation, the extracted original runner methods and original TS state store / account lock / pending registry, run on a real Windows filesystem under the authorized research root, changed the peer pending row from PENDING, SUBMITTED, or UNKNOWN to RELEASED. The same behavior held for peer symbol, side and gross mismatches. In the 1.0-gross peer case, the registry aggregate decreased from 1.0 to 0 even though the current lock had no matching reservation. The original state validator rejected mismatched route and gross controls; a missing ID or unknown venue result did not release the peer. This is a **synthetic state-provenance failure path**, not proof that a real runner has received or generated a foreign reservation ID.

## Reproducibility

Pinned primary code: `939b59da49ce7960485a2004b0068dc63417ae82`. Exact raw-byte SHA256 pins for six source files are recorded in the JSON evidence. Audit script raw SHA256: `a73aecb69bf4829329f86be9c3ccb1643a29972490856446b8478b7ca48c8925`.

Executed on the owner's PC under `C:/Users/dis/render4427-research-only/`: two independent Python child processes for each of normal, `-O` and `-OO`, each with 12 cases. **72/72 PASS**, all six exits zero; canonical result SHA256 identical in all runs: `90323c16b3f8b92210895f14d0f157fbbea000fe89df294b5907a15fef639e07`. Original TypeScript methods are compiled with Node `stripTypeScriptTypes` + VM; source bytes are pinned before execution. All test files and temp paths remain inside the permitted research directory.

## Boundary and non-adoption

This test injects synthetic persisted state and synthetic venue reconciliation. It does **not** execute the full runner `tick()`, demonstrate a naturally occurring foreign ID, authenticate the real exchange, certify Native8 or supply operator trust root / 13 GateProof. It is not a new economic backtest, and does not upgrade previously searched periods to OOS. No production code or existing worktree was changed.

Research Owner: `IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH`; Route: `IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT`; Gross: `0.25x`. Result: `NEED_NATIVE_ALLOCATOR`, `order_authorized=false`.

Next verify all real state writers and the provenance of persisted `reservationId` through crash/restart and operator reconciliation, with independently authenticated owner/lease/route/strategy/symbol/gross bindings and an atomic pending/lock/venue receipt. Do not bypass shared-risk, pending, account lock, margin, kill switch, same-symbol or cooldown gates.
