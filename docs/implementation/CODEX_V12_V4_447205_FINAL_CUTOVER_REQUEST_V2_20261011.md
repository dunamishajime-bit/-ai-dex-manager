# Codex final handoff — V12 V4 447205 monitor-coherent candidate (V2)

Date: 2026-10-11 JST

STATUS: BLOCKED_REAL_VENUE_LIFECYCLE_EVIDENCE
HANDOFF_READY: TRUE
LIVE_V4_FULLY_VERIFIED: FALSE
READY_FOR_OPERATOR_FINAL_ACTIVATION: FALSE

## 1. Authoritative source

Repository:
`dunamishajime-bit/-ai-dex-manager`

Final code candidate branch:
`fix/v12-v4-monitor-coherence-20261011`

Final code candidate SHA:
`447205ee22ab64d2d0013922eeccfd4a1e14a72f`

Current Production/current marker:
`ce1edeead8d0f9e5d88e829d415057117502a335`

Current rollback source:
`ce1edeead8d0f9e5d88e829d415057117502a335`

Policy:
`V2_M150_D05_CORE_NATIVE` / 41 routes

This handoff branch is created directly from the exact final candidate SHA. The handoff document is instruction-only; the candidate source SHA remains 447205.

Do not silently alter 447205. If source code changes are required, create a new SHA and rerun exact-SHA CI, immutable Stage, read-only order-path audit, TIME37 binding and venue/certificate checks.

## 2. Exact-SHA certification

### Full Linux certification
Run `38137971256`: SUCCESS on exact SHA 447205.

Passed:
- root dependency install
- root type checks
- V4 lifecycle/fail-closed checks
- full root regression on Linux
- UI dependency install
- UI contract checks
- Linux UI Production build
- intentional adoption-remains-blocked guard

### Immutable Stage
Run `38138380980`: SUCCESS.

Evidence:
- `TARGET_SHA_VERIFIED=447205ee22ab64d2d0013922eeccfd4a1e14a72f`
- `STAGE_DEPENDENCY_CONTRACT=PASS`
- `SELF_TEST_PASS`
- `routes=41`
- `realOrderEnabledV4=0`
- staged at `/home/deploy/disdex-trading/releases/447205ee22ab64d2d0013922eeccfd4a1e14a72f`
- current remained `ce1edeead8d0f9e5d88e829d415057117502a335`
- V4 service not started
- orders sent = 0
- trading mutation = 0
- `STATUS: V12_V4_STAGE_ONLY_VERIFIED`

### Final decision-to-order / VPS read-only audit
Run `38139507883`: SUCCESS for both jobs.

Static job:
- critical decision-to-order tests PASS
- runner self-tests PASS
- critical runtime compilation PASS

VPS read-only job:
- current Production = ce1edee
- signed Aster positions = 0
- signed Aster open orders = 0
- orders/cancels/position changes = 0
- account-config-readiness latest execution = exit status 0
- Margin Guard = HEALTHY
- ordersAllowed = true
- consecutiveFailures = 0
- disk approximately 7.7 GB free / 84% used
- old V12 exact instances remain masked/inactive/dead

Historical Permission denied lines may still appear in journal history; the fresh Margin Guard state above is the current state and is healthy.

## 3. Legacy V12 is persistently retired on the VPS

Run `38135759555`: SUCCESS.

Before retirement:
- legacy V12 state flat
- reconciliationStatus = PASS
- state ownership = deploy:deploy 0600
- Aster positions = 0
- Aster open orders = 0

Then:
- legacy V12 exact instance stopped
- runtime mask removed where needed
- persistent systemd mask installed under /etc/systemd/system
- persistent mask read-back verified
- `OLD_V12_PERSISTENTLY_MASKED=TRUE`
- V4 Canary inactive
- V4 Production inactive
- `TRADING_MUTATION=0`

Do not unmask/restart old `disdex-v12-x1-all@...` merely to make the legacy watchdog green.

## 4. Monitor/coherence blocker is fixed in candidate source, not yet applied to Production

