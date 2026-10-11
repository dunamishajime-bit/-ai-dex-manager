# Codex依頼文 — V12 V4 最終認証・Production切替（672394 final handoff）

STATUS: READY_FOR_CODEX_FINAL_CERTIFICATION_AND_CUTOVER_WORK / LIVE_NOT_YET_ACTIVE

この文書は、V12 V4の最終候補を一次ソースとして、残るProduction実機認証・監視系付け替え・Operator承認後の原子的LIVE切替までCodexに実行させるための最終handoffです。

## 1. 不変アンカー

Repository:
`dunamishajime-bit/-ai-dex-manager`

Final candidate branch:
`fix/v12-manual-close-state-ownership-20261011`

Final candidate SHA:
`6723948608ce9c8ab3aba077cba7e5a0d7f6f708`

Current Production / rollback release:
`ce1edeead8d0f9e5d88e829d415057117502a335`

Adopted V4 policy:
`V2_M150_D05_CORE_NATIVE` / 41 routes

Final candidate is already staged at:
`/home/deploy/disdex-trading/releases/6723948608ce9c8ab3aba077cba7e5a0d7f6f708`

Do not silently modify this SHA. If any source change is required, create a new exact SHA, rerun all certification, restage immutably, and bind every approval/certificate to that new SHA.

## 2. Completed evidence — do not redo by assumption, but verify read-back

### Exact-SHA Linux certification
Run `38125945115`: SUCCESS.

Passed:
- root TypeScript checks
- V4 lifecycle / fail-closed checks
- full root Linux regression
- UI contracts
- Linux UI Production build
- intentional “Adoption remains blocked” guard

### Final order-path and VPS read-only audit
Run `38126431330`: SUCCESS for both:
- `static-order-path-tests`
- `vps-readonly-audit`

Fresh signed Aster GET-only readback:
- positions = 0
- open orders = 0
- ordersSent = 0
- cancelsSent = 0
- positionChangesSent = 0

Current Production remained:
`ce1edeead8d0f9e5d88e829d415057117502a335`

Disk at final audit:
approximately 7.9 GB free / 84% used.

### Final immutable stage
Run `38126315310`: SUCCESS.

Evidence:
- `TARGET_SHA_VERIFIED=6723948608ce9c8ab3aba077cba7e5a0d7f6f708`
- `SELF_TEST_PASS`
- `routes=41`
- `realOrderEnabledV4=0`
- current SHA unchanged
- V4 service not started
- no approval artifact created
- ordersSent = 0
- tradingMutation = 0
- `STATUS: V12_V4_STAGE_ONLY_VERIFIED`

### Legacy V12 external-close reconciliation
Earlier no-order cutover preparation run `38109261404`: SUCCESS.

The externally manually closed ETH state was reconciled using authentic signed Aster order/trade/income history:
- `V12_EXTERNAL_MANUAL_CLOSE_RECONCILED`
- reconciliationStatus = PASS
- state flat
- orders/cancels/positionChanges = 0

### Legacy V12 retirement
Run `38109440903`: SUCCESS.

Old V12:
- stopped
- runtime masked
- no longer allowed to resurrect during preparation

A later ownership repair run `38126031424`: SUCCESS:
- `V12_STATE_FLAT=TRUE`
- `V12_STATE_OWNERSHIP_NORMALIZED=TRUE`
- state restored to `deploy:deploy 0600`
- Aster flat
- old V12 remains masked
- V4 Canary and V4 Production remain inactive
- tradingMutation = 0

### Ownership recurrence fix included in final SHA

Compared with 4759, the final 672394 candidate changes only:
1. `scripts/v12-external-manual-close-reconcile.ts`
2. `tests/v12-external-manual-close-reconcile.test.ts`

The manual-close helper now restores canonical state ownership after a root reconciliation so root:root 0600 does not recur.

This fixed the prior Margin Guard/account-config outage caused by the root-owned V12 state.

Fresh final readback:
- `disdex-account-config-readiness.service`: latest execution exit status 0
- Margin Guard: `HEALTHY`
- `ordersAllowed=true`
- `consecutiveFailures=0`
- shared Kill Switch: inactive

## 3. Route evidence already established

Preserve the exact scope distinction.

