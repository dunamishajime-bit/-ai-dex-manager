# Operator-verified manual close recovery (2026-10-09)

## Scope
Incident release `ce1edeead8d0f9e5d88e829d415057117502a335`. This is **not** the V12 V4 high-profit production deployment. Current production has V12 failed with local MANUAL_REVIEW, shared kill switch active and subsequently escalated to `FLATTEN_MANAGED` due to **V52 managed Stock symbol reconciliation mismatch**, and stale PENGU/V52 held-position state after the operator manually closed both positions.

## Authenticated Aster evidence (read-only)
- Before manual close: PENGUUSDT SHORT -7718 @ 0.008574 and TSLAUSDT LONG +0.38 @ 372.64.
- Manual PENGU close: authenticated `BUY 7718 @ 0.008163`, `orderId=1167343620`, at `1791524113700`, realized PNL +3.172098 USDT, entry orderId 1165455175.
- Manual TSLA close: authenticated `SELL 0.38 @ 378.87`, `orderId=305148915`, at `1791524111150`, realized PNL +2.3674 USDT, entry orderId 304049477.
- Three successive authenticated full-account checks returned `openPositionCount=0`, `openOrderCount=0` on two separate runs; no writes, cancels or trades.
- PENGU auto-reconciliation fails `PENGU_RESIDENT_STOP_FILL_RECONCILIATION:STOP_LEDGER_QUANTITY_UNRECONCILED`. This is correct given the close was *operator-initiated*, **not a resident stop execution**.
- V52 escalated protected hold because stale state still contains one `V50_POST_OPEN_BASIS` TSLA position whereas authenticated venue is flat.

## This source branch's scope
`lib/external-manual-flat-reconcile.ts` performs a **pure**, strict pre-migration calculation from signed/read-only source evidence. It never writes VPS state, never alters the shared Kill Switch and never opens or closes an order. It blocks unknown changes in SHA, position count, old state, official reason, fill identity, stop order identity, temporal ordering, proof age and PNL. It computes the PENGU realized-return risk overlay using the same live formula and the current production normal-exit cooldown (6 hours), preserves the other runtime information, and produces a proposed four-file change and operator receipt.

The module requires a fresh authenticated 3x-flat proof in the **same transaction** before using its outputs. Tests validate rejection of wrong evidence; passing unit tests is not live certification.

## Remaining controlled production work
1. Confirm operator is the source of both manual exits and preserve immutable venue order/trade evidence (including fees), original PENGU Stop Ledger, M05 shadow state, V52 state, V12 state, shared Kill Switch and risk state. Do not relabel the manual PENGU exit as a hard-stop.
2. Quiesce every account-writing runner to avoid post-proof fill races; acquire the documented shared account lock, with owner and lease verification. Do not delete or steal an active lock.
3. Re-run authenticated full-account flat gate, and independently get the four venue fills within the same transaction; source these data directly rather than trusting the values in this README or earlier observation.
4. Evaluate `prepareExternalManualFlatReconciliation`. Implement a guarded **operator apply transaction** with archival backups, proper ownership/mode, state re-read/compare, atomic write and rollback. This is not yet implemented in the source branch.
5. Ensure no other sleeves have active local/pending positions (including Q102, HYPE, FET and Idle). If any ambiguity exists, fail closed and preserve the kill switch.
6. Reconcile PENGU manual close to the actual trade ledger, route risk overlay and separate M05 observation; record exit attribution; reconcile TSLA in V52 including signed actual commissions, the V52 PnL ledger and v50CompletedTrades. Preserve all original closed-position records in operator archives, then retire stale state using the guarded operator transaction.
7. Clear the shared Kill Switch only when evidence, state ownership, crypto daily risk and all designated operator gates pass. DO NOT use existing `disdex-aster-upstream-live-recovery.ts` to clear the current `V52 managed Stock symbol reconciliation mismatch` reason; it is not allowlisted.
8. Start current-SHA runners sequentially after the apply transaction. Verify exact SHA, exit codes, fresh heartbeats, V12 2h decision snapshot, PENGU/V52 no false position, no new exposure until normal entry gate conditions, and final authenticated venue position/order inventory.
9. Report whether V12 current-LIVE has resumed. **Never claim a Production restart, kill switch clearance or LIVE verification until the VPS has been independently checked.**

## Known entrypoint
`npx tsx --test tests/external-manual-flat-reconcile.test.ts` or the installed `tsx` tool. Run focused type-check with `tsc --noEmit -p tsconfig.manual-flat-recovery.json`.

The broader root `tsconfig.json` already contains unrelated implicit-any errors in the previous release; use focused test project for the new module.
