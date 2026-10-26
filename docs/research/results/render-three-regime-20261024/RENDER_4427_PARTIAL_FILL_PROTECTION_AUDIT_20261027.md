# RENDER #4427 — partial-fill protection readback boundary (2026-10-27 JST)

## Scope and provenance

Research-only branch: `research/render4427-partial-fill-protection-20261027-0331`. Pinned original source commit: `939b59da49ce7960485a2004b0068dc63417ae82`. The following source bytes were fetched from GitHub raw API on the owner PC and independently SHA256 checked before executing the original TypeScript via Node `stripTypeScriptTypes` and `vm`:

- `scripts/disdex-idle-priority-short-protected-rate-budget-recovery.ts`: `70f319371e39e22d0df3b355b079c8336e5d205f022fe6ee752e218f60a4fc09`
- `lib/idle-priority-short-state.ts`: `4f09cb0c7f430ffde65c993b7ac57af8284605eefa89df2d11973bb77ec09f07`
- `config/idlePriorityShortPolicy.ts`: `6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8`

## New result

`assertProtectedVenueReadback()` treats `PARTIALLY_FILLED` orders as active and compares `origQty` (mapped to `quantity`) against the saved protected position quantity. Although the venue order type includes `executedQuantity` and the CLI Aster adapter maps `executedQty`, this verification does **not** subtract executed quantity from the original quantity or otherwise verify remaining unfilled protective capacity.

With a synthetic venue response for a RENDER SHORT position of quantity 1.0 and otherwise valid STOP_MARKET / TAKE_PROFIT_MARKET orders:

- STOP `status=PARTIALLY_FILLED, origQty=1.0, executedQty=0.9` (remaining 0.1) was accepted; `recoverIdleProtectedRateBudgetState()` returned PASS and cleared `manualReview`.
- STOP `executedQty=0.999` (remaining 0.001) was also accepted.
- TP `executedQty=0.9`, or both STOP and TP partially filled by 0.9, were accepted.
- Controls: `FILLED` STOP, missing STOP, wrong original STOP quantity, wrong STOP trigger price, and extra active order were rejected with manual review retained.

The invariant **remaining protective order quantity >= currently protected position quantity** is not established by this recovery check. This is a distinct failure from previously reported same-symbol extra-position enumeration: it concerns **remaining protective order capacity**, not the number of position rows.

## Reproducibility

Owner-PC Windows filesystem; pinned original TS executed through Node `stripTypeScriptTypes` + VM with synthetic venue readback. Two independent Python launchers each in normal, `-O`, `-OO` modes; six child processes all exit 0, twelve cases per process, **72/72 PASS**, canonical result SHA256 `8531ef44aa475f27f7329026f116d2a976c222f85a43c109ac9d0fd14c356960`.

Research script: `scripts/dd-reduction/audit_render4427_partial_fill_protection_20261027.py` (owner-PC SHA256 `acc52d7f15cd5c930799a0d999c9d13b18b11d60f9148ebdb81ff4935d45203a`). Evidence: `RENDER_4427_PARTIAL_FILL_PROTECTION_AUDIT_20261027.json` (owner-PC SHA256 `8f0c6c8c33273de1fe48b13d81ed05adf58ee8dac8f132d1eadf387d81af7341`).

## Boundaries / no production claims

The venue rows and order fill amounts were synthetic. No authenticated Aster inventory, actual partial fill, production recovery invocation, Native8 execution, exchange order, or real incident is established. Real exchange semantics for partially filled conditional STOP/TP orders and how the venue updates remaining quantity must be independently certified. The audit did not modify VPS, LIVE, Production, HP, any of the eight existing strategies, the legacy IDLE Core `_overlay_block`, or a dirty worktree. Research writes were restricted to `C:/Users/dis/render4427-research-only/`; no access to `C:/tmp`.

Owner: `IDLE_RENDER_INDEPENDENT_SHORT_RESEARCH`; Route: `IDLE_RENDER_IND_BTC_DIVERGENCE_SELL55_SHORT`; Gross `0.25x`. Status remains `NEED_NATIVE_ALLOCATOR` and `order_authorized=false`.

Next: trace the real Aster adapter and operator caller, hedge-mode position/order readback semantics, remaining executable stop/TP quantity, owner/lease/pending/venue identity, full inventory and native allocator integration. Do not treat synthetic receipts as authoritative; do not use future exits for entry ranking.