External 25-route evidence:
- Entry replay: 258 / 258 PASS
- Exit replay: 258 / 258 PASS

Remaining historical 16-route evidence:
- source / Entry / rank / Gross: 212 / 212 PASS
- independent H1 Exit price model: 212 / 212 PASS

This closes the retrospective route evidence gap. It is NOT 41/41 unseen-period real-broker execution certification.

Do not label mocks, historical price replay, H1 price-model equality, or a flat signed GET as real venue lifecycle proof.

## 4. TIME37 exact-SHA rule

The operator previously adopted the TIME37 fixed 8% emergency STOP policy at source SHA:
`cb945768dc2903b4c4c7373a5e8688fde2fe0031`

At that SHA and final 672394 SHA, the following Git blobs are byte-identical:
- `lib/v12-v4-time-stop-approval.ts`
- `lib/v12-v4-production-lifecycle.ts`
- `lib/v12-v4-time-emergency-stop-research.ts`

Therefore TIME37 policy semantics were not changed by the ownership repair.

However the root TIME37 approval artifact is exact-SHA-bound. Do not rewrite the approved SHA, fabricate a signature, or infer automatic approval. Prepare the 672394-bound artifact and obtain an explicit operator action before installation.

## 5. Real-venue lifecycle certification — mandatory

Production certificate schema v2 accepts only authentic real-venue evidence modes:
- `AUTHENTIC_PRODUCTION_HISTORY`
- `ASTER_TESTNET`
- `CONTROLLED_PRODUCTION_CANARY`

Preferred order:
1. AUTHENTIC_PRODUCTION_HISTORY
2. ASTER_TESTNET if actually usable with dedicated Testnet credentials
3. CONTROLLED_PRODUCTION_CANARY only with separate explicit operator authorization

Start with signed GET-only Production history. Use authentic records to determine whether the following can each be evidenced independently:
- signed order identity
- signed position identity
- partial-fill handling
- resident STOP trigger / quantity / reduceOnly identity
- additional cumulative ENTRY fill -> protection resize/rearm
- restart recovery without duplicate ENTRY or STOP
- same-symbol multiple virtual-leg STOP/EXIT race protection
- unknown-result read-back recovery

The existing authentic ETH manual-close history is useful evidence, but it does not by itself prove all STOP/restart/same-symbol race cases.

Mock tests cannot be substituted for any missing real-venue hash.

If authentic history does not establish the required lifecycle cases, do NOT manufacture a PASS. Report the exact missing cases. A controlled Production canary must not be placed unless the operator separately authorizes it. If authorized later, enforce the repository contract: one natural V4 signal, venue-minimum size, absolute notional cap <= USD 25, permit <=24h, one durable ENTRY intent consumes the permit, and no automatic promotion after success.

## 6. Critical watchdog / health migration before any real-order authority

Current preparation state intentionally has the old V12 unit masked.

Fresh readback shows the legacy `disdex-runner-watchdog.service` currently exits fail-closed because the existing watchdog/health contract still expects:
`disdex-v12-x1-all@<SHA>.service`

The V4 Production unit is:
`disdex-v12-v4@<SHA>.service`

This must be resolved BEFORE ordinary V4 order authority.

Codex must:
- never unmask/restart the old V12 merely to make the watchdog green;
- migrate the V12 health/watchdog/coherence identity to the V4 unit and V4 execution-state contract, or introduce the approved V4-specific equivalent;
- prevent any watchdog, three-hour health check, auto-repair, position recovery, or coherence guard from restarting `disdex-v12-x1-all@...` after V4 takes ownership;
- prove the new V4 watchdog path can detect stopped/failed V4 and perform only bounded safe recovery;
- prove it cannot create old/new dual V12 entry authority;
- verify watchdog result, health snapshot, timers, PID, NRestarts, WorkingDirectory, release SHA and execution state after cutover.

If fixing this requires source changes, the final SHA changes. In that case rerun exact-SHA Linux certification, order-path tests, route evidence digest checks, immutable staging, TIME37 SHA binding, and Production certificate generation against the NEW SHA before activation.

Do not treat the current watchdog failure as permission to disable monitoring permanently.

## 7. Peer runners and shared risk at final cutover

Before V4 ordinary LIVE authorization, reconcile all current owners against the final exact release:
- PENGU
- Q102
- V52
- FET
- HYPE
- IDLE
- RESIDUAL as IDLE sub-owner
- Shared Risk
- Margin Guard

