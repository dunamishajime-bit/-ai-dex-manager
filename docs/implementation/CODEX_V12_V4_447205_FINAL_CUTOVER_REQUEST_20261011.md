# Codex final handoff — V12 V4 447205 monitor-coherent candidate

Date: 2026-10-11 JST

STATUS: BLOCKED_REAL_VENUE_LIFECYCLE_EVIDENCE
HANDOFF_READY: TRUE
LIVE_V4_FULLY_VERIFIED: FALSE

## 1. Authoritative references

Repository:
`dunamishajime-bit/-ai-dex-manager`

Final code candidate branch:
`fix/v12-v4-monitor-coherence-20261011`

Final code candidate SHA:
`447205ee22ab64d2d0013922eeccfd4a1e14a72f`

Current Production / rollback release:
`ce1edeead8d0f9e5d88e829d415057117502a335`

Policy:
`V2_M150_D05_CORE_NATIVE` / 41 routes

This handoff document is intentionally stored in a separate commit whose parent is exactly the candidate SHA. Use the handoff commit/path as instructions and the 447205 SHA as the source candidate.

Do not silently alter 447205. If source changes are needed, generate a new SHA and repeat exact-SHA CI, Stage, read-only audit, TIME37 binding and venue/certificate checks.

## 2. Exact-SHA certification already completed

### Full Linux certification
Run `38137971256`: SUCCESS on exact SHA 447205.

Passed:
- root dependency install
- root type checks
- V4 lifecycle and fail-closed checks
- full root regression on Linux
- UI dependency install
- UI contract checks
- Linux UI Production build
- intentional adoption-remains-blocked guard

### Immutable Stage
Run `38138380980`: SUCCESS.

Evidence:
- `TARGET_SHA_VERIFIED=447205ee22ab64d2d0013922eeccfd4a1e14a72f`
- `SELF_TEST_PASS`
- `routes=41`
- `realOrderEnabledV4=0`
- staged at `/home/deploy/disdex-trading/releases/447205ee22ab64d2d0013922eeccfd4a1e14a72f`
- current remained `ce1edeead8d0f9e5d88e829d415057117502a335`
- orders sent = 0
- trading mutation = 0
- V4 not started

### Final decision-to-order and VPS read-only audit
Run `38138588141`: SUCCESS for both jobs.

Static job PASS:
- critical decision-to-order tests
- runner self-tests
- critical runtime compilation

VPS read-only job PASS:
- current Production remains ce1edee
- signed Aster account readback succeeds
- positions = 0
- open orders = 0
- orders/cancels/position changes = 0
- account-config-readiness latest execution status = 0
- final candidate release exists on VPS
- disk approximately 7.7 GB free / 84% used

## 3. Legacy V12 retirement is now persistent

Run `38135759555`: SUCCESS.

Verified before retirement:
- V12 state flat
- reconciliationStatus = PASS
- state ownership = deploy:deploy 0600
- Aster positions = 0
- Aster open orders = 0
- trading mutation = 0

Then:
- old exact V12 instance stopped
- runtime mask was removed
- persistent systemd mask installed under /etc/systemd/system
- `OLD_V12_PERSISTENTLY_MASKED=TRUE`
- V4 Canary inactive
- V4 Production inactive
- no trading mutation

Do not unmask or restart old `disdex-v12-x1-all@...` to make legacy watchdogs green.

## 4. Monitor/coherence blocker has been fixed in candidate code

Compared with prior 672394, 447205 changes only monitoring / runtime-coherence / heartbeat / tests, not V4 route logic, Gross, TIME37 or exit policy.

Changed files are limited to:
- `lib/server/runner-service-resolution.ts`
- `scripts/ops/root/disdex-current-runtime-coherence-guard`
- `scripts/ops/root/disdex-current-runtime-wiring`
- `scripts/ops/root/disdex-runner-health-alert.ts`
- `scripts/ops/root/disdex-runner-health-snapshot-current.mjs`
- `scripts/ops/root/disdex-runner-watchdog-current.mjs`
- `scripts/v12-v4-production-runner.ts`
- monitoring/systemd contract tests