447205 adds V4-aware monitoring/coherence while preserving strategy logic.

The candidate now:
- emits exact-release V4 heartbeat from the V4 daemon;
- supports explicit V12 primary mode `LEGACY` or `V4`;
- makes health snapshot V4-aware;
- makes watchdog target only one V12 primary at a time;
- targets `disdex-v12-v4@<exact SHA>.service` in V4 mode;
- uses operator scope `V12_V4`, separate from `V12_X1_ALL`;
- persists a SHA-bound V12-primary marker;
- requires reconciled-flat legacy V12 state before V4 retirement;
- persistently masks legacy V12 instances in V4 mode;
- disables legacy V12 kill-switch auto-repair, position-recovery timer and three-hour health-check in V4 mode;
- makes current-runtime coherence follow the persistent V4-primary marker;
- makes health-alert resolver accept only exact-SHA V4 override and fail closed on mismatch.

Current Production is still ce1edee, so its legacy watchdog may remain failed because it still expects the deliberately retired old V12. This is not permission to unmask the old V12.

At final cutover, apply the 447205 V4-primary runtime wiring atomically with V4 ownership. After cutover, the watchdog/health/coherence services must resolve to V4 and the old V12 must remain persistently masked.

## 5. TIME37 semantics unchanged; exact-SHA approval still required

Previously approved source SHA:
`cb945768dc2903b4c4c7373a5e8688fde2fe0031`

At that source and final 447205, these blobs are byte-identical:
- `lib/v12-v4-time-stop-approval.ts` = `caa67574e6e8d83ce0c2a65beb520a29ad1f0131`
- `lib/v12-v4-production-lifecycle.ts` = `7cf2879a870b476aa801e3db3e57dec5cfe2322f`
- `lib/v12-v4-time-emergency-stop-research.ts` = `c9ce1543c5012941ac7c67dc5ec9bd0bcfd6c2bd`

Therefore TIME37 fixed 8% emergency STOP semantics did not change.

However the approval artifact itself is exact-SHA-bound. Do not edit an old approval's SHA. A legitimate 447205-bound TIME37 artifact still requires explicit operator authorization before installation.

## 6. Exact final-SHA signed GET-only Production venue evidence

Run `38138494198`: SUCCESS against staged 447205.

Artifact:
`v12-v4-production-history-readonly-38138494198`

Artifact payload:
- schema = `disdex-v12-v4-production-history-deep-readonly/v2`
- candidateSha = 447205
- Production host = true
- positions = 0
- open orders = 0
- queried symbols = 100
- total trades = 24
- distinct orders = 22
- multi-fill orders = 1
- max fills/order = 3
- reduce-only orders = 11
- partial-fill evidence = 1
- actual STOP/STOP_MARKET order types observed = 0
- filled reduce-only STOP types = 0
- mutationCalls = 0
- secretDisclosed = false

Payload evidence SHA256:
`ee29a262cdec389b985bd5b60e76ff5f5b9f44a52824762c3a3d86f87a0bb0b7`

Downloaded artifact file SHA256:
`3da3d8c25767a6d62a1d00bf3b50987206268609e0337e407cf7d954d3e28fed`

Lifecycle hashes from the sanitized artifact:
- signedOrdersSha256 =
  `a0d08f547afd3a88673d25cabdbd9a84bfd37b43515512749ad76a262809f7b0`
- signedPositionsSha256 =
  `e538e8e6e945d13f5d64a06a8ca8349786e93e79c25e0a54caff93d09afcbc9d`
- restartRecoverySha256 = null
- sameSymbolRaceSha256 = null
- completeForProductionCertificate = false

Authentic partial-fill evidence exists: a reduce-only MARKET order was filled in 3 fills.

Some historical reduce-only MARKET rows carry non-zero stopPrice fields. They are not STOP/STOP_MARKET order types and must not be relabeled as resident STOP proof.

## 7. Exact remaining technical blocker

The Production certificate v2 contract requires authentic real-venue lifecycle evidence sufficient for:
- signed order identity;
- signed position identity;
- resident STOP lifecycle;
- partial ENTRY fill -> protection resize/rearm;
- restart recovery without duplicate ENTRY/STOP;
- same-symbol virtual-leg STOP/EXIT race protection.

