# LIVE approval and rollback audit — 2026-10-06

## Authorization and scope
Explicit user authorization received 2026-10-06 17:35:12 JST named LIVE 4c57efbb86ae0bbfe94bbe7dea4d09f0e1ec6c19 and candidate ebcef8297a30517f3f42c97b80fb0661dc7dc03b.
This candidate descendant modifies deployment, runtime wiring, tests and evidence only. Trading logic, signals, Sizing, exchange execution and risk policy remain byte-identical to LIVE. No manual orders or cancellations are used for verification.

## Verified preflight
Canonical exact-SHA activation on current LIVE was backed up and updated from explicit authorization, including fetCorePreemptionReady. All seven runner activation gates allowed the current SHA.
V52 was previously held by FET_PREEMPTION_EXACT_SHA_APPROVAL_REQUIRED and FLAG_NOT_READY. Runtime wiring plus starting V52 restored its healthy heartbeat. Seven traders and Shared Risk / Margin Guard were subsequently checked against systemd and heartbeat state.
Authenticated read-only exchange diagnostics found no positions and no open orders. Pending exposure entries were RELEASED. Kill Switch was inactive; Shared Risk was fresh and source-complete; Margin Guard was healthy.
Historical ACCOUNT_LOCK_BUSY and Idle rate-budget holds were recorded as fail-closed transients, not claimed absent.

## Candidate defects repaired before deployment
The flat-account helper could return success when called in a Bash conditional even after failed venue diagnostics or nonflat exposure. It now propagates pipeline and reconciliation failures explicitly.
Rollback now stops all writers before fresh account reconciliation. It preserves the latest accounting and order ownership and migrates only verified release identity fields; it does not restore stale financial snapshots.
A durable hash-verified copy of the patched runtime wiring is stored with the cutover backup. Source rollback uses this copy while operator automation is deferred. Safety daemons, traders and exact-SHA healthy heartbeats must verify before automation resumes.
Partial rollback startup failure re-quiesces writers and reports incomplete rollback with runners held. Unsupported exposure, pending orders or unknown state are held for review rather than reported healthy.
The workflow retains a failure rollback step after mandatory postdeployment, retention and public checks, using the durable original cutover script.

## Removed unused settings
FET_BRK48_MAX_GROSS=2.25 and ZEC_LONG_RISK_PCT=4.5 were emitted by old wiring but had no active consumers. Their environment and drop-in emission were removed.
Active HYPE_ZEC compatibility names remain because HYPE still references them. Release, dependency, backup and lock references must be checked before retention deletes artifacts.

## Validation
- Executable Bash/Python rollback regressions and cutover contracts: 14/14 passed on Linux, including nonflat account, outstanding order, process failure, malformed response, latest-history preservation and unknown exposure rejection.
- Updated systemd/readiness/cutover contracts: 25/25 passed.
- Expanded order-path and approval tests previously passed 110/110; two TypeScript builds passed.
- Runtime wiring Python suites: 10/10 passed; Bash syntax and wiring self-test passed.
- Production workflow reruns dedicated regressions, strategy self-tests, compile checks, unchanged-logic proof and runtime verification before success.

## Completion boundary
This document records predeployment findings. A candidate commit or passing test does not establish deployment completion. Final completion requires an observed LIVE SHA, all runner PIDs/cwd/heartbeats, fresh account and protection reconciliation, guard state, journals and public API evidence. Any unverified rollback is reported incomplete.