Implemented contract:
- V4 daemon emits an exact-release V4 heartbeat.
- Health snapshot supports explicit V12 primary mode LEGACY or V4.
- Watchdog supports explicit V12 primary mode LEGACY or V4 and never treats both as simultaneous primary entry authority.
- V4 mode targets `disdex-v12-v4@<exact SHA>.service`.
- V4 operator scope is `V12_V4`, distinct from `V12_X1_ALL`.
- Current-runtime wiring persists a SHA-bound V12-primary marker.
- V4 mode requires reconciled-flat legacy V12 state before retirement.
- V4 mode persistently masks legacy V12 instances.
- Legacy V12 kill-switch auto-repair, position-recovery timer and three-hour health-check are disabled in V4-primary mode.
- Current-runtime coherence guard follows the persistent V4-primary marker and requires legacy V12 to remain persistently retired.
- Health alert resolver accepts the exact-SHA V4 unit and fails closed on mismatched explicit units.
- Rollback to an old SHA uses that old SHA's own primary-mode contract instead of silently reusing the V4 marker.

These changes are certified by Run 38137971256 and static-order-path Run 38138588141.

Current Production is still ce1edee, therefore the legacy watchdog may still show failed while the old V12 is intentionally masked. Do not "fix" that by unmasking V12. The 447205 V4-aware monitor/coherence contract must be applied atomically with final V4 cutover.

## 5. TIME37 semantics are unchanged, but approval remains exact-SHA-bound

Previously approved source SHA:
`cb945768dc2903b4c4c7373a5e8688fde2fe0031`

The following Git blobs are byte-identical at the old approved source and final 447205:
- `lib/v12-v4-time-stop-approval.ts`
- `lib/v12-v4-production-lifecycle.ts`
- `lib/v12-v4-time-emergency-stop-research.ts`

Therefore TIME37 fixed 8% STOP semantics were not altered by the ownership or monitor changes.

However the root approval artifact is exact-SHA-bound. Do not rewrite the SHA in an old approval. Prepare a legitimate 447205-bound approval artifact and require explicit operator authorization before installation.

## 6. Signed GET-only Production venue history — exact final SHA

Run `38138494198`: SUCCESS on staged 447205.

Sanitized artifact:
`v12-v4-production-history-readonly-38138494198`

Evidence:
- Production host = true
- positions = 0
- open orders = 0
- mutation calls = 0
- secret scan PASS
- queried symbols = 100
- total trades = 24
- distinct orders = 22
- multi-fill orders = 1
- maximum fills/order = 3
- partial-fill evidence = 1
- STOP order types observed = 0
- filled reduce-only STOP types = 0

Artifact evidence SHA256:
`ee29a262cdec389b985bd5b60e76ff5f5b9f44a52824762c3a3d86f87a0bb0b7`

Lifecycle sub-hashes:
- signedOrdersSha256 =
  `a0d08f547afd3a88673d25cabdbd9a84bfd37b43515512749ad76a262809f7b0`
- signedPositionsSha256 =
  `e538e8e6e945d13f5d64a06a8ca8349786e93e79c25e0a54caff93d09afcbc9d`
- restartRecoverySha256 = null
- sameSymbolRaceSha256 = null
- completeForProductionCertificate = false

The account has authentic multi-fill evidence, including one three-fill reduce-only MARKET order. Some historical filled reduce-only MARKET rows report nonzero stopPrice, but they are not STOP/STOP_MARKET order types and must not be relabeled as resident STOP proof.

## 7. Exact remaining venue blocker

Production certificate schema v2 requires all four authentic venue lifecycle hashes:
- signedOrdersSha256
- signedPositionsSha256
- restartRecoverySha256
- sameSymbolRaceSha256

The first two are now proven.

The final two remain unproven. Existing Production history also contains no actual STOP/STOP_MARKET lifecycle sufficient to prove:
- resident STOP placement/read-back identity
- partial ENTRY fill -> protective rearm/resize
- restart recovery without duplicate ENTRY/STOP
- same-symbol virtual-leg STOP/EXIT race handling