The current authentic Production history proves signed orders, signed positions and real multi-fill behavior.

It does NOT prove:
- actual V4 STOP/STOP_MARKET lifecycle;
- restart recovery hash;
- same-symbol race hash.

Therefore:
- do not create a fake Production certificate;
- do not substitute mocks, H1 replay, flat GET, CI, historical price replay or non-STOP MARKET rows;
- do not set `completeForProductionCertificate=true` without authentic evidence.

Preferred evidence order:
1. additional authentic existing Production history if it independently proves the missing cases;
2. Aster Testnet only if dedicated credentials and venue behavior are genuinely usable;
3. controlled Production Canary only after separate explicit operator authorization.

If controlled Production Canary becomes authorized, use the repository permit contract exactly: one natural V4 signal, venue-minimum size, hard notional cap, finite permit, one durable ENTRY consumes the permit, no automatic promotion.

## 8. Operator-only gates remain separate

Do not silently set any of:
1. 447205-bound TIME37 approval;
2. `forwardUnderperformanceAcknowledged=true` for known external/Y06 underperformance;
3. exact 447205 Production certificate;
4. separate `V12_V4` operator activation scope;
5. controlled Production Canary authorization, if required.

These are not implied by CI success or by this handoff.

## 9. Final cutover sequence after venue evidence and approvals are valid

Only after authentic lifecycle evidence and all operator gates pass:

1. Re-read signed Aster positions/open orders.
2. Require no unresolved PENDING/SUBMITTED/UNKNOWN shared exposure.
3. Verify account lock and global Aster rate-budget lock/state.
4. Verify Shared Risk fresh/sourceComplete/not tripped.
5. Verify Margin Guard fresh/HEALTHY/ordersAllowed.
6. Verify Kill Switch inactive.
7. Verify old V12 persistent masks.
8. Install/apply exact 447205 V4-primary runtime wiring.
9. Confirm legacy V12 auto-repair/position-recovery/three-hour-health automation stays disabled in V4 mode.
10. Install only valid exact-SHA TIME37 approval, Production certificate and V12_V4 operator activation artifacts.
11. Atomically move current/release marker using the repository-approved cutover procedure.
12. Start only `disdex-v12-v4@447205ee22ab64d2d0013922eeccfd4a1e14a72f.service`.
13. Verify V4 heartbeat, health snapshot, watchdog, health alert and coherence all resolve to V4.
14. Verify no old `disdex-v12-x1-all@...` process can start, including after daemon-reload.
15. Verify peer runners, Shared Risk and Margin Guard remain coherent.
16. Verify one complete V4 decision cycle.
17. Re-read signed Aster positions/orders and durable V4 execution state.
18. Update HP only after runtime verification.

Do not flatten a legitimately opened V4 position solely to roll back code. Preserve protection/reduction authority and use the ownership-aware rollback contract.

## 10. Required terminal status

Report exactly one:
- `LIVE_V4_FULLY_VERIFIED` only after real cutover and post-cutover evidence pass;
- `READY_FOR_OPERATOR_FINAL_ACTIVATION` only if all technical venue evidence is complete and only explicit operator action remains;
- `BLOCKED_REAL_VENUE_LIFECYCLE_EVIDENCE` while authentic restart/same-symbol/STOP evidence is incomplete;
- another `BLOCKED_<EXACT_REASON>` for a newly discovered specific blocker.

At this handoff, the correct status is:
`BLOCKED_REAL_VENUE_LIFECYCLE_EVIDENCE`

## 11. Mandatory final report fields

Return:
- final source branch + exact SHA
- handoff branch + handoff commit + path
- current Production SHA + rollback SHA
- Linux certification run
- immutable Stage run
- persistent legacy-V12 retirement run
- final order-path/VPS audit run
- Production history audit run + artifact + hashes
- real-venue evidence mode + all lifecycle hashes
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
- HP status
- exact final status