Verify actual:
- systemd unit
- MainPID
- NRestarts
- WorkingDirectory / ExecStart
- runtime SHA lineage
- state ownership/mode
- state pending/manualReview
- Aster signed net quantity
- open orders/protective orders
- shared pending registry
- account-order lock
- global Aster rate-budget lock/state

Do not restart or roll peers merely to make an attestation pass if they own unresolved exposure. Reconcile safely first.

## 8. Operator-only gates — do not silently set TRUE

The following remain separate operator actions:

1. final exact-SHA TIME37 artifact authorization;
2. acknowledgement of the known external/Y06 underperformance before setting `forwardUnderperformanceAcknowledged=true`;
3. exact-SHA V4 Production certificate acceptance;
4. separate `V12_V4` scope in the root operator activation artifact;
5. any controlled Production canary authorization, if authentic history is insufficient.

Do not infer these from old approvals or from this document.

## 9. Production certificate requirements

Only after all technical proof is genuine, create/install the root-managed exact-SHA certificate with:
- schema `disdex-v12-v4-production-certification/v2`
- exact final SHA
- all 41 exact routes
- valid evidence SHA-256 fields
- real venue lifecycle mode and the four lifecycle hashes
- approved Gross caps
- explicit underperformance acknowledgement
- finite expiry <= 7 days
- root ownership / no symlink / no non-root write

Do not place a placeholder hash or reuse an unrelated historical digest.

## 10. Atomic final cutover

Only when all technical conditions and operator gates are valid:

- confirm Aster flat/open-order state again immediately before ownership transfer;
- keep old `ce1edee...` release intact as rollback source;
- keep old V12 masked;
- install/update exact final V4 env and systemd artifacts;
- bind watchdog/health/coherence to V4 before enabling ordinary entry authority;
- establish peer/safety service release identity as required by the final contract;
- initialize signed V4 flat execution state only after signed account/peer/pending reconciliation passes;
- atomically move the Production release/current marker only under the repository’s approved cutover procedure;
- start V4 Production under exact-SHA certificate + separate V12_V4 operator gate;
- verify one complete decision cycle;
- verify no old V12 process exists at any SHA;
- verify no duplicate entry authority exists;
- verify Shared Risk, Margin Guard, Kill Switch, account lock, rate-budget, pending exposure and protection state;
- verify all PIDs / NRestarts / WorkingDirectory / state SHA;
- verify Aster signed positions/orders after the cycle;
- verify watchdog V4 recovery identity;
- only then update HP/decision-status/history/Production SHA labels.

Never flatten a valid newly opened V4 position just to roll back code. Preserve protective reduction authority and use the ownership-aware rollback protocol.

## 11. Final status rules

Report `LIVE_V4_FULLY_VERIFIED` only if the exact final Production SHA is actually active, V4 ordinary authority is legitimately certified, old V12 cannot resurrect, all safety/monitoring services are healthy, and signed Aster readback agrees.

If technical work is complete but an operator-only item remains, report:
`READY_FOR_OPERATOR_FINAL_ACTIVATION`

If authentic lifecycle evidence is insufficient, report:
`BLOCKED_REAL_VENUE_LIFECYCLE_EVIDENCE`

If watchdog/health migration is not exact and verified, report:
`BLOCKED_V4_WATCHDOG_COHERENCE`

Never relabel a mock, CI PASS, flat account GET, or research replay as `LIVE_V4_FULLY_VERIFIED`.

## 12. Mandatory final report

Return:
- final source branch and SHA
- Production/current SHA
- rollback SHA
- exact CI run IDs
- exact stage run ID
- exact real-venue evidence mode and hashes
- TIME37 approval metadata
- Production certificate metadata
- operator V12_V4 activation metadata
- Aster positions/open orders
- all peer/service PIDs and NRestarts
- V4 watchdog/health/coherence proof
- Shared Risk / Margin Guard / Kill Switch
- account lock / rate-budget / pending exposure
- disk
- current/release-marker equality
- HP Production status
- exact final state: LIVE_V4_FULLY_VERIFIED / READY_FOR_OPERATOR_FINAL_ACTIVATION / BLOCKED_<reason>