Do not fabricate these hashes and do not substitute mocks, historical H1 replay, CI or a flat GET.

Preferred evidence order:
1. additional authentic existing Production history, if independently sufficient;
2. Aster Testnet only if dedicated usable credentials/venue behavior are actually available;
3. controlled Production Canary only after separate explicit operator authorization.

If a controlled Production Canary is authorized, follow the repository's permit contract exactly. Do not broaden it into discretionary trading or auto-promote on success.

## 8. Operator-only gates still required

Do not silently set any of these:
1. 447205-bound TIME37 approval.
2. `forwardUnderperformanceAcknowledged=true` for known external/Y06 underperformance.
3. exact 447205 Production certificate.
4. separate `V12_V4` operator activation scope.
5. controlled Production Canary authorization if needed.

These are distinct from technical CI success.

## 9. Final cutover sequence after evidence/approvals are valid

Only after authentic lifecycle evidence and all operator gates pass:

1. Re-read signed Aster positions/open orders and require flat unless the approved cutover contract explicitly handles owned exposure.
2. Verify shared pending exposure has no unresolved PENDING/SUBMITTED/UNKNOWN.
3. Verify account lock and shared Aster rate-budget lock/state.
4. Verify Shared Risk fresh/sourceComplete/not tripped.
5. Verify Margin Guard fresh/HEALTHY/ordersAllowed.
6. Verify Kill Switch inactive.
7. Keep old V12 persistently masked.
8. Install/apply the exact 447205 V4-primary runtime wiring.
9. Verify legacy V12 recovery automation remains disabled in V4 mode.
10. Install exact-SHA TIME37 approval, Production certificate and V12_V4 activation artifacts only after their independent validation succeeds.
11. Atomically move current/release marker using the repository-approved cutover procedure.
12. Start only `disdex-v12-v4@447205...`.
13. Verify V4 heartbeat, health snapshot, watchdog, health alert and coherence all resolve to V4.
14. Verify no old `disdex-v12-x1-all@...` process can start, including after systemd daemon reload.
15. Verify peer runners, Shared Risk and Margin Guard remain coherent.
16. Verify one complete V4 decision cycle.
17. Re-read signed Aster positions/orders and durable V4 execution state.
18. Update HP only after runtime verification.

Do not flatten a legitimately opened V4 position solely to roll back code; preserve protection/reduction authority and use the ownership-aware rollback path.

## 10. Mandatory final status

Return exactly one:
- `LIVE_V4_FULLY_VERIFIED` only after real cutover and all post-cutover evidence passes.
- `READY_FOR_OPERATOR_FINAL_ACTIVATION` only when technical venue evidence is complete and only explicit operator approval/install steps remain.
- `BLOCKED_REAL_VENUE_LIFECYCLE_EVIDENCE` while restartRecovery/sameSymbolRace authentic evidence remains incomplete.
- another `BLOCKED_<EXACT_REASON>` if a new specific technical blocker is found.

At the time of this handoff, the correct status is:
`BLOCKED_REAL_VENUE_LIFECYCLE_EVIDENCE`

## 11. Mandatory final report fields

Report:
- source branch + exact SHA
- handoff commit + path
- current Production SHA + rollback SHA
- CI run IDs
- Stage run ID
- persistent old-V12 retirement run ID
- final order-path/VPS audit run ID
- Production history audit run ID + artifact + SHA256
- lifecycle mode + all four lifecycle hashes
- TIME37 approval metadata
- Production certificate metadata
- V12_V4 operator activation metadata
- all relevant service PIDs/NRestarts/WorkingDirectory
- Aster positions/open orders
- pending exposure / account lock / rate-budget
- Shared Risk / Margin Guard / Kill Switch
- old V12 persistent-mask proof
- V4 watchdog/health/coherence proof
- disk
- current/release-marker equality
- final HP status
- exact terminal status
